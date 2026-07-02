/**
 * Grahak Sathi — pure decision helpers for capture resilience.
 * ────────────────────────────────────────────────────────────
 * These are the branch decisions used by the checkout capture flow, kept pure
 * (no Redis / DB / I/O) so they can be unit-tested directly and reused by the
 * gateway. The side effects (writing state, firing fraud alerts, freezing the
 * lane) stay in index.js; this module only decides WHICH branch to take.
 */

const { BAND } = require('./captureThresholds');

/**
 * All local-write retries are exhausted — what do we do?
 *   policy === 'hard_block'                    → 'hard_block'  (refuse the capture)
 *   policy === 'hmac_fallback' & count > max   → 'freeze'      (persistent fault → freeze lane)
 *   policy === 'hmac_fallback' & count <= max  → 'fallback'    (logged, image-less, HMAC-verified)
 *
 * @param {object} p
 * @param {string} p.policy      CAPTURE_WRITE_FAILURE_POLICY
 * @param {number} p.faultCount  current rolling lane-fault count (this failure included)
 * @param {number} p.maxFaults   LANE_FAULT_MAX
 * @returns {'hard_block'|'freeze'|'fallback'}
 */
function writeFailureDecision({ policy, faultCount, maxFaults }) {
    if (policy === 'hard_block') return 'hard_block';
    if (Number(faultCount) > Number(maxFaults)) return 'freeze';
    return 'fallback';
}

/**
 * Map a manager-review resolution to its coarse pay-gate band, the granular
 * audit outcome, and (for blocks) the fraud-incident action label. This is the
 * single source of truth that keeps the approve/reject/timeout routing aligned
 * with the automatic auto_approve/auto_block bands.
 *
 * @param {'approve'|'reject'|'timeout'} outcome
 * @returns {{band:string, outcome:string, action:(string|null)}|null}
 */
const REVIEW_RESOLUTION = Object.freeze({
    approve: { band: BAND.AUTO_APPROVE, outcome: 'manager_approved', action: 'CAPTURE_REVIEW_APPROVED' },
    reject:  { band: BAND.AUTO_BLOCK,   outcome: 'manager_rejected', action: 'CAPTURE_REVIEW_REJECTED' },
    timeout: { band: BAND.AUTO_BLOCK,   outcome: 'review_timeout',   action: 'CAPTURE_REVIEW_TIMEOUT' },
});

function resolveReviewOutcome(outcome) {
    return REVIEW_RESOLUTION[outcome] || null;
}

module.exports = { writeFailureDecision, resolveReviewOutcome, REVIEW_RESOLUTION };
