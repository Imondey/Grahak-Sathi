"""
SmartRetail — FastAPI Core Verification Engine
Port: 8000

pip install fastapi uvicorn asyncpg rapidfuzz python-dotenv redis aioredis ultralytics opencv-python numpy
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import asyncpg
import os
import cv2
import numpy as np
import base64
from rapidfuzz import fuzz
from dotenv import load_dotenv
import redis.asyncio as aioredis
from datetime import datetime

import injection_model   # local self-hosted LSTM prompt-injection classifier
import purchase_verifier # anti-fraud: cross-check complaint product vs purchase history

load_dotenv()

app = FastAPI(title="SmartRetail Verification Engine", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── DB + Redis ─────────────────────────────────────────────────────────────────
DB_URL     = os.getenv("DATABASE_URL", "postgresql://postgres:1221@localhost:5432/Netra")
REDIS_URL  = os.getenv("REDIS_URL", "redis://localhost:6379")
MODEL_PATH = os.getenv("MODEL_PATH", "./AI_Model/best_final.pt")
# General-purpose COCO detector (80 common classes). Used as a FALLBACK so that
# customer-uploaded refund photos — which the narrow retail model (product/barcode)
# usually can't recognise — still produce a detection instead of always going to
# manual review.
GENERAL_MODEL_PATH = os.getenv("GENERAL_MODEL_PATH", "./AI_Model/yolov8n.pt")

db_pool    = None
redis_pool = None
yolo_model = None   # loaded lazily in startup — never at module level
general_model = None  # general COCO fallback detector

@app.on_event("startup")
async def startup():
    global db_pool, redis_pool, yolo_model, general_model

    db_pool    = await asyncpg.create_pool(DB_URL, min_size=2, max_size=10)
    redis_pool = await aioredis.from_url(REDIS_URL, decode_responses=True)
    print("✅ FastAPI connected to PostgreSQL + Redis")

    # Load YOLO inside startup so import errors don't crash the whole server
    try:
        from ultralytics import YOLO
        if os.path.exists(MODEL_PATH):
            yolo_model = YOLO(MODEL_PATH)
            print(f"✅ YOLOv8 model loaded from {MODEL_PATH}")
        else:
            print(f"⚠️  YOLO model not found at {MODEL_PATH} — running without visual verification")

        # General COCO fallback detector (so arbitrary refund photos are still detected).
        if os.path.exists(GENERAL_MODEL_PATH):
            general_model = YOLO(GENERAL_MODEL_PATH)
            print(f"✅ General fallback detector loaded from {GENERAL_MODEL_PATH}")
        else:
            print(f"ℹ️  General fallback detector not found at {GENERAL_MODEL_PATH} — refund photos rely on the retail model only")
    except Exception as e:
        print(f"⚠️  YOLO load failed ({e}) — running without visual verification")

    # Train/load the local prompt-injection LSTM (Stage-2 classifier).
    try:
        if injection_model.load_or_train():
            print("✅ Prompt-injection LSTM ready (Stage-2 security classifier)")
        else:
            print("⚠️  Prompt-injection LSTM disabled (torch not installed)")
    except Exception as e:
        print(f"⚠️  Injection model init failed ({e}) — Stage-2 classifier disabled")

@app.on_event("shutdown")
async def shutdown():
    if db_pool:    await db_pool.close()
    if redis_pool: await redis_pool.close()


# ── MODELS ─────────────────────────────────────────────────────────────────────
class VerifyRequest(BaseModel):
    barcode:  str
    shop_id:  int
    mk_id:    Optional[str] = None   # Manufacturer serial number (MK ID)

class MatchRequest(BaseModel):
    barcode_value: str
    product_ocr:   Optional[str] = ""
    barcode_ocr:   Optional[str] = ""
    yolo_label:    Optional[str] = ""
    image_b64:     Optional[str] = None   # base64 image — triggers YOLO inference


class AuditImage(BaseModel):
    """A single image to inspect, tagged with where it came from."""
    source:    str                              # product | delivery | checkout
    image_b64: str


class AuditClaimRequest(BaseModel):
    """High-tier visual verification of a post-purchase return claim.

    Supports two purchase channels:
      • offline → only the product image captured at in-store checkout is checked.
      • online  → the product image (at dispatch) AND the delivery photo are
                  both checked, so a seal that was intact at sale but broken in
                  transit can be detected.
    """
    claim_type:         str                          # broken_label | damaged | seal | wrong_size | wrong_item
    channel:            Optional[str] = "offline"    # offline | online
    checkout_image_b64: Optional[str] = None         # product image at checkout/dispatch (a.k.a. Customer DB)
    delivery_image_b64: Optional[str] = None         # delivery photo (Delivery DB) — online only
    customer_image_b64: Optional[str] = None         # photo the CUSTOMER uploads at refund time (current condition)
    images:             Optional[List[AuditImage]] = None  # generic multi-image alternative
    transaction_id:     Optional[str] = None
    reference_label:    Optional[str] = None         # expected product (from inventory)


class InjectionCheckRequest(BaseModel):
    """Stage-2 prompt-injection classification request."""
    text: str


class PurchaseVerifyRequest(BaseModel):
    """Anti-fraud: verify the complained product is in the user's purchase history."""
    user_id:        str                          # customer identifier
    transaction_id: Optional[str] = None         # the receipt transaction number
    mk_id:          Optional[str] = None         # explicit MK-ID (if scanned/typed)
    barcode:        Optional[str] = None         # explicit barcode (alternative key)
    image_b64:      Optional[str] = None         # complaint photo — OCR'd for the MK-ID/barcode
    complaint_text: Optional[str] = None


