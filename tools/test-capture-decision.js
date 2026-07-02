/**
 * Capture-decision verification suite (run: `node --test tools/test-capture-decision.js`
 * or `npm run test:capture`).
 *
 * This exercises the DECISION LOGIC of the checkout capture pipeline directly,
 * against the real modules (lib/captureThresholds, lib/retry, lib/captureResilience)
 * — the same code index.js runs. It deterministically covers scenarios 1–5 and the
 * Node-side portion of scenario 6 (decision latency).
 *
 * What this does NOT cover (needs the live stack — YOLO/EasyOCR in FastAPI, Redis,
 * PostgreSQL, a camera): the true camera-fire→decision wall-clock latency and the
 * HTTP/WebSocket wiring. Those are verified with the step-by-step runbook in
 * docs/CAPTURE_E2E_RUNBOOK.md (incl. the FastAPI /audit/capture-match/benchmark).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { classify, normalize, DEFAULTS, BAND } = require('../lib/captureThresholds');
const { retryWithBackoff, backoffSchedule } = require('../lib/retry');
const { writeFailureDecision, resolveReviewOutcome } = require('../lib/captureResilience');

// ── Scenario 1 — legitimate match, high confidence → auto-approve ─────────────
test('S1: high-confidence match auto-approves (> approve threshold)', () => {
    assert.equal(classify(0.99, DEFAULTS).band, BAND.AUTO_APPROVE);
    assert.equal(classify(0.95, DEFAULTS).band, BAND.AUTO_APPROVE);
    assert.equal(classify(0.9001, DEFAULTS).band, BAND.AUTO_APPROVE);
});

// ── Scenario 2 — deliberate mismatch (wrong product) → low score auto-blocks ──
test('S2: low-confidence mismatch auto-blocks (<= block threshold)', () => {
    assert.equal(classify(0.02, DEFAULTS).band, BAND.AUTO_BLOCK);
    assert.equal(classify(0.35, DEFAULTS).band, BAND.AUTO_BLOCK);
    assert.equal(classify(0.60, DEFAULTS).band, BAND.AUTO_BLOCK);   // boundary: <= 0.60 blocks
});

// ── Scenario 3 — borderline image → manager-review band ───────────────────────
test('S3: borderline confidence lands in the manager-review band', () => {
    assert.equal(classify(0.61, DEFAULTS).band, BAND.MANAGER_REVIEW);
    assert.equal(classify(0.75, DEFAULTS).band, BAND.MANAGER_REVIEW);
    assert.equal(classify(0.90, DEFAULTS).band, BAND.MANAGER_REVIEW);   // boundary: 0.90 is NOT > 0.90
});

test('S3: inconclusive confidence (no detection) is the safe middle → review', () => {
    assert.equal(classify(null, DEFAULTS).band, BAND.MANAGER_REVIEW);
    assert.equal(classify(undefined, DEFAULTS).band, BAND.MANAGER_REVIEW);
    assert.equal(classify(NaN, DEFAULTS).band, BAND.MANAGER_REVIEW);
});

test('per-store thresholds are honoured, and an inverted pair falls back to defaults', () => {
    const custom = { autoApprove: 0.80, autoBlock: 0.50 };
    assert.equal(classify(0.85, custom).band, BAND.AUTO_APPROVE);
    assert.equal(classify(0.55, custom).band, BAND.MANAGER_REVIEW);
    assert.equal(classify(0.50, custom).band, BAND.AUTO_BLOCK);
    // block >= approve is invalid → normalize reverts to global defaults
    assert.deepEqual(normalize({ autoApprove: 0.4, autoBlock: 0.7 }), { autoApprove: DEFAULTS.autoApprove, autoBlock: DEFAULTS.autoBlock });
    // out-of-range clamps into [0,1]
    assert.deepEqual(normalize({ autoApprove: 1.5, autoBlock: -0.2 }), { autoApprove: 1, autoBlock: 0 });
});

// ── Scenario 4 — manager approve within 60s → commit; no response → auto-block ─
test('S4: review resolution maps to the correct pay-gate band', () => {
    assert.equal(resolveReviewOutcome('approve').band, BAND.AUTO_APPROVE);
    assert.equal(resolveReviewOutcome('reject').band,  BAND.AUTO_BLOCK);
    assert.equal(resolveReviewOutcome('timeout').band, BAND.AUTO_BLOCK);   // no response → auto-block
});

test('S4: timeout is logged distinctly from an explicit rejection (for tuning)', () => {
    const reject  = resolveReviewOutcome('reject');
    const timeout = resolveReviewOutcome('timeout');
    assert.equal(reject.outcome,  'manager_rejected');
    assert.equal(timeout.outcome, 'review_timeout');
    assert.notEqual(reject.action, timeout.action);      // CAPTURE_REVIEW_REJECTED vs CAPTURE_REVIEW_TIMEOUT
    assert.equal(resolveReviewOutcome('approve').outcome, 'manager_approved');
    assert.equal(resolveReviewOutcome('bogus'), null);
});

// ── Scenario 5 — local storage failure → retry-then-fallback ──────────────────
test('S5: exponential backoff follows the 1s → 2s → 4s doubling family', () => {
    // The full exponential family from a 1s base doubles: 1s, 2s, 4s, …
    assert.deepEqual(backoffSchedule({ attempts: 4, baseDelayMs: 1000 }), [1000, 2000, 4000]);
    // The shipped capture config uses 3 attempts ⇒ the two inter-attempt waits are 1s, 2s.
    assert.deepEqual(backoffSchedule({ attempts: 3, baseDelayMs: 1000 }), [1000, 2000]);
});

test('S5: a write that recovers on a later attempt returns success + records the backoff waits', async () => {
    const waits = [];
    let calls = 0;
    const result = await retryWithBackoff(
        async () => { calls++; if (calls < 3) throw new Error('transient disk error'); return 'stored'; },
        { attempts: 3, baseDelayMs: 1000, sleepFn: async (ms) => { waits.push(ms); } },
    );
    assert.equal(result, 'stored');
    assert.equal(calls, 3);
    assert.deepEqual(waits, [1000, 2000]);   // waited 1s then 2s before the 2nd/3rd tries
});

test('S5: all attempts exhausted → throws the last error (hands off to the failure policy)', async () => {
    let calls = 0;
    await assert.rejects(
        retryWithBackoff(
            async () => { calls++; throw new Error(`disk dead #${calls}`); },
            { attempts: 3, baseDelayMs: 1, sleepFn: async () => {} },
        ),
        /disk dead #3/,
    );
    assert.equal(calls, 3);
});

test('S5: exhaustion policy — fallback under the cap, freeze over it, hard_block ignores the cap', () => {
    // hmac_fallback: up to LANE_FAULT_MAX (3) degraded captures are accepted…
    assert.equal(writeFailureDecision({ policy: 'hmac_fallback', faultCount: 1, maxFaults: 3 }), 'fallback');
    assert.equal(writeFailureDecision({ policy: 'hmac_fallback', faultCount: 3, maxFaults: 3 }), 'fallback');
    // …the 4th within the window freezes the lane.
    assert.equal(writeFailureDecision({ policy: 'hmac_fallback', faultCount: 4, maxFaults: 3 }), 'freeze');
    // hard_block refuses immediately regardless of count.
    assert.equal(writeFailureDecision({ policy: 'hard_block', faultCount: 1, maxFaults: 3 }), 'hard_block');
});

// ── Scenario 6 — decision-path latency (Node overhead) ────────────────────────
// The end-to-end camera→decision time is dominated by YOLO inference in FastAPI
// (measure it with /audit/capture-match/benchmark — see the runbook). Here we
// confirm the Node decision layer adds negligible overhead.
test('S6: the decision (classify) is sub-millisecond per call', () => {
    const N = 200000;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) classify(Math.random(), DEFAULTS);
    const t1 = process.hrtime.bigint();
    const perCallUs = Number(t1 - t0) / N / 1000;
    console.log(`   ⏱  classify(): ${perCallUs.toFixed(3)} µs/call over ${N.toLocaleString()} calls`);
    assert.ok(perCallUs < 50, `classify should be well under 50µs/call; measured ${perCallUs.toFixed(3)}µs`);
});
