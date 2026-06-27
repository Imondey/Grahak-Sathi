/**
 * SmartRetail — Refund image seeder
 * ──────────────────────────────────
 * Loads an image file from disk, base64-encodes it, and inserts it into the
 * Customer DB (checkout_images) or Delivery DB (delivery_images) under a given
 * transaction ID — so you can demo/test the refund verification flow without
 * going through a live checkout.
 *
 * Usage:
 *   node seed-images.js checkout <transaction_id> <image_path> [shop_id] [barcode] [channel]
 *   node seed-images.js delivery <transaction_id> <image_path> [shop_id] [barcode] [courier]
 *
 * Examples:
 *   node seed-images.js checkout 766313445244 ./samples/box_intact.jpg 1 8901234567890 offline
 *   node seed-images.js delivery 766313445244 ./samples/box_broken.jpg 1 8901234567890 BlueDart
 *
 * Reads DB connection from the same env vars as index.js
 * (DB_USER, DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT).
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function usage(msg) {
    if (msg) console.error('Error:', msg);
    console.error('\nUsage:\n' +
        '  node seed-images.js checkout <transaction_id> <image_path> [shop_id] [barcode] [channel] [mk_id]\n' +
        '  node seed-images.js delivery <transaction_id> <image_path> [shop_id] [barcode] [courier]\n');
    process.exit(1);
}

(async () => {
    const [kind, transactionId, imagePath, shopId, barcode, last, mkId] = process.argv.slice(2);

    if (!kind || !['checkout', 'delivery'].includes(kind)) usage('first arg must be "checkout" or "delivery".');
    if (!transactionId) usage('transaction_id is required.');
    if (!imagePath || !fs.existsSync(imagePath)) usage('image_path is required and must exist.');

    // Build a data-URL so the FastAPI decoder accepts it as-is.
    const ext  = (path.extname(imagePath).slice(1) || 'jpeg').toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const b64  = fs.readFileSync(imagePath).toString('base64');
    const dataUrl = `data:${mime};base64,${b64}`;

    const db = new Client({
        user:     process.env.DB_USER     || 'postgres',
        host:     process.env.DB_HOST     || 'localhost',
        database: process.env.DB_NAME     || 'Netra',
        password: process.env.DB_PASSWORD || '1221',
        port:     parseInt(process.env.DB_PORT) || 5432,
    });

    try {
        await db.connect();
        if (kind === 'checkout') {
            const channel = (String(last || 'offline').toLowerCase() === 'online') ? 'online' : 'offline';
            const days = parseInt(process.env.RETURN_WINDOW_DAYS) || 30;
            await db.query(
                `INSERT INTO checkout_images
                   (transaction_id, shop_id, barcode, image_b64, mk_id, purchase_channel, return_eligible_until, created_at)
                 VALUES ($1,$2,$3,$4,$5,$6, NOW() + ($7 || ' days')::interval, NOW())`,
                [transactionId, shopId ? parseInt(shopId) : null, barcode || null, dataUrl, mkId || null, channel, String(days)]
            );
            console.log(`✅ checkout_images: stored ${imagePath} for txn ${transactionId} (channel=${channel}, mk_id=${mkId || 'n/a'}, ${(b64.length/1024).toFixed(0)}KB)`);
        } else {
            await db.query(
                `INSERT INTO delivery_images
                   (transaction_id, shop_id, barcode, image_b64, courier, delivered_at, created_at)
                 VALUES ($1,$2,$3,$4,$5, NOW(), NOW())`,
                [transactionId, shopId ? parseInt(shopId) : null, barcode || null, dataUrl, last || null]
            );
            console.log(`✅ delivery_images: stored ${imagePath} for txn ${transactionId} (courier=${last || 'n/a'}, ${(b64.length/1024).toFixed(0)}KB)`);
        }
    } catch (err) {
        console.error('❌ Insert failed:', err.message);
        console.error('   (Did you run db/migration_otari.sql first?)');
        process.exitCode = 1;
    } finally {
        await db.end().catch(() => {});
    }
})();
