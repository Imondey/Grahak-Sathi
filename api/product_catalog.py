"""
SmartRetail — Product serial catalog (lightweight, no ML imports)
─────────────────────────────────────────────────────────────────
The known manufacturer serials (MK-IDs) per barcode. Kept in its own module so
that MK-ID validation (used at checkout and refund) does NOT have to import
ai_core, which loads YOLO + EasyOCR at module import.

In production this would be backed by the products table / a serials table.
"""

MOCK_DB = {
    "8901030823437": {
        "product_name": "Nestle Milo 500g",
        "price": 120.00,
        "barcode_format": "EAN-13",
        "mk_ids": ["MK-MILO-2024-A001", "MK-MILO-2024-A002", "MK-MILO-2024-A003", "MK-MILO-2024-B001", "MK-MILO-2024-B002"]
    },
    "8901491503217": {
        "product_name": "Bournvita 400g",
        "price": 95.00,
        "barcode_format": "EAN-13",
        "mk_ids": ["MK-BRV-2024-X101", "MK-BRV-2024-X102", "MK-BRV-2024-X103", "MK-BRV-2024-Y201", "MK-BRV-2024-Y202"]
    },
    "012345678905": {
        "product_name": "Colgate 150ml",
        "price": 65.00,
        "barcode_format": "UPC-A",
        "mk_ids": ["MK-CLG-2024-P010", "MK-CLG-2024-P011", "MK-CLG-2024-P012", "MK-CLG-2024-Q020", "MK-CLG-2024-Q021"]
    },
    "4006381333931": {
        "product_name": "Nivea Cream 200ml",
        "price": 180.00,
        "barcode_format": "EAN-13",
        "mk_ids": ["MK-NVA-2024-C301", "MK-NVA-2024-C302", "MK-NVA-2024-C303", "MK-NVA-2024-D401", "MK-NVA-2024-D402"]
    },
}


def validate_mk_id(barcode: str, mk_id: str) -> bool:
    """True if mk_id is a known serial for the product identified by barcode.
    Case-insensitive. Returns False if the barcode/serial isn't recognised."""
    product = MOCK_DB.get(barcode)
    if not product or not mk_id:
        return False
    return mk_id.strip().upper() in [m.upper() for m in product.get("mk_ids", [])]


def is_known_barcode(barcode: str) -> bool:
    """True if we have a serial list for this barcode (so MK-ID can be validated)."""
    return barcode in MOCK_DB
