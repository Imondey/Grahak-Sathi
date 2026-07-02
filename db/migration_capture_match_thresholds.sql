-- ============================================================================
-- Grahak Sathi — Per-Store Capture-Match Decision Thresholds
-- ============================================================================
-- The checkout capture-match score (0.000–1.000) compares the item PHOTOGRAPHED
-- at checkout against the scanned SKU's reference profile image. That single
-- confidence now drives a three-way decision:
--
--     confidence  >  auto_approve_threshold   -> AUTO-APPROVE   (trusted match)
--     block < confidence <= approve           -> MANAGER REVIEW (borderline)
--     confidence  <= auto_block_threshold      -> AUTO-BLOCK     (likely swap/fraud)
--
-- The bands are the tuning knob a store uses to trade convenience against fraud
-- sensitivity, so they are stored PER STORE (not hardcoded). Defaults are
-- 0.90 (approve) and 0.60 (block); a store can raise the block threshold to be
-- stricter, or lower the approve threshold to auto-clear more transactions.
--
-- Live overrides are also mirrored into Redis (capture:threshold:<shopId>) by
-- the gateway so a change applies immediately; these columns persist the
-- per-store setting so it survives a Redis flush.
--
-- Safe to run multiple times (IF NOT EXISTS). CHECK keeps block < approve and
-- both inside [0,1] so an invalid pair can never be persisted.
-- ============================================================================

ALTER TABLE retailers
    ADD COLUMN IF NOT EXISTS capture_auto_approve_threshold NUMERIC(4,3) NOT NULL DEFAULT 0.900,
    ADD COLUMN IF NOT EXISTS capture_auto_block_threshold   NUMERIC(4,3) NOT NULL DEFAULT 0.600;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.constraint_column_usage
        WHERE constraint_name = 'chk_capture_thresholds_ordered'
    ) THEN
        ALTER TABLE retailers
            ADD CONSTRAINT chk_capture_thresholds_ordered
            CHECK (
                capture_auto_block_threshold   >= 0
            AND capture_auto_approve_threshold <= 1
            AND capture_auto_block_threshold    < capture_auto_approve_threshold
            );
    END IF;
END $$;

-- Persist the branch outcome on the transaction row (audit trail + the
-- manager-review queue that migration_capture_match.sql's index supports).
--   auto_approve | manager_review | auto_block   (NULL = not scored/inconclusive)
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS capture_match_decision TEXT;

CREATE INDEX IF NOT EXISTS idx_transactions_capture_decision
    ON transactions (shop_id, capture_match_decision);
