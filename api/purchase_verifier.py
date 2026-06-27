"""
SmartRetail — Purchase Verification Engine (anti-fraud refund check)
────────────────────────────────────────────────────────────────────
When a customer uploads a photo to complain about a product, we recognise the
product's MK-ID (manufacturer serial) and check whether that MK-ID exists in
THAT user's purchase history (the "checkout database"). A refund can only be
processed for an item the user actually bought.

This is the production, DB-backed version of the reference flow:
    recognise product -> look up user -> cross-reference mk_id -> approve / reject

The recognition step (image -> mk_id) is performed by the caller (see
recognize_mk_id in main.py). This module owns the verification logic only, so it
stays simple and testable.
"""

from typing import Optional
import re

# MK-IDs look like "MK-MILO-2024-A001" / "MK-NVA-2024-C301".
MK_ID_RE = re.compile(r"MK-[A-Z0-9]+-\d{4}-[A-Z0-9]+", re.IGNORECASE)
# Tolerant variants: OCR frequently drops/mangles the hyphens or splits the
# serial across boxes, so we also accept the parts with arbitrary separators.
MK_ID_LOOSE_RE   = re.compile(r"MK[\s\-]*([A-Z]{2,})[\s\-]*(\d{4})[\s\-]*([A-Z][A-Z0-9]+)")
MK_ID_SQUASH_RE  = re.compile(r"MK([A-Z]{2,})(\d{4})([A-Z]\d{2,4})")
# A plain product barcode (UPC-A / EAN-13).
BARCODE_RE = re.compile(r"\b\d{12,13}\b")


def extract_mk_id_from_texts(texts) -> Optional[str]:
    """Find an MK-ID in OCR text fragments.

    OCR often splits a serial across boxes or drops the hyphens, so we try, in
    order of confidence:
      1. a strict match inside any single fragment;
      2. a tolerant match over all fragments joined together (separators may be
         missing/misread), reconstructing the canonical MK-CODE-YYYY-SUFFIX form;
      3. the same with every non-alphanumeric character removed.
    """
    frags = [(t or "").upper() for t in (texts or [])]

    # 1) strict, per fragment
    for t in frags:
        m = MK_ID_RE.search(t.replace(" ", ""))
        if m:
            return m.group(0)

    # 2) tolerant over the whole read (keeps fragment gaps as separators)
    joined = " ".join(frags)
    m = MK_ID_LOOSE_RE.search(joined)
    if m:
        return f"MK-{m.group(1)}-{m.group(2)}-{m.group(3)}"

    # 3) last resort: strip all separators ("MKMILO2024A001")
    squashed = re.sub(r"[^A-Z0-9]", "", joined)
    m = MK_ID_SQUASH_RE.search(squashed)
    if m:
        return f"MK-{m.group(1)}-{m.group(2)}-{m.group(3)}"

    return None


def extract_barcode_from_texts(texts) -> Optional[str]:
    for t in texts or []:
        m = BARCODE_RE.search((t or "").replace(" ", ""))
        if m:
            return m.group(0)
    return None