class RefundVerifyRequest(BaseModel):
    """Transaction-anchored refund verification.

    The whole decision hinges on transaction_id: we look up what was sold under
    that transaction, then confirm the customer's uploaded photo (and stated
    product name) match it. If they match -> refund possible; otherwise not.
    """
    transaction_id: str                          # REQUIRED anchor
    image_b64:      Optional[str] = None          # photo of the product being returned
    product_name:   Optional[str] = None          # product name the customer states


# ── HELPER ─────────────────────────────────────────────────────────────────────
def compute_fraud_risk(db_product: Optional[dict], yolo_label: str, ocr_text: str) -> float:
    """
    Rule-based fraud risk scorer (0.0 – 1.0).
    YOLO label + OCR text are fuzzy-matched against the DB product name.
    Uses partial_ratio for YOLO (class names are often abbreviated)
    and token_set_ratio for OCR (text may contain extra noise).
    """
    if db_product is None:
        return 0.95  # not in inventory → very high risk

    db_name = db_product.get("product_name", "")

    # YOLO class labels are short/abbreviated — use partial_ratio for leniency
    if yolo_label:
        yolo_score = max(
            fuzz.partial_ratio(yolo_label.lower(), db_name.lower()),
            fuzz.token_set_ratio(yolo_label.lower(), db_name.lower())
        ) / 100
    else:
        yolo_score = 0.5  # no YOLO data — neutral

    # OCR text from product image — use token_set_ratio (robust to extra words)
    if ocr_text and ocr_text.strip():
        ocr_score = max(
            fuzz.partial_ratio(ocr_text.lower(), db_name.lower()),
            fuzz.token_set_ratio(ocr_text.lower(), db_name.lower())
        ) / 100
    else:
        ocr_score = 0.5  # no OCR data — neutral

    # If YOLO is not available, rely more on OCR; if both present, weight YOLO less
    # since class labels are unreliable compared to OCR text
    if yolo_label:
        match_score = (yolo_score * 0.4 + ocr_score * 0.6)
    else:
        match_score = ocr_score

    return round(max(0.0, 1.0 - match_score), 2)


def run_yolo(image_b64: str) -> list[str]:
    """
    Decode a base64 image, run YOLOv8 inference, return detected class names.
    Returns [] if YOLO is not loaded or inference fails.
    """
    if yolo_model is None:
        return []
    try:
        img_bytes = base64.b64decode(image_b64)
        img_array = np.frombuffer(img_bytes, np.uint8)
        img       = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
        results   = yolo_model(img, verbose=False)
        return [
            yolo_model.names[int(b.cls)]
            for r in results
            for b in r.boxes
        ]
    except Exception as e:
        print(f"YOLO inference error: {e}")
        return []


def _decode_image(image_b64: str):
    """Decode a base64 (optionally data-URL) image into an OpenCV BGR array."""
    if "," in image_b64 and image_b64.strip().startswith("data:"):
        image_b64 = image_b64.split(",", 1)[1]
    img_bytes = base64.b64decode(image_b64)
    img_array = np.frombuffer(img_bytes, np.uint8)
    return cv2.imdecode(img_array, cv2.IMREAD_COLOR)


