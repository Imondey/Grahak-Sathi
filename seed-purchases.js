/**
 * Grahak Sathi — Customer purchase-history seeder (anti-fraud refund demo)
 * ──────────────────────────────────────────────────────────────────────
 * Seeds the customer_purchases table with the demo users/orders so the refund
 * purchase-verification flow can be tested: a complaint is only accepted if the
 * recognised product's MK-ID is in that user's purchase history.
 *
 * Run:
 *   node seed-purchases.js        (or: npm run seed:purchases)
 *
 * Demo users:
 *   USER_9921 (Alice) → Nestle Milo (MK-MILO-2024-A001), Colgate (MK-CLG-2024-P010)
 *   USER_5544 (Bob)   → Nivea Cream (MK-NVA-2024-C301)
 *
 * DB connection uses the same env vars as index.js.
 */

const { Client } = require('pg');

const PURCHASES = [
    { user_id: 'USER_9921', customer_name: 'Alice Smith', order_id: 'ORD-1001', mk_id: 'MK-MILO-2024-A001', barcode: '8901030823437', product_name: 'Nestle Milo 500g' },
    { user_id: 'USER_9921', customer_name: 'Alice Smith', order_id: 'ORD-1002', mk_id: 'MK-CLG-2024-P010',  barcode: '012345678905',  product_name: 'Colgate 150ml' },
    { user_id: 'USER_5544', customer_name: 'Bob Jones',   order_id: 'ORD-2001', mk_id: 'MK-NVA-2024-C301',  barcode: '4006381333931', product_name: 'Nivea Cream 200ml' },
];

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
        // Idempotent: clear the demo users' rows first.
        await db.query(`DELETE FROM customer_purchases WHERE user_id = ANY($1)`, [['USER_9921', 'USER_5544']]);
        for (const p of PURCHASES) {
            await db.query(
                `INSERT INTO customer_purchases (user_id, customer_name, order_id, mk_id, barcode, product_name, purchased_at)
                 VALUES ($1,$2,$3,$4,$5,$6, NOW())`,
                [p.user_id, p.customer_name, p.order_id, p.mk_id, p.barcode, p.product_name]
            );
        }
        console.log(`\n✅ Seeded ${PURCHASES.length} purchases for USER_9921 (Alice) and USER_5544 (Bob).`);
        console.log('   Test in the chatbot: set Customer ID = USER_9921, upload a product photo (or provide an MK-ID),');
        console.log('   and say "I want a refund". A product not in their history is rejected as unverified.\n');
    } catch (err) {
        console.error('❌ Seeding failed:', err.message, '\n   (Did you run db/migration_otari.sql first?)');
        process.exitCode = 1;
    } finally {
        await db.end().catch(() => {});
    }
})();