async def get_user_purchases(db_pool, user_id: str):
    """Return the user's purchase history rows, or None if the store is unavailable."""
    if db_pool is None or not user_id:
        return None
    try:
        async with db_pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT order_id, mk_id, barcode, product_name, purchased_at, customer_name
                     FROM customer_purchases WHERE user_id = $1
                    ORDER BY purchased_at DESC""",
                user_id,
            )
        return [dict(r) for r in rows]
    except Exception as e:
        print(f"[purchase_verifier] history query failed: {e}")
        return None


async def verify_complaint(db_pool, user_id: str, mk_id: "Optional[str]", barcode: "Optional[str]" = None,
                           transaction_id: "Optional[str]" = None) -> dict:
    """
    Cross-reference a recognised product against the user's purchase history
    AND (optionally) a specific transaction.

    Flow:
      1. If transaction_id is provided → look up the barcode sold in that txn
         (from checkout_images) and resolve its valid MK-IDs (from MOCK_DB).
         The OCR'd MK-ID must be one of those → proves this exact item was sold.
      2. Otherwise → fall back to checking the user's entire purchase history.

    Returns one of:
      APPROVED  — the product is verified (refund may proceed)
      REJECTED  — image unrecognised, user not found, or item never purchased
      REVIEW    — data temporarily unavailable (fail-soft)
    """
    if not mk_id and not barcode:
        return {
            "status": "REJECTED",
            "reason": "image_unrecognized",
            "message": "We couldn't identify a valid product from the photo. Please upload a clearer, "
                       "well-lit picture that shows the product label / serial (MK-ID).",
        }

    # ── Path A: transaction-based verification (strongest proof) ──────────────
    if transaction_id and db_pool:
        try:
            async with db_pool.acquire() as conn:
                row = await conn.fetchrow(
                    "SELECT barcode FROM checkout_images WHERE transaction_id = $1 ORDER BY created_at DESC LIMIT 1",
                    transaction_id,
                )
            if row and row["barcode"]:
                txn_barcode = row["barcode"]
                # Resolve the valid MK-IDs for that barcode from the product DB.
                try:
                    from ai_core import MOCK_DB
                except ImportError:
                    MOCK_DB = {}
                product = MOCK_DB.get(txn_barcode)
                if product:
                    valid_mk_ids = [m.upper() for m in product.get("mk_ids", [])]
                    if mk_id and mk_id.upper() in valid_mk_ids:
                        return {
                            "status": "APPROVED",
                            "reason": "transaction_verified",
                            "message": f"Purchase verified — MK-ID {mk_id} matches {product['product_name']} "
                                       f"sold in transaction {transaction_id}.",
                            "context": {"transaction_id": transaction_id, "product_name": product["product_name"],
                                        "mk_id": mk_id, "barcode": txn_barcode},
                        }
                    if barcode and barcode == txn_barcode:
                        return {
                            "status": "APPROVED",
                            "reason": "transaction_verified",
                            "message": f"Purchase verified — barcode {barcode} matches {product['product_name']} "
                                       f"sold in transaction {transaction_id}.",
                            "context": {"transaction_id": transaction_id, "product_name": product["product_name"],
                                        "barcode": txn_barcode},
                        }
                    # MK-ID/barcode doesn't match what was sold in this txn → reject.
                    return {
                        "status": "REJECTED",
                        "reason": "unverified_item",
                        "message": f"The product in the photo (MK-ID: {mk_id or 'n/a'}) does not match "
                                   f"what was sold in transaction {transaction_id} ({product['product_name']}).",
                    }
                # barcode not in MOCK_DB — can't resolve valid mk_ids, fall through to user history
        except Exception as e:
            print(f"[purchase_verifier] transaction lookup failed: {e}")
            # fall through to user-history check

    # ── Path B: user-history-based verification (fallback) ────────────────────
    purchases = await get_user_purchases(db_pool, user_id)
    if purchases is None:
        return {
            "status": "REVIEW",
            "reason": "history_unavailable",
            "message": "Your purchase history is temporarily unavailable, so I've routed this to a "
                       "store associate for review.",
        }
    if not purchases:
        return {
            "status": "REJECTED",
            "reason": "user_not_found",
            "message": "No purchase history was found for this account.",
        }

    def _match(order):
        if mk_id and (order.get("mk_id") or "").upper() == mk_id.upper():
            return True
        if barcode and (order.get("barcode") or "") == barcode:
            return True
        return False

    match = next((o for o in purchases if _match(o)), None)
    if match:
        return {
            "status": "APPROVED",
            "reason": "purchase_verified",
            "message": f"Purchase verified — you bought {match.get('product_name') or 'this item'}"
                       + (f" (Order {match['order_id']})" if match.get("order_id") else "") + ".",
            "context": {
                "order_id": match.get("order_id"),
                "product_name": match.get("product_name"),
                "mk_id": match.get("mk_id"),
            },
        }
    return {
        "status": "REJECTED",
        "reason": "unverified_item",
        "message": "We can't process this complaint: the product in the photo doesn't match any item "
                   "in your purchase history.",
    }
