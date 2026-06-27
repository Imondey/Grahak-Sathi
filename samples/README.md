# Refund demo sample images

These images are used by `npm run seed:refund-demo` to create two test
transactions — one for **Milo** and one for **Colgate** — so you can try the
refund flow without a live checkout.

| File | Used as | Product | Barcode | MK-ID |
|------|---------|---------|---------|-------|
| `milo.jpg` | Product image for the **Milo** transaction (offline) | Nestle Milo 500g | `8901030823437` | `MK-MILO-2024-A001` |
| `colgate.jpg` | Product image for the **Colgate** transaction (online) | Colgate 150ml | `012345678905` | `MK-CLG-2024-P010` |
| `delivery_photo.jpg` | Delivery photo for the online (Colgate) transaction | — | — | — |
| `product_intact.jpg`, `product_online.jpg` | Generic product frames (originals `milo.jpg`/`colgate.jpg` were copied from) | — | — | — |

> `milo.jpg` and `colgate.jpg` are **starter images** — replace them with real
> Milo / Colgate product photos for a convincing demo. Keep the same filenames
> so the seeder picks them up automatically.

## Making the MK-ID readable by OCR

The refund flow extracts the MK-ID from the uploaded photo via OCR (EasyOCR).
A plain product photo has no MK-ID text on it, so first stamp the MK-ID onto the
image (Pillow ships with EasyOCR, so it's available in the AI service env):

```bash
python tools/make_mkid_label.py --mk-id MK-MILO-2024-A001 \
    --base samples/milo.jpg --out samples/milo_mkid.jpg --product "Nestle Milo 500g"

python tools/make_mkid_label.py --mk-id MK-CLG-2024-P010 \
    --base samples/colgate.jpg --out samples/colgate_mkid.jpg --product "Colgate 150ml"
```

Then upload the `*_mkid.jpg` image in the chatbot. (Or skip OCR entirely by
typing the MK-ID into the chatbot's MK-ID field.)

## Usage

```bash
# 1) apply the schema (creates checkout_images / delivery_images, adds mk_id)
psql "$DATABASE_URL" -f db/migration_otari.sql
psql "$DATABASE_URL" -f db/migration_refund_mkid.sql

# 2) seed the demo transactions (Milo + Colgate)
npm run seed:refund-demo
```

It prints two transaction IDs. Paste one into the chatbot's **Transaction ID**
field, attach the matching product image, and say: *"I want a refund."* On a
match the chatbot replies: *"Refund request done and pickup initiated."*
