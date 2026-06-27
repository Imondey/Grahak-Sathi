"""
SmartRetail — FastAPI Core Verification Engine
Port: 8000

pip install fastapi uvicorn asyncpg rapidfuzz python-dotenv redis aioredis ultralytics opencv-python numpy
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
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


class AuditClaimRequest(BaseModel):
    """High-tier visual verification of a post-purchase return claim."""
    claim_type:         str                     # broken_label | damaged | wrong_size | wrong_item
    checkout_image_b64: Optional[str] = None    # the live image saved at checkout
    transaction_id:     Optional[str] = None
    reference_label:    Optional[str] = None    # expected product (from inventory)


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
@app.post("/audit/verify-claim")
async def verify_claim(req: AuditClaimRequest):
    """
    The Conversational Auditor's High-tier vision step. Examines the live image
    captured at checkout to decide whether the customer's return claim (e.g.
    "the label was broken") is supported by the visual evidence at purchase time.

    Returns:
      claim_supported : True  → evidence supports the claim (refund possible)
                        False → evidence contradicts the claim (item looked intact)
                        None  → inconclusive → route to manual review
      confidence      : 0.0–1.0 confidence in the verdict
      finding         : human-readable explanation

    NOTE: This uses the available YOLO detector as the visual reasoning model.
    Detection confidence on the product/label is used as an "intactness" proxy —
    a clean, high-confidence detection implies the label was intact at checkout,
    so a "broken label" claim is contradicted. A production deployment would swap
    in a fine-tuned label-integrity / damage-classification model behind this
    same contract.
    """
    if not req.checkout_image_b64:
        return {"claim_supported": None, "confidence": 0.0,
                "finding": "No checkout image available to verify the claim."}

    try:
        img = _decode_image(req.checkout_image_b64)
    except Exception as e:
        return {"claim_supported": None, "confidence": 0.0,
                "finding": f"Checkout image could not be decoded ({e})."}

    if img is None:
        return {"claim_supported": None, "confidence": 0.0,
                "finding": "Checkout image could not be decoded."}

    dets = run_yolo_detailed(img)
    top_conf = dets[0]["conf"] if dets else 0.0
    top_label = dets[0]["label"] if dets else None

    # Sharpness as a secondary occlusion/damage cue (variance of Laplacian).
    try:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    except Exception:
        sharpness = 0.0

    claim = (req.claim_type or "damaged").lower()

    if yolo_model is None or not dets:
        # Without a working detector we cannot assert intact-ness either way.
        return {
            "claim_supported": None,
            "confidence": 0.2,
            "finding": "Visual model could not confidently locate the product/label "
                       "in the checkout image — manual review recommended.",
            "top_label": top_label,
            "detections": dets[:5],
        }

    if claim in ("broken_label", "damaged"):
        intact = top_conf >= AUDIT_INTACT_THRESHOLD and sharpness >= 50.0
        if intact:
            # Product/label cleanly visible at checkout → claim contradicted.
            return {
                "claim_supported": False,
                "confidence": round(min(0.99, top_conf), 2),
                "finding": f"At checkout the product/label was clearly visible "
                           f"({top_label}, {round(top_conf*100)}% detection) — it appears intact, "
                           f"contradicting the '{claim}' claim.",
                "top_label": top_label,
                "detections": dets[:5],
            }
        else:
            # Low-confidence/occluded detection → damage claim is plausible.
            return {
                "claim_supported": True,
                "confidence": round(min(0.95, 1.0 - top_conf + 0.2), 2),
                "finding": f"The product/label was poorly resolved at checkout "
                           f"(detection {round(top_conf*100)}%, sharpness {round(sharpness)}), "
                           f"consistent with a '{claim}' condition.",
                "top_label": top_label,
                "detections": dets[:5],
            }

    if claim in ("wrong_item", "wrong_size"):
        if req.reference_label and top_label:
            score = fuzz.token_set_ratio(req.reference_label.lower(), top_label.lower()) / 100
            supported = score < 0.5   # detected item differs from expected → claim supported
            return {
                "claim_supported": bool(supported),
                "confidence": round(abs(0.5 - score) * 2, 2),
                "finding": f"Checkout image shows '{top_label}' vs expected "
                           f"'{req.reference_label}' (match {round(score*100)}%).",
                "top_label": top_label,
                "detections": dets[:5],
            }
        return {
            "claim_supported": None,
            "confidence": 0.3,
            "finding": "Size/item claims need the original reference product to compare — "
                       "routed to manual review.",
            "top_label": top_label,
            "detections": dets[:5],
        }

    return {"claim_supported": None, "confidence": 0.2,
            "finding": f"Unsupported claim type '{claim}' — manual review.",
            "top_label": top_label, "detections": dets[:5]}


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