def run_yolo_detailed(img) -> list[dict]:
    """Run the retail detector; if it finds nothing, fall back to the general
    COCO detector so arbitrary customer/refund photos still yield a detection.
    Returns [{label, conf, model}, ...] sorted by confidence desc."""
    if img is None:
        return []

    def _run(model, tag):
        if model is None:
            return []
        try:
            results = model(img, verbose=False)
            return [
                {"label": model.names[int(b.cls)], "conf": float(b.conf), "model": tag}
                for r in results for b in r.boxes
            ]
        except Exception as e:
            print(f"YOLO detailed inference error ({tag}): {e}")
            return []

    dets = _run(yolo_model, "retail")
    if not dets:                       # narrow model saw nothing → try the general one
        dets = _run(general_model, "general")
    return sorted(dets, key=lambda d: d["conf"], reverse=True)


# Threshold above which the product/label is considered cleanly "intact" in
# the checkout image. Below it, a damage/broken-label claim is plausible.
AUDIT_INTACT_THRESHOLD = float(os.getenv("AUDIT_INTACT_THRESHOLD", "0.55"))


# Lazy EasyOCR reader (heavy) — only initialised the first time we OCR a photo.
_ocr_reader = None


def _ocr_texts(img) -> list[str]:
    """Read text fragments from an image (used to recover the MK-ID/barcode).
    Fails soft to [] if EasyOCR isn't installed or inference errors."""
    global _ocr_reader
    if img is None:
        return []
    try:
        if _ocr_reader is None:
            import easyocr
            _ocr_reader = easyocr.Reader(["en"], gpu=False)
        return [t for (_b, t, c) in _ocr_reader.readtext(img) if c and c > 0.3]
    except Exception as e:
        print(f"[recognize] OCR unavailable ({e})")
        return []


def recognize_mk_id(img, provided_mk_id=None, provided_barcode=None):
    """
    Recognise the product identity for a complaint photo.
    Order: explicit MK-ID > explicit barcode > OCR the photo for an MK-ID/barcode.
    Returns (mk_id, barcode, method).
    """
    if provided_mk_id:
        return provided_mk_id.strip().upper(), (provided_barcode or None), "provided_mk_id"
    if provided_barcode:
        return None, provided_barcode.strip(), "provided_barcode"
    texts = _ocr_texts(img)
    mk = purchase_verifier.extract_mk_id_from_texts(texts)
    if mk:
        return mk, None, "ocr_mk_id"
    bc = purchase_verifier.extract_barcode_from_texts(texts)
    if bc:
        return None, bc, "ocr_barcode"
    return None, None, "unrecognized"


# ── Transaction-anchored refund matching thresholds (env-overridable) ─────────
REFUND_VISUAL_MATCH = float(os.getenv("REFUND_VISUAL_MATCH", "0.12"))  # ORB good-match ratio
REFUND_OCR_MATCH    = float(os.getenv("REFUND_OCR_MATCH", "0.60"))     # OCR text vs product name
REFUND_NAME_MATCH   = float(os.getenv("REFUND_NAME_MATCH", "0.50"))    # stated name vs sold name


def _image_similarity(img_a, img_b) -> float:
    """ORB feature-match ratio between two images (0..1). Used to confirm the
    uploaded photo matches the product image stored for the transaction."""
    if img_a is None or img_b is None:
        return 0.0
    try:
        ga = cv2.cvtColor(img_a, cv2.COLOR_BGR2GRAY)
        gb = cv2.cvtColor(img_b, cv2.COLOR_BGR2GRAY)
        orb = cv2.ORB_create(nfeatures=600)
        ka, da = orb.detectAndCompute(ga, None)
        kb, db = orb.detectAndCompute(gb, None)
        if da is None or db is None or len(ka) == 0 or len(kb) == 0:
            return 0.0
        bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
        matches = bf.match(da, db)
        good = [m for m in matches if m.distance <= 64]
        return round(min(1.0, len(good) / max(1, min(len(ka), len(kb)))), 3)
    except Exception as e:
        print(f"[verify-refund] ORB error: {e}")
        return 0.0


# ─────────────────────────────────────────────────────────────────────────────
# ROUTES
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"service": "SmartRetail FastAPI Engine", "status": "running"}


