-- ============================================================================
-- SmartRetail — Otari Cost-Aware AI Layer: schema migration
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
    return_eligible_until TIMESTAMPTZ,            -- created_at + 30 days
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_checkout_images_txn ON checkout_images (transaction_id);
