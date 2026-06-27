#!/usr/bin/env python3
"""
make_mkid_label.py — print an MK-ID onto a product image so the chatbot refund
flow can EXTRACT IT VIA OCR (EasyOCR) instead of the customer typing it.

The sample product photos in samples/ have no MK-ID text on them, so OCR has
nothing to read. This tool stamps a large, high-contrast MK-ID label onto a
product photo (or generates a clean standalone label), which EasyOCR reads
reliably.

Requires Pillow. Pillow is a dependency of EasyOCR, so it is already installed
wherever the AI service / OCR runs:
    pip install Pillow        # only if running standalone

Examples
--------
# Stamp the MK-ID onto an existing product photo (recommended for the demo):
python tools/make_mkid_label.py \
    --mk-id MK-MILO-2024-A001 \
    --base  samples/product_intact.jpg \
    --out   samples/product_intact_mkid.jpg \
    --product "Nestle Milo 500g"

# Generate a clean standalone label (no base photo):
python tools/make_mkid_label.py \
    --mk-id MK-MILO-2024-A001 \
    --out   samples/label_MK-MILO-2024-A001.png
"""
import argparse
import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("Pillow is required. Install it with:  pip install Pillow")

# Common system font locations (Linux/macOS/Windows). The first that exists wins.
FONT_CANDIDATES = [
    "/usr/share/fonts/dejavu-sans-fonts/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/google-noto-vf/NotoSans[wght].ttf",
    "/usr/share/fonts/google-noto/NotoSans-Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "C:\\Windows\\Fonts\\arialbd.ttf",
]


def load_font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    # Last resort: PIL's tiny bitmap font (OCR may struggle — install a TTF).
    print("WARNING: no TrueType font found; falling back to a tiny default font. "
          "OCR accuracy will be poor. Install DejaVu or Noto fonts.", file=sys.stderr)
    return ImageFont.load_default()


def _text_wh(draw, text, font):
    box = draw.textbbox((0, 0), text, font=font)
    return box[2] - box[0], box[3] - box[1]


def make_label(mk_id, product, target_width):
    """Build a white label image (black border + text) sized to target_width."""
    pad = max(18, target_width // 28)
    font = load_font(max(34, target_width // 12))
    sub_font = load_font(max(20, target_width // 26))

    probe = ImageDraw.Draw(Image.new("RGB", (4, 4)))
    tw, th = _text_wh(probe, mk_id, font)
    sw, sh = _text_wh(probe, product, sub_font) if product else (0, 0)

    box_w = max(tw, sw) + pad * 2
    box_h = th + (sh + pad // 2 if product else 0) + pad * 2

    label = Image.new("RGB", (box_w, box_h), "white")
    draw = ImageDraw.Draw(label)
    draw.rectangle([0, 0, box_w - 1, box_h - 1], outline="black", width=4)

    y = pad
    if product:
        draw.text(((box_w - sw) // 2, y), product, fill="black", font=sub_font)
        y += sh + pad // 2
    draw.text(((box_w - tw) // 2, y), mk_id, fill="black", font=font)
    return label


def main():
    ap = argparse.ArgumentParser(description="Stamp an MK-ID label onto a product image for OCR.")
    ap.add_argument("--mk-id", required=True, help="e.g. MK-MILO-2024-A001")
    ap.add_argument("--base", default=None, help="optional base product photo to stamp onto")
    ap.add_argument("--out", required=True, help="output image path (.jpg or .png)")
    ap.add_argument("--product", default=None, help="optional product name shown above the MK-ID")
    args = ap.parse_args()

    mk_id = args.mk_id.strip().upper()

    if args.base:
        base = Image.open(args.base).convert("RGB")
        w, h = base.size
        label = make_label(mk_id, args.product, w)
        # Bottom-center, clamped inside the image.
        lx = max(0, (w - label.width) // 2)
        ly = max(0, h - label.height - max(10, h // 40))
        if label.width > w or label.height > h:
            label = label.resize((min(w, label.width), min(h, label.height)))
            lx = max(0, (w - label.width) // 2)
            ly = max(0, h - label.height - max(10, h // 40))
        base.paste(label, (lx, ly))
        out_img = base
    else:
        label = make_label(mk_id, args.product, 1100)
        out_img = Image.new("RGB", (label.width + 80, label.height + 80), "white")
        out_img.paste(label, (40, 40))

    out_dir = os.path.dirname(os.path.abspath(args.out))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    if os.path.splitext(args.out)[1].lower() in (".jpg", ".jpeg"):
        out_img.save(args.out, "JPEG", quality=95)
    else:
        out_img.save(args.out)
    print(f"Wrote {args.out}  (MK-ID: {mk_id})")


if __name__ == "__main__":
    main()