@app.get("/health")
async def health():
    try:
        async with db_pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        await redis_pool.ping()
        yolo_status = "loaded" if yolo_model is not None else "not_loaded"
        return {
            "db": "connected",
            "redis": "connected",
            "yolo": yolo_status,
            "general_detector": "loaded" if general_model is not None else "not_loaded",
            "injection_lstm": "ready" if injection_model.is_ready() else "disabled",
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


# ── POST /security/injection-check — Stage-2 LSTM prompt-injection classifier ──
@app.post("/security/injection-check")
async def injection_check(req: InjectionCheckRequest):
    """
    Self-hosted Stage-2 classifier. The Node gateway calls this after its fast
    regex Stage-1 pass. Returns whether the input is a prompt-injection attempt,
    the model's probability score, and the decision threshold used.

    Fails soft: if torch/the model is unavailable, returns available=false so the
    caller can fail-open (Stage-1 regex still protects the system).
    """
    text = (req.text or "").strip()
    if not text:
        return {"available": injection_model.is_ready(), "injection": False,
                "score": 0.0, "confidence": 0.0, "label": "safe"}
    return injection_model.predict(text)


# ── POST /audit/verify-purchase — anti-fraud purchase-history check ───────────
@app.post("/audit/verify-purchase")
async def verify_purchase(req: PurchaseVerifyRequest):
    """
    Recognise the product in the complaint photo (or use a provided MK-ID/barcode)
    and verify it exists in the user's purchase history. Mirrors the reference
    flow: recognise -> look up user -> cross-reference -> APPROVED / REJECTED.
    """
    img = None
    if req.image_b64 and not (req.mk_id or req.barcode):
        try:
            img = _decode_image(req.image_b64)
        except Exception:
            img = None
    mk_id, barcode, method = recognize_mk_id(img, req.mk_id, req.barcode)
    result = await purchase_verifier.verify_complaint(db_pool, req.user_id, mk_id, barcode, req.transaction_id)
    result["recognized_mk_id"] = mk_id
    result["recognized_barcode"] = barcode
    result["recognition_method"] = method
    return result


# ── POST /audit/verify-refund — transaction-anchored refund verification ──────
@app.post("/audit/verify-refund")
async def verify_refund(req: RefundVerifyRequest):
    """
    The whole decision hinges on transaction_id:
      1. Look up what was sold under this transaction (barcode + stored image).
      2. Resolve the product name (from MOCK_DB by barcode).
      3. Match the customer's uploaded photo to the stored product image
         (visual ORB) and/or OCR the product name from it.
      4. Cross-check the stated product name against what was sold.
      -> refund_possible = product exists for this txn AND the photo matches.
    """
    out = {"transaction_id": req.transaction_id, "refund_possible": False, "reason": None, "message": None}

    # 1. Transaction lookup (the anchor).
    stored_b64, barcode = None, None
    if db_pool is not None:
        try:
            async with db_pool.acquire() as conn:
                row = await conn.fetchrow(
                    "SELECT barcode, image_b64 FROM checkout_images WHERE transaction_id = $1 "
                    "ORDER BY created_at DESC LIMIT 1",
                    req.transaction_id,
                )
            if row:
                barcode, stored_b64 = row["barcode"], row["image_b64"]
        except Exception as e:
            print(f"[verify-refund] transaction lookup failed: {e}")
            out["reason"] = "lookup_error"
            out["message"] = "I couldn't access the transaction records right now. Please try again shortly."
            return out

    if barcode is None and stored_b64 is None:
        out["reason"] = "transaction_not_found"
        out["message"] = (f"No purchase was found for transaction {req.transaction_id}. "
                          f"Refund not possible — please double-check the transaction ID on your receipt.")
        return out

    # 2. Resolve the product that was sold.
    try:
        from ai_core import MOCK_DB
    except Exception:
        MOCK_DB = {}
    sold = MOCK_DB.get(barcode) if barcode else None
    sold_name = sold["product_name"] if sold else None
    out["product_name"] = sold_name or req.product_name

    # 3. We need the customer's photo to match against the purchase.
    up = None
    if req.image_b64:
        try:
            up = _decode_image(req.image_b64)
        except Exception:
            up = None
    if up is None:
        out["reason"] = "no_image"
        out["message"] = "Please upload a clear photo of the product so I can match it to your purchase."
        return out

    # Visual match (uploaded photo vs the image stored at checkout for this txn).
    visual = 0.0
    if stored_b64:
        try:
            visual = _image_similarity(up, _decode_image(stored_b64))
        except Exception:
            visual = 0.0

    # OCR the photo and fuzzy-match it against the product name sold in this txn.
    ocr_score = 0.0
    name_target = sold_name or req.product_name
    if name_target:
        texts = _ocr_texts(up)
        if texts:
            ocr_score = max((fuzz.token_set_ratio(name_target.lower(), t.lower()) for t in texts), default=0) / 100.0

    # Stated product name vs the name actually sold (cross-check).
    name_match = True
    if req.product_name and sold_name:
        name_match = (fuzz.token_set_ratio(req.product_name.lower(), sold_name.lower()) / 100.0) >= REFUND_NAME_MATCH

    image_matched = (visual >= REFUND_VISUAL_MATCH) or (ocr_score >= REFUND_OCR_MATCH)
    out.update({"visual_score": visual, "ocr_name_score": round(ocr_score, 3),
                "name_match": name_match, "barcode": barcode})

    # 4. Decide.
    if image_matched and name_match:
        out["refund_possible"] = True
        out["reason"] = "verified"
        out["message"] = (f"Refund possible — the photo matches "
                          f"{out['product_name'] or 'the purchased item'} from transaction {req.transaction_id}.")
    elif not name_match:
        out["reason"] = "product_name_mismatch"
        out["message"] = (f"Refund not possible — the product name you gave doesn't match what was bought in "
                          f"transaction {req.transaction_id}" + (f" ({sold_name})" if sold_name else "") + ".")
    else:
        out["reason"] = "image_mismatch"
        out["message"] = (f"Refund not possible — the uploaded photo doesn't match the product purchased in "
                          f"transaction {req.transaction_id}" + (f" ({sold_name})" if sold_name else "") + ".")
    return out


# ── POST /verify — called by Node.js checkout gateway ─────────────────────────
@app.post("/verify")
async def verify_barcode(req: VerifyRequest):
    """
    Primary endpoint for HID scanner → checkout terminal flow.
    Looks up the barcode in the products table and returns
    product info + initial fraud risk score.
    Node.js applies Redis intelligence on top.
    """
    async with db_pool.acquire() as conn:
        product = await conn.fetchrow(
            "SELECT product_name, price, quantity, barcode_format "
            "FROM products WHERE barcode=$1 AND shop_id=$2",
            req.barcode, req.shop_id
        )

    if product is None:
        await _log_audit(req.shop_id, req.barcode, None, "blocked", 0.95)
        return {
            "status":         "blocked",
            "product_name":   None,
            "price":          None,
            "quantity":       None,
            "barcode_format": "UNKNOWN",
            "fraud_risk":     0.95,
            "message":        f"Barcode {req.barcode} not found in inventory — transaction blocked.",
        }

    product    = dict(product)
    fraud_risk = 0.05   # base risk for known products; YOLO/match raises this

    if product["quantity"] is not None and product["quantity"] <= 0:
        status     = "blocked"
        fraud_risk = 0.3
    elif fraud_risk > 0.6:
        status = "blocked"
    elif fraud_risk > 0.3:
        status = "partial"
    else:
        status = "approved"

    await _log_audit(req.shop_id, req.barcode, product["product_name"], status, fraud_risk)

    # MK ID validation (if provided) — checks against mock DB
    mk_id_valid = None
    mk_id_message = None
    if req.mk_id:
        from ai_core import validate_mk_id, MOCK_DB
        mk_id_valid = validate_mk_id(req.barcode, req.mk_id)
        if not mk_id_valid:
            mk_id_message = f"MK ID '{req.mk_id}' does not match barcode {req.barcode} — possible counterfeit unit."
            fraud_risk = min(1.0, fraud_risk + 0.35)
            status = "blocked"

    response = {
        "status":         status,
        "product_name":   product["product_name"],
        "price":          float(product["price"]) if product["price"] else None,
        "quantity":       product["quantity"],
        "barcode_format": product["barcode_format"] or "EAN-13",
        "fraud_risk":     fraud_risk,
        "message":        mk_id_message or f"Product: {product['product_name']}",
    }
    if req.mk_id:
        response["mk_id"] = req.mk_id
        response["mk_id_valid"] = mk_id_valid
    return response


# ── GET /mk-ids — List valid MK IDs for a barcode (demo helper) ────────────────
@app.get("/mk-ids")
async def get_mk_ids(barcode: str):
    """Return the list of valid manufacturer serial numbers for a given barcode."""
    from ai_core import MOCK_DB
    product = MOCK_DB.get(barcode)
    if not product:
        return {"found": False, "barcode": barcode, "mk_ids": []}
    return {
        "found": True,
        "barcode": barcode,
        "product_name": product["product_name"],
        "mk_ids": product.get("mk_ids", []),
    }


# ── POST /match — image upload + YOLO integration point ───────────────────────
@app.post("/match")
async def match_verify(req: MatchRequest):
    """
    Called from home.html image-upload flow and optionally from the
    checkout terminal when a camera image is available.

    Flow:
      1. If image_b64 is provided → run YOLO to detect product label
      2. Look up barcode in DB
      3. Fuzzy-match yolo_label + OCR text against DB product name
      4. Return fraud risk + match verdict
    """
    # Step 1 — YOLO inference if image provided
    yolo_label = req.yolo_label or ""
    if req.image_b64:
        detected = run_yolo(req.image_b64)
        if detected:
            yolo_label = " ".join(detected)
            print(f"🔍 YOLO detected: {yolo_label}")

    # Step 2 — DB lookup (barcode is globally unique across shops)
    async with db_pool.acquire() as conn:
        product = await conn.fetchrow(
            "SELECT product_name, price, quantity, barcode_format "
            "FROM products WHERE barcode=$1",
            req.barcode_value
        )

    if product is None:
        return {
            "found":        False,
            "match":        False,
            "confidence":   0,
            "fraud_type":   "BARCODE_NOT_FOUND",
            "product_name": None,
        }

    product = dict(product)

    # Step 3 — Fraud risk scoring
    combined_ocr = (req.product_ocr or "") + " " + (req.barcode_ocr or "")
    fraud_risk   = compute_fraud_risk(product, yolo_label, combined_ocr)
    yolo_conf    = fuzz.token_sort_ratio(
        yolo_label.lower(), product["product_name"].lower()
    ) if yolo_label else 50

    fraud_type = None
    if fraud_risk > 0.7 and yolo_label:
        fraud_type = "LABEL_SWAP" if yolo_conf < 30 else "PARTIAL_MISMATCH"
    elif fraud_risk > 0.55:
        fraud_type = "LOW_CONFIDENCE"

    return {
        "found":          True,
        "match":          fraud_risk <= 0.5,
        "confidence":     max(0, 100 - int(fraud_risk * 100)),
        "fraud_type":     fraud_type,
        "fraud_risk":     fraud_risk,
        "product_name":   product["product_name"],
        "price":          float(product["price"]) if product["price"] else None,
        "quantity":       product["quantity"],
        "barcode_format": product["barcode_format"],
        "yolo_label":     yolo_label or None,
    }


# ── GET /inventory ─────────────────────────────────────────────────────────────
@app.get("/inventory")
async def get_inventory(shop_id: int):
    async with db_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT barcode, product_name, price, quantity, barcode_format, created_at "
            "FROM products WHERE shop_id=$1 ORDER BY product_name",
            shop_id
        )
    return {"products": [dict(r) for r in rows]}


