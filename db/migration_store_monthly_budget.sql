-- ============================================================================
-- Grahak Sathi — Per-Store Monthly LLM Budget
-- ============================================================================
-- Adds a configurable monthly LLM-spend ceiling per store. This is a SEPARATE
-- concept from the per-session demo budget ($2): it is the real-world cost cap
-- the store owner is willing to pay for conversational AI per calendar month
-- (default $15). Live month-to-date spend is tracked in Redis
-- (aibudget:store:<shopId>:<YYYY-MM>) and resets automatically each month; this
-- column just persists the per-store LIMIT so it survives a Redis flush and can
-- be tuned per store.
--
-- Real-time fraud detection is never charged against this budget, so a drained
-- monthly budget can never disable safety-critical fraud blocking.
--
-- Safe to run multiple times (IF NOT EXISTS).
-- ============================================================================

ALTER TABLE retailers
    ADD COLUMN IF NOT EXISTS monthly_ai_budget_usd NUMERIC(10,2) NOT NULL DEFAULT 15.00;
