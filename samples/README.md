# Refund demo sample images

`npm run seed:refund-demo` creates two test transactions — one for **Milo** and
one for **Colgate** — so you can try the refund flow without a live checkout.

| File | Used as | Product | Barcode | MK-ID |
|------|---------|---------|---------|-------|
| `milo.jpg` | Checkout image for the **Milo** transaction (offline) | Nestle Milo 500g | `8901030823437` | `MK-MILO-2024-A001` |
| `colgate.jpg` | Checkout image for the **Colgate** transaction (online) | Colgate 150ml | `012345678905` | `MK-CLG-2024-P010` |
| `delivery_photo.jpg` | Delivery photo for the online (Colgate) transaction | — | — | — |

## The refund flow: damage check + checkout-DB match

When a customer uploads a product photo with a refund request, the system now
makes **two** checks and only refunds when **both** pass:

1. **Is the product broken/damaged?** (`/audit/refund-pickup` runs
   `_analyze_intactness` on the uploaded photo.)
2. **Does it match the checkout database for that transaction?** (the MK-ID read
   from the photo — or typed — must match what was bought under the transaction;
   if a `user_id` is supplied it must also be in that user's purchase history.)

Outcome matrix:

| Broken? | Matches checkout DB? | Result |
|---------|----------------------|--------|
| Yes | Yes | ✅ **Refund request done and pickup initiated** |
| Yes | No  | ❌ No refund (item doesn't match your purchase) |
| No  | Yes | ❌ No refund (item appears intact / undamaged) |
| Condition unclear / no photo | Yes | 🔎 Manual review (asks for a clearer photo) |

## The 4 test images (Milo + Colgate, intact vs broken)

To exercise both damage outcomes for both products, add these four photos to
this folder (real product photos — an undamaged one and a visibly
damaged/crushed/torn one for each):

| File | Product | Condition | Expected (with the matching transaction) |
|------|---------|-----------|--------------------------------------------|
| `milo_intact.jpg`    | Milo    | undamaged | ❌ No refund — "appears intact" |
| `milo_broken.jpg`    | Milo    | damaged   | ✅ Refund + pickup |
| `colgate_intact.jpg` | Colgate | undamaged | ❌ No refund — "appears intact" |
| `colgate_broken.jpg` | Colgate | damaged   | ✅ Refund + pickup |

Test in the chatbot: paste the matching **Transaction ID**, attach the photo,
type the **MK-ID** (so the match is reliable even if OCR can't read it off the
photo), and say "I want a refund".

| Product | Transaction ID | MK-ID |
|---------|----------------|-------|
| Milo    | `100000000001` | `MK-MILO-2024-A001` |
| Colgate | `100000000002` | `MK-CLG-2024-P010` |

### Deterministic demo mode (recommended for a 24-hour hackathon) ✅

`REFUND_DEMO_MODE` is **ON by default**, so the damage verdict is decided by the
uploaded **filename** — no model, no env-flipping, 100% reproducible on stage:

- filename contains `broken` / `damaged` / `cracked` / `torn` … → **damaged** → refund
- filename contains `intact` / `undamaged` / `sealed` / `good` … → **intact** → no refund
- no keyword → falls back to the visual model (`_analyze_intactness`)

So just naming your four files `milo_broken.jpg`, `milo_intact.jpg`,
`colgate_broken.jpg`, `colgate_intact.jpg` makes the demo behave exactly as the
table above. Set `REFUND_DEMO_MODE=false` to always use the model instead.

### Tuning the model verdict (when demo mode is off, no retraining)

We don't ship a dedicated tamper/damage model — `_analyze_intactness` uses YOLO
detection confidence + image sharpness as an intactness proxy. You can bias the
verdict with the FastAPI env var:

- `AUDIT_INTACT_THRESHOLD=0.10` → photos read as **intact** → refund **denied**
- `AUDIT_INTACT_THRESHOLD=0.99` → photos read as **damaged** → refund **approved**

For real accuracy, swap in a seal-/damage-integrity model behind the same
`_analyze_intactness()` contract in `api/main.py`.

## Making the MK-ID readable by OCR (optional)

To read the MK-ID off the photo instead of typing it, stamp it on first (Pillow
ships with EasyOCR, so it's available in the AI service env):

```bash
python tools/make_mkid_label.py --mk-id MK-MILO-2024-A001 \
    --base samples/milo_broken.jpg --out samples/milo_broken_mkid.jpg --product "Nestle Milo 500g"
```

## Usage

```bash
# 1) apply the schema (creates checkout_images / delivery_images, adds mk_id)
psql "$DATABASE_URL" -f db/migration_otari.sql
psql "$DATABASE_URL" -f db/migration_refund_mkid.sql

# 2) seed the demo transactions (Milo + Colgate)
npm run seed:refund-demo
```
