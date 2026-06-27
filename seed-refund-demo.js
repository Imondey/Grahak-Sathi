/**
 * SmartRetail — Refund demo seeder (one command)
 * ───────────────────────────────────────────────
 * Creates two ready-to-use test transactions — one for MILO and one for
 * COLGATE — so you can try the refund flow in the chatbot WITHOUT going through
 * a live checkout. Each transaction is linked to that product's MK-ID, and the
 * matching Colgate / Milo image lives in ./samples/.
 *
 *   • MILO    (offline / in-store) → product image in the Customer DB
 *   • COLGATE (online / delivered) → product image (dispatch) + delivery photo
 *
 * Flow to test: open the support chatbot, paste a printed Transaction ID, attach
 * the matching product image (samples/milo.jpg or samples/colgate.jpg) — the
 * model reads the MK-ID from it — and say: "I want a refund." On a match the
 * chatbot replies: "Refund request done and pickup initiated."
 *
 * Run:
 *   npm run seed:refund-demo
 *   (or: node seed-refund-demo.js)
 *
 * DB connection uses the same env vars as index.js
 * (DB_USER, DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT).
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const SHOP_ID     = parseInt(process.env.DEMO_SHOP_ID) || 1;
const RETURN_DAYS = parseInt(process.env.RETURN_WINDOW_DAYS) || 30;
const SAMPLES     = path.join(__dirname, 'samples');

// ── Demo products (Milo + Colgate). Barcodes/MK-IDs come from the MOCK_DB in
//    api/ai_core.py so OCR-recognised MK-IDs resolve to the right product. ─────
const PRODUCTS = [
    {
        label:        'MILO',
        productName:  'Nestle Milo 500g',
        transaction:  process.env.DEMO_TXN_MILO || '100000000001',
        channel:      'offline',
        barcode:      '8901030823437',
        mkId:         'MK-MILO-2024-A001',
        image:        path.join(SAMPLES, 'milo.jpg'),
        delivery:     null,
    },
    {
        label:        'COLGATE',
        productName:  'Colgate 150ml',
        transaction:  process.env.DEMO_TXN_COLGATE || '100000000002',
        channel:      'online',
        barcode:      '012345678905',
        mkId:         'MK-CLG-2024-P010',
        image:        path.join(SAMPLES, 'colgate.jpg'),
        delivery:     path.join(SAMPLES, 'delivery_photo.jpg'),
    },
];

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

        // Ensure the schema this seeder needs exists (idempotent). This means a
        // forgotten `migration_refund_mkid.sql` no longer breaks seeding or the
        // refund-pickup lookup — the mk_id column is guaranteed to be present.
        await db.query(`
            CREATE TABLE IF NOT EXISTS checkout_images (
                id BIGSERIAL PRIMARY KEY,
                transaction_id TEXT NOT NULL,
                shop_id INTEGER,
                barcode TEXT,
                image_b64 TEXT NOT NULL,
                mk_id TEXT,
                purchase_channel TEXT NOT NULL DEFAULT 'offline',
                return_eligible_until TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            ALTER TABLE checkout_images ADD COLUMN IF NOT EXISTS mk_id TEXT;
            ALTER TABLE checkout_images ADD COLUMN IF NOT EXISTS purchase_channel TEXT NOT NULL DEFAULT 'offline';
            ALTER TABLE checkout_images ADD COLUMN IF NOT EXISTS return_eligible_until TIMESTAMPTZ;
            CREATE INDEX IF NOT EXISTS idx_checkout_images_txn      ON checkout_images (transaction_id);
            CREATE INDEX IF NOT EXISTS idx_checkout_images_txn_mkid ON checkout_images (transaction_id, mk_id);
            CREATE INDEX IF NOT EXISTS idx_checkout_images_mkid     ON checkout_images (mk_id);

            CREATE TABLE IF NOT EXISTS delivery_images (
                id BIGSERIAL PRIMARY KEY,
                transaction_id TEXT NOT NULL,
                shop_id INTEGER,
                barcode TEXT,
                image_b64 TEXT NOT NULL,
                courier TEXT,
                delivered_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_delivery_images_txn ON delivery_images (transaction_id);
        `);

        const txnIds = PRODUCTS.map(p => p.transaction);

        // Idempotent: clear any previous demo rows for these IDs.
        await db.query(`DELETE FROM checkout_images WHERE transaction_id = ANY($1)`, [txnIds]);
        await db.query(`DELETE FROM delivery_images WHERE transaction_id = ANY($1)`, [txnIds]);

        for (const p of PRODUCTS) {
            // Product image + MK-ID link (Customer DB).
            await db.query(
                `INSERT INTO checkout_images
                   (transaction_id, shop_id, barcode, image_b64, mk_id, purchase_channel, return_eligible_until, created_at)
                 VALUES ($1,$2,$3,$4,$5,$6, NOW() + ($7 || ' days')::interval, NOW())`,
                [p.transaction, SHOP_ID, p.barcode, toDataUrl(p.image), p.mkId, p.channel, String(RETURN_DAYS)]
            );

            // Online orders also get a delivery photo (Delivery DB).
            if (p.delivery) {
                await db.query(
                    `INSERT INTO delivery_images
                       (transaction_id, shop_id, barcode, image_b64, courier, delivered_at, created_at)
                     VALUES ($1,$2,$3,$4,'BlueDart', NOW(), NOW())`,
                    [p.transaction, SHOP_ID, p.barcode, toDataUrl(p.delivery)]
                );
            }
        }

        console.log('\n✅ Refund demo data seeded (Milo + Colgate).\n');
        console.log('  Open the support chatbot, paste a Transaction ID, attach the matching');
        console.log('  product image, and say: "I want a refund."\n');
        for (const p of PRODUCTS) {
            console.log(`  ${p.label.padEnd(8)} → Transaction ID: ${p.transaction}  (${p.channel})`);
            console.log(`             image: samples/${path.basename(p.image)}   MK-ID: ${p.mkId}  (${p.productName})\n`);
        }
        console.log('  The chatbot extracts the MK-ID from the photo (or uses the one you type) and');
        console.log('  matches it against the transaction. On a match it replies:');
        console.log('      "Refund request done and pickup initiated."\n');
        console.log('  NOTE: samples/milo.jpg and samples/colgate.jpg are starter images — replace');
        console.log('        them with real Milo / Colgate photos for a convincing demo.');
        console.log('  To test the OCR path, stamp the MK-ID onto each photo first, e.g.:');
        console.log('      python tools/make_mkid_label.py --mk-id MK-MILO-2024-A001 \\');
        console.log('          --base samples/milo.jpg --out samples/milo_mkid.jpg --product "Nestle Milo 500g"');
        console.log('      python tools/make_mkid_label.py --mk-id MK-CLG-2024-P010 \\');
        console.log('          --base samples/colgate.jpg --out samples/colgate_mkid.jpg --product "Colgate 150ml"');
        console.log('  then upload the *_mkid.jpg image (or just type the MK-ID in the chatbot).\n');
    } catch (err) {
        console.error('❌ Seeding failed:', err.message);
        console.error('   • Is PostgreSQL running and reachable with the DB_* env vars (same as index.js)?');
        console.error('   • Does the FastAPI service use the SAME database (DATABASE_URL) as this seeder?');
        console.error('   • Are samples/milo.jpg and samples/colgate.jpg present in ./samples/ ?');
        process.exitCode = 1;
    } finally {
        await db.end().catch(() => {});
    }
})();
