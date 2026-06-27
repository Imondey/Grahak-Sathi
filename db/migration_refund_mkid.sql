-- ============================================================================
-- SmartRetail — Refund-by-MK-ID linkage
-- ============================================================================
-- Links a transaction to the MK-ID(s) (manufacturer serial numbers) of the
-- specific unit(s) the customer purchased under that transaction. This is what
-- powers the chatbot refund flow:
--
--   customer gives transaction_id + product photo
--     -> the model extracts the MK-ID from the photo
--     -> we look up the MK-ID(s) linked to that transaction here
--     -> if the extracted MK-ID matches one of them
--          -> "refund request done and pickup initiated"
--
-- We reuse the existing per-item checkout_images rows (one row per purchased
-- unit) and simply attach the unit's MK-ID, so every transaction already maps
-- to its set of purchased MK-IDs.
--
-- Safe to run multiple times (IF NOT EXISTS).
-- ============================================================================

-- The manufacturer serial (MK-ID) of the purchased unit, stored alongside the
-- transaction + barcode + checkout image.
ALTER TABLE checkout_images ADD COLUMN IF NOT EXISTS mk_id TEXT;

-- Fast lookup of "which MK-IDs belong to this transaction".
CREATE INDEX IF NOT EXISTS idx_checkout_images_txn_mkid ON checkout_images (transaction_id, mk_id);
CREATE INDEX IF NOT EXISTS idx_checkout_images_mkid     ON checkout_images (mk_id);
