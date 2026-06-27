import os, cv2
import numpy as np
from ultralytics import YOLO
from rapidfuzz import fuzz as rfuzz
from thefuzz import fuzz

# ── Product Database (serials live in the lightweight product_catalog module so
#    MK-ID validation elsewhere doesn't have to import this heavy ML module) ──
from product_catalog import MOCK_DB, validate_mk_id

TRUST_THRESHOLD = 65

# ── Load YOLO model ───────────────────────────────────────────
def load_yolo_model():
    model_path = os.path.join(os.path.dirname(__file__), 'AI_Model', 'best_final.pt')
    if os.path.exists(model_path):
        return YOLO(model_path)
    return YOLO('yolov8n.pt')

yolo_model = load_yolo_model()




def run_yolo_on_image(image_path):
    if not image_path or not os.path.exists(image_path):
        return None
    results = yolo_model(image_path, verbose=False)
    if not results or not results[0].boxes:
        return None
    boxes = results[0].boxes
    best_idx = boxes.conf.argmax().item()
    class_id = int(boxes.cls[best_idx].item())
    return results[0].names[class_id]

# ── OCR (EasyOCR) ─────────────────────────────────────────────
import easyocr, re
reader = easyocr.Reader(['en'], gpu=False)

def extract_mrp_from_image(image_path):
    results = reader.readtext(image_path)
    for (bbox, text, confidence) in results:
        text_clean = text.upper().replace(" ", "")
        match = re.search(r'(?:MRP|RS|₹)[:\s]?(\d+\.?\d*)', text_clean)
        if match:
            return match.group(1)
    return None

def run_ocr_on_image(image_path):
    results = reader.readtext(image_path)
    lines = [text for (_, text, conf) in results if conf > 0.3]
    if not lines:
        return "UNREADABLE", []
    return lines[0], lines

# ── Fuzzy match ───────────────────────────────────────────────
def cross_verify(db_product_name, ocr_texts):
    if not ocr_texts or ocr_texts == ["UNREADABLE"]:
        return 0, "UNREADABLE"
    best_score, best_match = 0, ""
    for line in ocr_texts:
        score = fuzz.token_set_ratio(db_product_name.lower(), line.lower())
        if score > best_score:
            best_score, best_match = score, line
    return best_score, best_match

# ── Narrative ─────────────────────────────────────────────────
def generate_fraud_narrative(verify_result):
    if verify_result["decision"] == "PASS":
        return None
    product = verify_result.get("db_product", {})
    product_name = product.get("product_name", "Unknown") if product else "Unknown"
    ocr_text = verify_result.get("ocr_best_text", "unreadable")
    trust_score = verify_result.get("trust_score", 0)
    return (
        f"⚠️ Fraud Alert: Barcode indicates '{product_name}' "
        f"but product label shows '{ocr_text}' "
        f"(trust score: {trust_score}%). "
        f"Hold transaction and call supervisor immediately."
    )

# ── Main pipeline ─────────────────────────────────────────────
def verify_from_scanner(barcode: str, image_path: str) -> dict:
    result = {
        "barcode": barcode,
        "db_product": None,
        "ocr_best_text": None,
        "ocr_all_texts": [],
        "trust_score": 0,
        "yolo_label": None,
        "decision": None,
        "fraud_reason": None,
        "llm_narrative": None
    }

    # Step 1: Barcode lookup
    db_product = MOCK_DB.get(barcode)
    if db_product is None:
        result["decision"] = "BLOCK"
        result["fraud_reason"] = f"Barcode '{barcode}' not found in database"
        result["llm_narrative"] = generate_fraud_narrative(result)
        return result

    result["db_product"] = db_product

    # Step 2: OCR
    ocr_best, ocr_all = run_ocr_on_image(image_path)
    result["ocr_best_text"] = ocr_best
    result["ocr_all_texts"] = ocr_all

    # Step 3: Cross verify
    trust_score, matched_text = cross_verify(db_product["product_name"], ocr_all)
    result["trust_score"] = trust_score

    # Step 4: Decision
    if ocr_best == "UNREADABLE":
        result["decision"] = "BLOCK"
        result["fraud_reason"] = "OCR could not read label — manual check required"
    elif trust_score >= TRUST_THRESHOLD:
        result["decision"] = "PASS"
    else:
        result["decision"] = "BLOCK"
        result["fraud_reason"] = (
            f"TICKET SWITCHING DETECTED — Barcode says '{db_product['product_name']}' "
            f"but label shows '{ocr_best}' (match only {trust_score}%)"
        )

    result["llm_narrative"] = generate_fraud_narrative(result)
    return result