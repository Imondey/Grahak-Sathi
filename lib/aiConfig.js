/**
 * SmartRetail — Cost-Aware AI Configuration (Otari Challenge)
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
        model:     process.env.MODEL_MEDIUM || 'llama-3.1-8b-instant',
        cost:      num(process.env.COST_MEDIUM, 0.01),
        latencyMs: 500,
        note:      'Contextual NLP: intent classification, injection escalation, trend analysis',
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

// ── Task taxonomy ────────────────────────────────────────────────────────────────
// Maps every AI task in the platform to its *natural* tier and whether it is a
// conversational task (subject to Critical-phase lockdown) and/or a protected
// fraud-detection task (always preserved at High tier).
const TASKS = Object.freeze({
    barcode_lookup:      { baseTier: TIER.LIGHT,  conversational: false, fraudDetection: false },
    inventory_alert:     { baseTier: TIER.LIGHT,  conversational: false, fraudDetection: false },
    faq:                 { baseTier: TIER.LIGHT,  conversational: true,  fraudDetection: false },
    inventory_trend:     { baseTier: TIER.MEDIUM, conversational: false, fraudDetection: false },
    injection_classify:  { baseTier: TIER.MEDIUM, conversational: false, fraudDetection: false },
    intent_parse:        { baseTier: TIER.MEDIUM, conversational: true,  fraudDetection: false },
    ticket_switch_vision:{ baseTier: TIER.HIGH,   conversational: false, fraudDetection: true  },
    auditor_vision:      { baseTier: TIER.HIGH,   conversational: true,  fraudDetection: false },
});

module.exports = {
    TIER, TIERS, TASKS,
    BUDGET_LIMIT, PHASE, PHASE_THRESHOLDS,
    phaseFor,
};
