/**
 * Grahak Sathi — Cost-Aware AI Configuration (Otari Challenge)
 * ──────────────────────────────────────────────────────────
 * Single source of truth for the three-tier routing engine:
 *   • Tier definitions (Light / Medium / High)
 *   • Model assignment per tier
 *   • Estimated USD cost per inference call
 *   • Latency targets (the primary design constraint)
 *   • Hard per-session budget ceiling + degradation phases
 *
 * Every value is overridable via environment variables so the
 * economics can be tuned without touching code.
 */

const num = (v, d) => (v !== undefined && v !== '' && !isNaN(parseFloat(v)) ? parseFloat(v) : d);

// ── Tier identifiers ───────────────────────────────────────────────────────────
const TIER = Object.freeze({
    LIGHT:  'light',
    MEDIUM: 'medium',
    HIGH:   'high',
});

// ── Tier definitions ─────────────────────────────────────────────────────────────
// cost     : estimated USD deducted from the session budget per call
// latencyMs: target ceiling — latency is the primary design constraint
// model    : the model (or rule engine) that backs this tier
const TIERS = Object.freeze({
    [TIER.LIGHT]: {
        tier:      TIER.LIGHT,
        label:     'Light',
        model:     process.env.MODEL_LIGHT  || 'rule-engine',     // deterministic / sub-50ms
        cost:      num(process.env.COST_LIGHT,  0.0002),
        latencyMs: 50,
        note:      'Deterministic tasks: barcode lookup, alerts, logging, FAQ policy text',
    },
    [TIER.MEDIUM]: {
        tier:      TIER.MEDIUM,
        label:     'Medium',
        // Routed through the Otari LLM gateway. Set OTARI_MODEL (or MODEL_MEDIUM)
        // to whatever model/alias your Otari gateway exposes.
        model:     process.env.MODEL_MEDIUM || process.env.OTARI_MODEL || 'gpt-4o-mini',
        cost:      num(process.env.COST_MEDIUM, 0.01),
        latencyMs: 500,
        note:      'Contextual NLP via Otari gateway: intent classification, injection escalation, trend analysis',
    },
    [TIER.HIGH]: {
        tier:      TIER.HIGH,
        label:     'High',
        model:     process.env.MODEL_HIGH   || 'yolo-vision-v10',  // vision verification
        cost:      num(process.env.COST_HIGH,   0.08),
        latencyMs: 2000,
        note:      'Vision reasoning: ticket-switch detection, post-purchase image auditing',
    },
});

// ── Hard budget ceiling ──────────────────────────────────────────────────────────
const BUDGET_LIMIT = num(process.env.SESSION_BUDGET_USD, 2.00);   // $2.00 per session

// ── Per-store MONTHLY budget ceiling ─────────────────────────────────────────────
// A SEPARATE concept from the per-session demo budget above. The session budget
// ($2) exists to demo graceful degradation inside a single shopping session; the
// monthly store budget is the real-world cost cap that actually matters for a live
// store — the total LLM spend the store owner is willing to pay per calendar month
// (e.g. $10–20). It is tracked per shop and resets at the start of each month.
// Real-time fraud detection is intentionally NOT charged against this budget, so a
// drained monthly budget can never disable safety-critical fraud blocking.
const STORE_MONTHLY_BUDGET_USD = num(process.env.STORE_MONTHLY_BUDGET_USD, 15.00);

// ── Degradation phases (fraction of budget remaining) ─────────────────────────────
// NORMAL   : full routing available
// WARNING  : surfaced to UI, still full capability
// CRITICAL : <20% remaining → lock conversational tasks to Light,
//            reserve High tier exclusively for real-time fraud detection
const PHASE = Object.freeze({ NORMAL: 'NORMAL', WARNING: 'WARNING', CRITICAL: 'CRITICAL', EXHAUSTED: 'EXHAUSTED' });

const PHASE_THRESHOLDS = Object.freeze({
    warningAt:  num(process.env.BUDGET_WARNING_PCT,  0.50),   // ≤50% remaining
    criticalAt: num(process.env.BUDGET_CRITICAL_PCT, 0.20),   // ≤20% remaining
});

/** Resolve the degradation phase from the remaining budget. */
function phaseFor(remaining) {
    if (remaining <= 0) return PHASE.EXHAUSTED;
    const frac = remaining / BUDGET_LIMIT;
    if (frac <= PHASE_THRESHOLDS.criticalAt) return PHASE.CRITICAL;
    if (frac <= PHASE_THRESHOLDS.warningAt)  return PHASE.WARNING;
    return PHASE.NORMAL;
}

/**
 * Resolve the degradation phase for the per-store MONTHLY budget. Same phase
 * semantics as the session budget but relative to the (per-store) monthly limit,
 * which is passed in because it can be overridden per store.
 */
function storePhaseFor(remaining, limit = STORE_MONTHLY_BUDGET_USD) {
    if (!limit || limit <= 0) return PHASE.NORMAL;   // unlimited / disabled
    if (remaining <= 0) return PHASE.EXHAUSTED;
    const frac = remaining / limit;
    if (frac <= PHASE_THRESHOLDS.criticalAt) return PHASE.CRITICAL;
    if (frac <= PHASE_THRESHOLDS.warningAt)  return PHASE.WARNING;
    return PHASE.NORMAL;
}

/** Severity order for merging two phases — the MORE restrictive one wins. */
const PHASE_SEVERITY = Object.freeze({
    [PHASE.NORMAL]: 0, [PHASE.WARNING]: 1, [PHASE.CRITICAL]: 2, [PHASE.EXHAUSTED]: 3,
});
function mostSeverePhase(a, b) {
    return (PHASE_SEVERITY[a] ?? 0) >= (PHASE_SEVERITY[b] ?? 0) ? a : b;
}

// ── Task taxonomy ────────────────────────────────────────────────────────────────
// Maps every AI task in the platform to its *natural* tier and whether it is a
// conversational task (subject to Critical-phase lockdown) and/or a protected
// fraud-detection task (always preserved at High tier).
const TASKS = Object.freeze({
    barcode_lookup:      { baseTier: TIER.LIGHT,  conversational: false, fraudDetection: false },
    inventory_alert:     { baseTier: TIER.LIGHT,  conversational: false, fraudDetection: false },
    faq:                 { baseTier: TIER.LIGHT,  conversational: true,  fraudDetection: false },
    store_faq:           { baseTier: TIER.LIGHT,  conversational: true,  fraudDetection: false },
    product_lookup:      { baseTier: TIER.LIGHT,  conversational: false, fraudDetection: false },
    order_lookup:        { baseTier: TIER.LIGHT,  conversational: false, fraudDetection: false },
    inventory_trend:     { baseTier: TIER.MEDIUM, conversational: false, fraudDetection: false },
    injection_classify:  { baseTier: TIER.LIGHT,  conversational: false, fraudDetection: false },
    intent_parse:        { baseTier: TIER.MEDIUM, conversational: true,  fraudDetection: false },
    general_chat:        { baseTier: TIER.MEDIUM, conversational: true,  fraudDetection: false },
    ticket_switch_vision:{ baseTier: TIER.HIGH,   conversational: false, fraudDetection: true  },
    auditor_vision:      { baseTier: TIER.HIGH,   conversational: true,  fraudDetection: false },
});

module.exports = {
    TIER, TIERS, TASKS,
    BUDGET_LIMIT, STORE_MONTHLY_BUDGET_USD, PHASE, PHASE_THRESHOLDS,
    phaseFor, storePhaseFor, mostSeverePhase,
};
