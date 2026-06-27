# Refund demo sample images

These images are used by `npm run seed:refund-demo` to create test transactions
so you can try the refund flow without a live checkout.

| File | Used as | Stored in |
|------|---------|-----------|
| `product_intact.jpg` | Product image for the **offline** test transaction | `checkout_images` (Customer DB) |
| `product_online.jpg` | Product image (dispatch) for the **online** test transaction | `checkout_images` (Customer DB) |
| `delivery_photo.jpg` | Delivery photo for the **online** test transaction | `delivery_images` (Delivery DB) |

> These are real product frames the YOLO model can detect, copied from
> `runs/detect/smart_retail/`. Replace any of them with your own photos
> (a clearly intact product vs. a damaged one / broken seal) for a more
> convincing demo.

## How the visual verdict is decided (no retraining required)

The verify-claim step uses YOLO detection confidence + image sharpness as an
intactness proxy. You can flip the outcome for a demo with the FastAPI env var:

- `AUDIT_INTACT_THRESHOLD=0.10` → items read as **intact** → claim **DENIED**
- `AUDIT_INTACT_THRESHOLD=0.99` → items read as **damaged** → claim **APPROVED**

For genuine accuracy, swap in a model trained on intact vs. damaged products
behind the same `_analyze_intactness()` contract in `api/main.py`.

## Usage

```bash
# 1) apply the schema (creates checkout_images / delivery_images)
psql "$DATABASE_URL" -f db/migration_otari.sql

# 2) seed the demo transactions
npm run seed:refund-demo
```

It prints two transaction IDs (offline + online). Paste one into the chatbot's
**Transaction ID** field and say: *"I want a refund, the seal was broken."*
