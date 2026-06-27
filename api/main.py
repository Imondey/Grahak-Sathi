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

db_pool    = None
redis_pool = None
yolo_model = None   # loaded lazily in startup — never at module level

@app.on_event("startup")
async def startup():
    global db_pool, redis_pool, yolo_model

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
    """Run YOLO and return [{label, conf}, ...] sorted by confidence desc."""
    if yolo_model is None or img is None:
        return []
    try:
        results = yolo_model(img, verbose=False)
        dets = [
            {"label": yolo_model.names[int(b.cls)], "conf": float(b.conf)}
            for r in results
            for b in r.boxes
        ]
        return sorted(dets, key=lambda d: d["conf"], reverse=True)
    except Exception as e:
        print(f"YOLO detailed inference error: {e}")
        return []


# Threshold above which the product/label is considered cleanly "intact" in
# the checkout image. Below it, a damage/broken-label claim is plausible.
AUDIT_INTACT_THRESHOLD = float(os.getenv("AUDIT_INTACT_THRESHOLD", "0.55"))


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
    model_available = yolo_model is not None and bool(dets)
    intact = bool(model_available and top_conf >= AUDIT_INTACT_THRESHOLD and sharpness >= 50.0)
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