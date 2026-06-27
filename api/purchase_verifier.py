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

import re

# MK-IDs look like "MK-MILO-2024-A001" / "MK-NVA-2024-C301".
MK_ID_RE = re.compile(r"MK-[A-Z0-9]+-\d{4}-[A-Z0-9]+", re.IGNORECASE)
# A plain product barcode (UPC-A / EAN-13).
BARCODE_RE = re.compile(r"\b\d{12,13}\b")


def extract_mk_id_from_texts(texts) -> str | None:
    """Find the first MK-ID pattern in a list of OCR text fragments."""
    for t in texts or []:
        m = MK_ID_RE.search((t or "").upper().replace(" ", ""))
        if m:
            return m.group(0)
    return None


def extract_barcode_from_texts(texts) -> str | None:
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


async def verify_complaint(db_pool, user_id: str, mk_id: str | None, barcode: str | None = None) -> dict:
    """
    Cross-reference a recognised product against the user's purchase history.

    Returns one of:
      APPROVED  — the product is in the user's history (refund may proceed)
      REJECTED  — image unrecognised, user not found, or item never purchased
      REVIEW    — purchase history temporarily unavailable (fail-soft)
    """
    if not mk_id and not barcode:
        return {
            "status": "REJECTED",
            "reason": "image_unrecognized",
            "message": "We couldn't identify a valid product from the photo. Please upload a clearer, "
                       "well-lit picture that shows the product label / serial.",
        }

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