# ── GET /audit-log ─────────────────────────────────────────────────────────────
@app.get("/audit-log")
async def get_audit_log(shop_id: int, limit: int = 100):
    async with db_pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT barcode, product_name, status, fraud_risk, barcode_format, scanned_at
               FROM transactions WHERE shop_id=$1
               ORDER BY scanned_at DESC LIMIT $2""",
            shop_id, limit
        )
    return {"logs": [dict(r) for r in rows]}


# ── POST /audit/verify-claim — HIGH-TIER post-purchase visual verification ────
def _analyze_intactness(img) -> dict:
    """
    Assess whether a product/seal looks INTACT in one image.

    We don't ship a dedicated seal-tamper model, so detection confidence + image
    sharpness are used as an intactness proxy: a clean, high-confidence, sharp
    detection implies the product/seal was intact; a poorly-resolved/occluded/
    blurry detection is consistent with damage or a broken seal. A production
    deployment would swap a fine-tuned seal-integrity model behind this contract.
    """
    dets      = run_yolo_detailed(img) if img is not None else []
    top_conf  = dets[0]["conf"]  if dets else 0.0
    top_label = dets[0]["label"] if dets else None
    try:
        gray      = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    except Exception:
        sharpness = 0.0
    model_available = bool(dets)   # a detection from EITHER the retail or general model
    # intact is True/False only when the model actually located a product; when it
    # couldn't (model not loaded or nothing detected) it's None → "inconclusive",
    # NOT "damaged" (avoids mislabeling an unreadable photo as damaged).
    intact = (top_conf >= AUDIT_INTACT_THRESHOLD and sharpness >= 50.0) if model_available else None
    return {
        "top_label":       top_label,
        "top_conf":        round(top_conf, 3),
        "sharpness":       round(sharpness, 1),
        "intact":          intact,
        "model_available": model_available,
        "detections":      dets[:5],
    }


def _collect_images(req: "AuditClaimRequest") -> list[dict]:
    """Build an ordered list of {source, image_b64} from the request, supporting
    both the explicit `images` array and the legacy checkout/delivery fields."""
    out = []
    seen = set()

    def add(source, b64):
        if b64 and source not in seen:
            out.append({"source": source, "image_b64": b64})
            seen.add(source)

    if req.images:
        for im in req.images:
            add((im.source or "product").lower(), im.image_b64)
    add("customer", req.customer_image_b64)
    add("product", req.checkout_image_b64)
    if (req.channel or "offline").lower() == "online":
        add("delivery", req.delivery_image_b64)
    return out


@app.post("/audit/verify-claim")
async def verify_claim(req: AuditClaimRequest):
    """
    The Conversational Auditor's High-tier vision step.

    Scenario 1 (offline / in-store): inspect the product image captured at
    checkout (Customer DB) and decide whether the seal/product was intact at
    purchase — contradicting or supporting a "broken item / broken seal" claim.

    Scenario 2 (online): inspect BOTH the product image at dispatch (Customer DB)
    and the delivery photo (Delivery DB). If the seal looked intact at dispatch
    but compromised at delivery, the damage happened in transit and the claim is
    supported; if intact in both, the claim is contradicted.

    Returns:
      claim_supported : True / False / None (inconclusive → manual review)
      confidence      : 0.0–1.0
      finding         : human-readable explanation
      channel         : offline | online
      images          : per-image findings [{source, intact, top_label, ...}]
    """
    channel = (req.channel or "offline").lower()
    claim   = (req.claim_type or "damaged").lower()
    imgs    = _collect_images(req)

    if not imgs:
        return {"claim_supported": None, "confidence": 0.0, "channel": channel,
                "finding": "No images available to verify the claim.", "images": []}

    # Decode + analyse each provided image.
    analyses = []
    for entry in imgs:
        try:
            img = _decode_image(entry["image_b64"])
        except Exception as e:
            analyses.append({"source": entry["source"], "error": f"decode failed ({e})",
                             "intact": None, "model_available": False})
            continue
        if img is None:
            analyses.append({"source": entry["source"], "error": "decode failed",
                             "intact": None, "model_available": False})
            continue
        a = _analyze_intactness(img)
        a["source"] = entry["source"]
        analyses.append(a)

    by_source = {a["source"]: a for a in analyses}
    customer = by_source.get("customer")
    product  = by_source.get("product") or by_source.get("checkout")
    delivery = by_source.get("delivery")

    # ── wrong_item / wrong_size — compare detected vs expected label ──────────
    if claim in ("wrong_item", "wrong_size"):
        ref = req.reference_label
        cand = product or (analyses[0] if analyses else None)
        if ref and cand and cand.get("top_label"):
            score = fuzz.token_set_ratio(ref.lower(), cand["top_label"].lower()) / 100
            supported = score < 0.5
            return {"claim_supported": bool(supported),
                    "confidence": round(abs(0.5 - score) * 2, 2), "channel": channel,
                    "finding": f"Image shows '{cand['top_label']}' vs expected '{ref}' "
                               f"(match {round(score*100)}%).",
                    "images": analyses}
        return {"claim_supported": None, "confidence": 0.3, "channel": channel,
                "finding": "Size/item claims need the original reference product to compare — "
                           "routed to manual review.",
                "images": analyses}

    # ── broken / damaged / seal claims — intactness reasoning ─────────────────
    # If we never got a usable detection from any image, we can't assert intactness.
    if not any(a.get("model_available") for a in analyses):
        return {"claim_supported": None, "confidence": 0.2, "channel": channel,
                "finding": "The visual model could not confidently locate the product/seal in the "
                           "provided image(s) — manual review recommended.",
                "images": analyses}

    # ── PRIMARY: a photo the customer uploaded at refund time ─────────────────
    # The decision is driven by whether THAT photo shows a damaged product:
    #   damaged → claim supported → APPROVED ;  intact/undamaged → DENIED.
    if customer is not None:
        if not customer.get("model_available"):
            return {"claim_supported": None, "confidence": 0.25, "channel": channel,
                    "finding": "I couldn't clearly identify a product in the photo you uploaded. "
                               "Please upload a clearer, well-lit photo of the item.",
                    "images": analyses}
        damaged = not customer["intact"]
        if damaged:
            note = ""
            # If we also have the purchase image and it was intact, the damage is post-sale.
            if product and product.get("model_available") and product["intact"]:
                note = " It looked intact at purchase, so the damage appears to have occurred afterwards."
            return {"claim_supported": True,
                    "confidence": round(min(0.95, 1.0 - customer["top_conf"] + 0.2), 2),
                    "channel": channel,
                    "finding": f"The photo you uploaded shows the product is damaged / not in intact "
                               f"condition (detection {round(customer['top_conf']*100)}%, "
                               f"sharpness {round(customer['sharpness'])}).{note}",
                    "images": analyses}
        return {"claim_supported": False,
                "confidence": round(min(0.99, customer["top_conf"]), 2), "channel": channel,
                "finding": f"The photo you uploaded shows the product appears intact / undamaged "
                           f"({customer['top_label']}, {round(customer['top_conf']*100)}% detection), "
                           f"so the '{claim}' claim isn't supported.",
                "images": analyses}

    if channel == "online":
        # Need the product image at minimum; delivery photo strengthens the verdict.
        if not product or not product.get("model_available"):
            return {"claim_supported": None, "confidence": 0.25, "channel": channel,
                    "finding": "Could not resolve the product image captured at dispatch — manual review.",
                    "images": analyses}

        if delivery is None or not delivery.get("model_available"):
            # Fall back to product-only reasoning, but flag the missing delivery photo.
            intact = product["intact"]
            return {"claim_supported": (not intact),
                    "confidence": round(min(0.9, product["top_conf"] if intact else 1.0 - product["top_conf"] + 0.2), 2),
                    "channel": channel,
                    "finding": ("No delivery photo was available, so only the dispatch image was checked. "
                                + ("It appears intact at dispatch — a transit-damage claim can't be confirmed "
                                   "from images alone, routing for review." if intact
                                   else "The product/seal was poorly resolved at dispatch, consistent with the claim.")),
                    "images": analyses,
                    "note": "MISSING_DELIVERY_IMAGE"}

        prod_intact = product["intact"]
        deli_intact = delivery["intact"]
        if prod_intact and not deli_intact:
            return {"claim_supported": True,
                    "confidence": round(min(0.95, 1.0 - delivery["top_conf"] + 0.25), 2),
                    "channel": channel,
                    "finding": f"Seal was intact at dispatch ({product['top_label']}, "
                               f"{round(product['top_conf']*100)}%) but compromised in the delivery photo "
                               f"(detection {round(delivery['top_conf']*100)}%, sharpness {round(delivery['sharpness'])}) "
                               f"— consistent with damage in transit.",
                    "images": analyses}
        if not prod_intact:
            return {"claim_supported": True,
                    "confidence": round(min(0.9, 1.0 - product["top_conf"] + 0.2), 2),
                    "channel": channel,
                    "finding": "The product/seal was already poorly resolved in the dispatch image, "
                               "consistent with the reported condition.",
                    "images": analyses}
        # both intact
        return {"claim_supported": False,
                "confidence": round(min(0.95, (product["top_conf"] + delivery["top_conf"]) / 2), 2),
                "channel": channel,
                "finding": f"Seal appears intact in BOTH the dispatch image "
                           f"({round(product['top_conf']*100)}%) and the delivery photo "
                           f"({round(delivery['top_conf']*100)}%) — the '{claim}' claim is not supported.",
                "images": analyses}

    # ── offline (in-store): single product image at checkout ──────────────────
    cand = product or next((a for a in analyses if a.get("model_available")), None)
    if cand is None:
        return {"claim_supported": None, "confidence": 0.2, "channel": channel,
                "finding": "No usable product image — manual review.", "images": analyses}

    if cand["intact"]:
        return {"claim_supported": False,
                "confidence": round(min(0.99, cand["top_conf"]), 2), "channel": channel,
                "finding": f"At checkout the product/seal was clearly visible "
                           f"({cand['top_label']}, {round(cand['top_conf']*100)}% detection) and appears intact, "
                           f"contradicting the '{claim}' claim.",
                "images": analyses}
    return {"claim_supported": True,
            "confidence": round(min(0.95, 1.0 - cand["top_conf"] + 0.2), 2), "channel": channel,
            "finding": f"The product/seal was poorly resolved at checkout "
                       f"(detection {round(cand['top_conf']*100)}%, sharpness {round(cand['sharpness'])}), "
                       f"consistent with a '{claim}' condition.",
            "images": analyses}


# ── Internal audit helper ──────────────────────────────────────────────────────
async def _log_audit(
    shop_id: int,
    barcode: str,
    product_name: Optional[str],
    status: str,
    fraud_risk: float,
):
    try:
        async with db_pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO audit_log (shop_id, barcode, product_name, status, fraud_risk, logged_at)
                   VALUES ($1,$2,$3,$4,$5,$6)""",
                shop_id, barcode, product_name, status, fraud_risk, datetime.utcnow()
            )
    except Exception as e:
        print(f"Audit log error: {e}")