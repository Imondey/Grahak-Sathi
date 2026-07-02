/**
 * Grahak Sathi — Capture-Match Decision Thresholds (per store)
 * ────────────────────────────────────────────────────────────
 * The checkout capture-match step produces a 0–1 confidence that the item
 * PHOTOGRAPHED at checkout matches the scanned SKU's reference image. This
 * module owns:
 *
 *   1. classify(confidence, thresholds) — the pure three-way branch:
 *          confidence  >  approve          -> 'auto_approve'
 *          block < confidence <= approve   -> 'manager_review'
 *          confidence  <= block            -> 'auto_block'
 *      (a null/NaN confidence is inconclusive -> 'manager_review', the safe
 *       middle band; the caller decides whether to hold the sale on it.)
 *
 *   2. Per-store resolution of the approve/block thresholds. Values are looked
 *      up Redis-first (live override, seeded from the retailers table) and fall
 *      back to the global defaults in aiConfig. This mirrors the per-store
 *      monthly-budget pattern so a store can tune fraud sensitivity at runtime
 *      without a code change or restart.
 *
 * The thresholds are NEVER hardcoded at the call site — always resolve through
 * get(shopId) so the per-store override is honoured.
 */

const { CAPTURE_AUTO_APPROVE_THRESHOLD, CAPTURE_AUTO_BLOCK_THRESHOLD } = require('./aiConfig');

const DEFAULTS = Object.freeze({
    autoApprove: CAPTURE_AUTO_APPROVE_THRESHOLD,
    autoBlock:   CAPTURE_AUTO_BLOCK_THRESHOLD,
});

const BAND = Object.freeze({
    AUTO_APPROVE:   'auto_approve',
    MANAGER_REVIEW: 'manager_review',
    AUTO_BLOCK:     'auto_block',
});

function redisKey(shopId) {
    return `capture:threshold:${shopId}`;
}

function round3(n) {
    return Math.round(n * 1000) / 1000;
}

/**
 * Coerce + sanity-check a threshold pair. Guarantees 0 <= block < approve <= 1;
 * clamps out-of-range inputs and falls back to defaults for anything unusable so
 * a bad value can never invert the bands (which would make every scan block or
 * approve). Returns a NEW normalized object.
 */
function normalize({ autoApprove, autoBlock } = {}) {
    let approve = parseFloat(autoApprove);
    let block   = parseFloat(autoBlock);
    if (isNaN(approve)) approve = DEFAULTS.autoApprove;
    if (isNaN(block))   block   = DEFAULTS.autoBlock;
    approve = Math.min(1, Math.max(0, approve));
    block   = Math.min(1, Math.max(0, block));
    // Bands must stay ordered (block strictly below approve). If a caller
    // inverts them, revert to defaults rather than silently mis-classifying.
    if (block >= approve) {
        approve = DEFAULTS.autoApprove;
        block   = DEFAULTS.autoBlock;
    }
    return { autoApprove: round3(approve), autoBlock: round3(block) };
}

/**
 * The pure decision. `confidence` is 0–1 (or null/undefined when the match was
 * inconclusive). Returns { band, confidence, thresholds }.
 */
function classify(confidence, thresholds = DEFAULTS) {
    const { autoApprove, autoBlock } = normalize(thresholds);
    const c = (confidence === null || confidence === undefined || isNaN(confidence))
        ? null
        : Number(confidence);

    let band;
    if (c === null)              band = BAND.MANAGER_REVIEW;   // inconclusive -> human
    else if (c > autoApprove)    band = BAND.AUTO_APPROVE;
    else if (c <= autoBlock)     band = BAND.AUTO_BLOCK;
    else                         band = BAND.MANAGER_REVIEW;   // block < c <= approve

    return { band, confidence: c, thresholds: { autoApprove, autoBlock } };
}

function createCaptureThresholds(redisClient, db) {
    /** Live per-store thresholds: Redis override -> retailers table -> defaults. */
    async function get(shopId) {
        if (shopId == null) return { ...DEFAULTS };

        // 1) Redis live override (also the write-through cache for the DB value).
        try {
            const raw = await redisClient.get(redisKey(shopId));
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.autoApprove != null && parsed.autoBlock != null) {
                    return normalize(parsed);
                }
            }
        } catch (err) {
            console.warn('Capture threshold read error (fail-open to DB/default):', err.message);
        }

        // 2) Persisted per-store setting (seed Redis so later reads are cheap).
        try {
            const r = await db.query(
                'SELECT capture_auto_approve_threshold, capture_auto_block_threshold FROM retailers WHERE id = $1',
                [shopId],
            );
            if (r.rows.length > 0 &&
                r.rows[0].capture_auto_approve_threshold != null &&
                r.rows[0].capture_auto_block_threshold   != null) {
                const resolved = normalize({
                    autoApprove: r.rows[0].capture_auto_approve_threshold,
                    autoBlock:   r.rows[0].capture_auto_block_threshold,
                });
                try { await redisClient.set(redisKey(shopId), JSON.stringify(resolved)); } catch { /* best effort */ }
                return resolved;
            }
        } catch (err) {
            // Column missing (pre-migration) — fall through to defaults.
            if (!createCaptureThresholds._warned) {
                console.warn('Capture threshold read skipped (run migration_capture_match_thresholds.sql):', err.message);
                createCaptureThresholds._warned = true;
            }
        }

        // 3) Global default.
        return { ...DEFAULTS };
    }

    /**
     * Persist a per-store threshold pair to the retailers table AND Redis so the
     * live counter picks it up immediately. Returns the normalized values.
     */
    async function set(shopId, thresholds) {
        const resolved = normalize(thresholds);
        try {
            await db.query(
                'UPDATE retailers SET capture_auto_approve_threshold = $1, capture_auto_block_threshold = $2 WHERE id = $3',
                [resolved.autoApprove, resolved.autoBlock, shopId],
            );
        } catch (err) {
            // Column missing (pre-migration) — still apply the live Redis override.
            if (!createCaptureThresholds._setWarned) {
                console.warn('Capture threshold persist skipped (run migration_capture_match_thresholds.sql):', err.message);
                createCaptureThresholds._setWarned = true;
            }
        }
        try { await redisClient.set(redisKey(shopId), JSON.stringify(resolved)); }
        catch (err) { console.warn('Capture threshold Redis write error:', err.message); }
        return resolved;
    }

    return { get, set, classify, normalize, DEFAULTS, BAND };
}

module.exports = { createCaptureThresholds, classify, normalize, DEFAULTS, BAND };
