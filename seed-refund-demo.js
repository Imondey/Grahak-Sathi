/**
 * SmartRetail — Refund demo seeder (one command)
 * ───────────────────────────────────────────────
 * Creates two ready-to-use test transactions so you can try the refund flow in
 * the chatbot WITHOUT going through a live checkout:
 *
 *   • OFFLINE (in-store)  → one product image in the Customer DB (checkout_images)
 *   • ONLINE              → product image (dispatch) + delivery photo (Delivery DB)
 *
 * After running, just open the support chatbot, type one of the printed
 * transaction IDs into the "Transaction ID" field, and say something like:
 *     "I want a refund, the seal was broken."
 *
 * Run:
 *   npm run seed:refund-demo
 *   (or: node seed-refund-demo.js)
 *
 * Tip — control the visual verdict for your demo via the FastAPI env var
 * AUDIT_INTACT_THRESHOLD (no retraining needed):
 *   • LOW  (e.g. 0.10) → items read as "intact"  → claim CONTRADICTED → DENIED
 *   • HIGH (e.g. 0.99) → items read as "damaged" → claim SUPPORTED   → APPROVED
 *
 * DB connection uses the same env vars as index.js
 * (DB_USER, DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT).
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// ── Demo configuration (override via env) ──────────────────────────────────────
const TXN_OFFLINE = process.env.DEMO_TXN_OFFLINE || '100000000001';
const TXN_ONLINE  = process.env.DEMO_TXN_ONLINE  || '100000000002';
const SHOP_ID     = parseInt(process.env.DEMO_SHOP_ID) || 1;
const BARCODE     = process.env.DEMO_BARCODE || '8901030823437';  // Nestle Milo (in MOCK_DB)
const MK_ID       = process.env.DEMO_MK_ID || 'MK-MILO-2024-A001'; // serial linked to the txn
const RETURN_DAYS = parseInt(process.env.RETURN_WINDOW_DAYS) || 30;

const SAMPLES = path.join(__dirname, 'samples');
const IMG = {
    productOffline: path.join(SAMPLES, 'product_intact.jpg'),
    productOnline:  path.join(SAMPLES, 'product_online.jpg'),
    delivery:       path.join(SAMPLES, 'delivery_photo.jpg'),
};

function toDataUrl(file) {
    if (!fs.existsSync(file)) throw new Error(`Sample image missing: ${file}`);
    const ext  = (path.extname(file).slice(1) || 'jpeg').toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

(async () => {
    const db = new Client({
        user:     process.env.DB_USER     || 'postgres',
        host:     process.env.DB_HOST     || 'localhost',
        database: process.env.DB_NAME     || 'Netra',
        password: process.env.DB_PASSWORD || '1221',
        port:     parseInt(process.env.DB_PORT) || 5432,
    });

    try {
        await db.connect();

        // Idempotent: clear any previous demo rows for these IDs.
        await db.query(`DELETE FROM checkout_images WHERE transaction_id = ANY($1)`, [[TXN_OFFLINE, TXN_ONLINE]]);
        await db.query(`DELETE FROM delivery_images WHERE transaction_id = ANY($1)`, [[TXN_OFFLINE, TXN_ONLINE]]);

        // ── OFFLINE transaction: one product image (Customer DB) ──────────────
        await db.query(
            `INSERT INTO checkout_images
               (transaction_id, shop_id, barcode, image_b64, mk_id, purchase_channel, return_eligible_until, created_at)
             VALUES ($1,$2,$3,$4,$5,'offline', NOW() + ($6 || ' days')::interval, NOW())`,
            [TXN_OFFLINE, SHOP_ID, BARCODE, toDataUrl(IMG.productOffline), MK_ID, String(RETURN_DAYS)]
        );

        // ── ONLINE transaction: product (dispatch) + delivery photo ───────────
        await db.query(
            `INSERT INTO checkout_images
               (transaction_id, shop_id, barcode, image_b64, mk_id, purchase_channel, return_eligible_until, created_at)
             VALUES ($1,$2,$3,$4,$5,'online', NOW() + ($6 || ' days')::interval, NOW())`,
            [TXN_ONLINE, SHOP_ID, BARCODE, toDataUrl(IMG.productOnline), MK_ID, String(RETURN_DAYS)]
        );
        await db.query(
            `INSERT INTO delivery_images
               (transaction_id, shop_id, barcode, image_b64, courier, delivered_at, created_at)
             VALUES ($1,$2,$3,$4,'BlueDart', NOW(), NOW())`,
            [TXN_ONLINE, SHOP_ID, BARCODE, toDataUrl(IMG.delivery)]
        );

        console.log('\n✅ Refund demo data seeded.\n');
        console.log('  Open the support chatbot, paste a Transaction ID, attach a product photo (or');
        console.log('  type the MK-ID), and say: "I want a refund."\n');
        console.log(`  🏪  OFFLINE (in-store)  →  Transaction ID:  ${TXN_OFFLINE}`);
        console.log(`  🚚  ONLINE  (delivered) →  Transaction ID:  ${TXN_ONLINE}`);
        console.log(`\n  Both transactions are linked to MK-ID:  ${MK_ID}  (${'Nestle Milo'})`);
        console.log('  The chatbot extracts the MK-ID from your photo (or uses the one you type) and');
        console.log('  matches it against the transaction. On a match it replies:');
        console.log('      "Refund request done and pickup initiated."\n');
        console.log('  Tip: the sample photos have no MK-ID printed on them, so to test the OCR');
        console.log('       path, first stamp the MK-ID onto a photo, then upload THAT image:');
        console.log(`         python tools/make_mkid_label.py --mk-id ${MK_ID} \\`);
        console.log('             --base samples/product_intact.jpg \\');
        console.log('             --out  samples/product_intact_mkid.jpg --product "Nestle Milo 500g"');
        console.log('       (or just type the MK-ID in the chatbot MK-ID field to skip OCR.)\n');
    } catch (err) {
        console.error('❌ Seeding failed:', err.message);
        console.error('   • Did you run db/migration_otari.sql first?');
        console.error('   • Are the sample images present in ./samples/ ?');
        process.exitCode = 1;
    } finally {
        await db.end().catch(() => {});
    }
})();
