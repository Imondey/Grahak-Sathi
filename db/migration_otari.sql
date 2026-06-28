-- ============================================================================
-- Grahak Sathi — Otari Cost-Aware AI Layer: schema migration
-- ============================================================================
-- Adds the tables that back:
--   • Usage transparency (AI model cost + latency per call)
--   • Prompt-injection incident logging
--   • Post-purchase return-claim decisions
--   • Live checkout image storage (Customer DB, for the auditor)
--
-- Safe to run multiple times (IF NOT EXISTS).
-- ============================================================================

-- ── Per-call AI model usage (drives the budget + transparency dashboard) ──────
CREATE TABLE IF NOT EXISTS model_usage (
    id          BIGSERIAL PRIMARY KEY,
    session_id  TEXT        NOT NULL,           -- budget session id (per visitor)
    shop_id     INTEGER,                        -- nullable for anonymous visitors
    task_type   TEXT        NOT NULL,           -- e.g. intent_parse, auditor_vision
    tier        TEXT        NOT NULL,           -- light | medium | high
    model       TEXT,                           -- model / engine that served it
    cost_usd    NUMERIC(10,5) NOT NULL DEFAULT 0,
    latency_ms  INTEGER,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_model_usage_shop_day ON model_usage (shop_id, created_at);
CREATE INDEX IF NOT EXISTS idx_model_usage_session  ON model_usage (session_id);

-- ── Prompt-injection events (security transparency) ───────────────────────────
CREATE TABLE IF NOT EXISTS injection_events (
    id          BIGSERIAL PRIMARY KEY,
    session_id  TEXT,
    shop_id     INTEGER,
    raw_input   TEXT,                           -- truncated offending input
    stage       SMALLINT,                       -- 1 = rule pass, 2 = medium-tier escalation
    pattern     TEXT,                           -- matched rule id / signals
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_injection_shop_day ON injection_events (shop_id, created_at);

-- ── Post-purchase return-claim outcomes (Conversational Auditor) ──────────────
CREATE TABLE IF NOT EXISTS return_claims (
    id              BIGSERIAL PRIMARY KEY,
    session_id      TEXT,
    shop_id         INTEGER,
    transaction_id  TEXT,
    intent          TEXT,                        -- refund | exchange | faq | other
    claim_type      TEXT,                        -- broken_label | damaged | wrong_size | wrong_item
    decision        TEXT,                        -- APPROVED | DENIED | NEEDS_REVIEW
    confidence      NUMERIC(5,4),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_return_claims_shop_day ON return_claims (shop_id, created_at);
CREATE INDEX IF NOT EXISTS idx_return_claims_txn      ON return_claims (transaction_id);

-- ── Live checkout images (Customer DB) — retrieved by the auditor ─────────────
-- Stores the image captured at checkout so a refund claim can be verified
-- against the product's condition at time of purchase.
CREATE TABLE IF NOT EXISTS checkout_images (
    id              BIGSERIAL PRIMARY KEY,
    transaction_id  TEXT        NOT NULL,
    shop_id         INTEGER,
    barcode         TEXT,
    image_b64       TEXT        NOT NULL,        -- base64 (or data-URL) of the live frame
    purchase_channel TEXT       NOT NULL DEFAULT 'offline',  -- offline (in-store) | online
    return_eligible_until TIMESTAMPTZ,            -- created_at + 30 days
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_checkout_images_txn ON checkout_images (transaction_id);

-- Back-fill the column for installs that ran an earlier version of this migration.
ALTER TABLE checkout_images ADD COLUMN IF NOT EXISTS purchase_channel TEXT NOT NULL DEFAULT 'offline';

-- ── Delivery images (Delivery DB) — online orders only ────────────────────────
-- For online purchases, the courier/last-mile photo captured at delivery. The
-- auditor compares this against the product image captured at dispatch/checkout
-- so it can tell whether a seal was intact at sale but broken in transit.
CREATE TABLE IF NOT EXISTS delivery_images (
    id              BIGSERIAL PRIMARY KEY,
    transaction_id  TEXT        NOT NULL,
    shop_id         INTEGER,
    barcode         TEXT,
    image_b64       TEXT        NOT NULL,        -- base64 (or data-URL) of the delivery photo
    courier         TEXT,                         -- optional carrier / agent id
    delivered_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_delivery_images_txn ON delivery_images (transaction_id);


-- ── Refund transaction ID on the base transactions table ──────────────────────
-- The random numeric transaction ID issued to the customer at payment. It links
-- a receipt to the checkout_images / delivery_images used for refund verification.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transaction_id TEXT;
CREATE INDEX IF NOT EXISTS idx_transactions_txn_id ON transactions (transaction_id);


-- ── Customer purchase history (anti-fraud refund verification) ────────────────
-- Maps a customer (user_id) to the specific MK-IDs / products they bought, so a
-- refund complaint can be cross-checked: the product recognised in the uploaded
-- photo must exist in THIS user's purchase history, otherwise it's rejected.
CREATE TABLE IF NOT EXISTS customer_purchases (
    id             BIGSERIAL PRIMARY KEY,
    user_id        TEXT        NOT NULL,        -- customer identifier (login id / phone / session)
    customer_name  TEXT,
    order_id       TEXT,
    mk_id          TEXT        NOT NULL,        -- manufacturer serial of the purchased unit
    barcode        TEXT,
    product_name   TEXT,
    purchased_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_purchases_user ON customer_purchases (user_id);
CREATE INDEX IF NOT EXISTS idx_customer_purchases_mkid ON customer_purchases (mk_id);
