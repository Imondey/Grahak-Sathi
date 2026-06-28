/**
 * Grahak Sathi — Budget Engine (Otari Challenge)
 * ─────────────────────────────────────────────
 * Enforces a HARD cumulative spending limit per session ($2 by default).
 * Every model call deducts its estimated cost; once the ceiling is hit the
 * engine refuses further paid calls and the router degrades gracefully.
 *
 * State lives in Redis (key: aibudget:spent:<sessionId>) so it survives across
 * the stateless HTTP requests that make up a single logical "session", and is
 * shared by the Node gateway. Fails OPEN for reads but FAILS CLOSED on charge
 * errors for paid tiers is avoided — instead we fail open with a logged warning
 * so a Redis blip never bricks checkout (fraud detection must keep working).
 *
 * Usage:
 *   const budget = createBudgetEngine(redisClient);
 *   const snap   = await budget.snapshot(sessionId);
 *   const charge = await budget.charge(sessionId, { tier, taskType, cost });
 */

const { BUDGET_LIMIT, phaseFor } = require('./aiConfig');

const SESSION_TTL = parseInt(process.env.BUDGET_SESSION_TTL) || 24 * 60 * 60; // 24h

function key(sessionId) {
    return `aibudget:spent:${sessionId}`;
}

function round(n) {
    return Math.round(n * 10000) / 10000;
}

function createBudgetEngine(redisClient) {
    /** Read current spend (USD) for a session. Fails open → 0. */
    async function getSpent(sessionId) {
        try {
            const raw = await redisClient.get(key(sessionId));
            return raw ? round(parseFloat(raw)) : 0;
        } catch (err) {
            console.warn('Budget read error (fail-open):', err.message);
            return 0;
        }
    }

    /** Full budget snapshot for routing decisions + UI transparency. */
    async function snapshot(sessionId) {
        const spent     = await getSpent(sessionId);
        const remaining = round(Math.max(0, BUDGET_LIMIT - spent));
        const phase     = phaseFor(remaining);
        return {
            sessionId,
            limit:        BUDGET_LIMIT,
            spent,
            remaining,
            remainingPct: round((remaining / BUDGET_LIMIT) * 100),
            phase,
        };
    }

    /**
     * Returns whether `cost` can be afforded without breaching the hard limit.
     * Does NOT mutate state.
     */
    async function canAfford(sessionId, cost) {
        const spent = await getSpent(sessionId);
        return round(spent + cost) <= BUDGET_LIMIT + 1e-9;
    }

    /**
     * Deduct `cost` for a completed/authorised inference call.
     * Returns { ok, charged, snapshot } — ok=false means the hard limit would
     * have been breached and NOTHING was charged.
     */
    async function charge(sessionId, { tier, taskType, cost }) {
        const before = await getSpent(sessionId);
        if (round(before + cost) > BUDGET_LIMIT + 1e-9) {
            return {
                ok:       false,
                reason:   'BUDGET_EXCEEDED',
                charged:  0,
                snapshot: await snapshot(sessionId),
            };
        }
        let after = round(before + cost);
        try {
            // INCRBYFLOAT is atomic; set TTL on first write.
            after = round(parseFloat(await redisClient.incrByFloat(key(sessionId), cost)));
            if (before === 0) await redisClient.expire(key(sessionId), SESSION_TTL);
        } catch (err) {
            console.warn('Budget charge error (fail-open):', err.message);
        }
        const remaining = round(Math.max(0, BUDGET_LIMIT - after));
        return {
            ok:       true,
            charged:  cost,
            tier,
            taskType,
            snapshot: {
                sessionId,
                limit:        BUDGET_LIMIT,
                spent:        after,
                remaining,
                remainingPct: round((remaining / BUDGET_LIMIT) * 100),
                phase:        phaseFor(remaining),
            },
        };
    }

    /** Reset a session's budget (e.g. new shopping session / new visitor). */
    async function reset(sessionId) {
        try { await redisClient.del(key(sessionId)); } catch (err) {
            console.warn('Budget reset error:', err.message);
        }
        return snapshot(sessionId);
    }

    return { snapshot, getSpent, canAfford, charge, reset };
}

module.exports = { createBudgetEngine };
