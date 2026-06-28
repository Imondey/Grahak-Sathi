/**
 * Grahak Sathi — Dynamic Model Router (Otari Challenge)
 * ────────────────────────────────────────────────────
 * The technical core. Before any request reaches a model, this router assigns
 * it to one of three tiers (Light / Medium / High) based on:
 *   1. The task's natural complexity (from the TASKS taxonomy)
 *   2. The remaining session budget (degradation phase)
 *   3. Affordability against the hard $2 ceiling
 *
 * Graceful degradation rules (Critical phase, <20% budget remaining):
 *   • Conversational tasks (FAQ, intent parsing, post-purchase image audit)
 *     are LOCKED to the Light tier — policy text only, no image reasoning.
 *   • The High tier is RESERVED exclusively for real-time ticket-switching
 *     detection at checkout (fraudDetection:true), which must never degrade.
 *   • If even the Light tier is unaffordable → the call is denied (budget hard stop).
 */

const { TIER, TIERS, TASKS, PHASE } = require('./aiConfig');

const ORDER = [TIER.LIGHT, TIER.MEDIUM, TIER.HIGH];

function tierMeta(tier) {
    const t = TIERS[tier];
    return { tier: t.tier, model: t.model, estCost: t.cost, latencyTargetMs: t.latencyMs };
}

/**
 * Decide which tier should serve a task.
 *
 * @param {string} taskType  one of the keys in TASKS
 * @param {object} ctx
 * @param {object} ctx.budget   budget snapshot { phase, remaining, ... }
 * @param {string} [ctx.forceTier]  optional manual override
 * @returns {object} routing decision
 */
function route(taskType, ctx = {}) {
    const task   = TASKS[taskType];
    const budget = ctx.budget || { phase: PHASE.NORMAL, remaining: Infinity };

    if (!task) {
        // Unknown task → safest, cheapest tier.
        return {
            taskType,
            ...tierMeta(TIER.LIGHT),
            naturalTier: TIER.LIGHT,
            degraded:    false,
            denied:      false,
            phase:       budget.phase,
            reason:      'Unknown task type — defaulted to Light tier.',
        };
    }

    let chosen   = task.baseTier;
    let degraded = false;
    let reason   = `Routed to ${TIERS[chosen].label} tier (task default).`;

    // ── Manual override (still bounded by affordability below) ──────────────
    if (ctx.forceTier && TIERS[ctx.forceTier]) {
        chosen = ctx.forceTier;
        reason = `Manual override → ${TIERS[chosen].label} tier.`;
    }

    // ── Budget-aware graceful degradation ───────────────────────────────────
    if (budget.phase === PHASE.CRITICAL) {
        if (task.fraudDetection) {
            // Ticket-switch detection is preserved at full strength.
            reason = `Critical budget — High tier PRESERVED for real-time fraud detection.`;
        } else if (task.conversational && chosen !== TIER.LIGHT) {
            chosen   = TIER.LIGHT;
            degraded = true;
            reason   = `Critical budget (<20%) — conversational task locked to Light tier (policy text only).`;
        } else if (chosen === TIER.HIGH) {
            chosen   = TIER.MEDIUM;
            degraded = true;
            reason   = `Critical budget — non-fraud High-tier task downgraded to Medium.`;
        }
    } else if (budget.phase === PHASE.EXHAUSTED) {
        if (task.fraudDetection) {
            reason = `Budget exhausted — fraud detection still permitted (safety-critical).`;
        } else {
            chosen   = TIER.LIGHT;
            degraded = true;
            reason   = `Budget exhausted — degraded to Light tier (free/deterministic only).`;
        }
    }

    // ── Affordability: step down until the tier fits the remaining budget ───
    // Fraud-detection tasks are exempt (must run even on a Redis/budget blip).
    if (!task.fraudDetection && isFinite(budget.remaining)) {
        let idx = ORDER.indexOf(chosen);
        while (idx > 0 && TIERS[chosen].cost > budget.remaining + 1e-9) {
            idx--;
            chosen   = ORDER[idx];
            degraded = true;
            reason   = `Insufficient budget for higher tier — stepped down to ${TIERS[chosen].label}.`;
        }
        if (TIERS[chosen].cost > budget.remaining + 1e-9) {
            // Even the cheapest tier is unaffordable.
            return {
                taskType,
                ...tierMeta(chosen),
                naturalTier: task.baseTier,
                degraded:    true,
                denied:      true,
                phase:       budget.phase,
                reason:      `Hard budget limit reached — request denied.`,
            };
        }
    }

    return {
        taskType,
        ...tierMeta(chosen),
        naturalTier: task.baseTier,
        degraded,
        denied:      false,
        phase:       budget.phase,
        reason,
    };
}

module.exports = { route };
