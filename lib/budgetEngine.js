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

const { BUDGET_LIMIT, STORE_MONTHLY_BUDGET_USD, phaseFor, storePhaseFor, mostSeverePhase } = require('./aiConfig');

const SESSION_TTL = parseInt(process.env.BUDGET_SESSION_TTL) || 24 * 60 * 60; // 24h

function key(sessionId) {
    return `aibudget:spent:${sessionId}`;
}

// ── Per-store monthly budget keys ───────────────────────────────────────────
// Spend is bucketed by calendar month (YYYY-MM) so it resets automatically at
// the start of each month simply by rolling to a new key. The per-store limit
// override lives in its own key, seeded from the DB by the gateway.
function monthTag(d = new Date()) {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function storeSpentKey(shopId, d = new Date()) {
    return `aibudget:store:${shopId}:${monthTag(d)}`;
}
function storeLimitKey(shopId) {
    return `aibudget:store:limit:${shopId}`;
}
// Seconds until the first day of next month (UTC) — TTL for the monthly counter.
function secondsToMonthEnd(d = new Date()) {
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0));
    return Math.max(60, Math.floor((next - d) / 1000));
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
     *
     * When `shopId` is provided and the call actually spent money, the same cost
     * is ALSO recorded against the store's monthly budget (best-effort, never
     * blocks the session charge). `snapshot` stays session-only for the UI meter;
     * the store view is returned separately as `storeSnapshot`.
     */
    async function charge(sessionId, { tier, taskType, cost, shopId = null }) {
        const before = await getSpent(sessionId);
        if (round(before + cost) > BUDGET_LIMIT + 1e-9) {
            return {
                ok:       false,
                reason:   'BUDGET_EXCEEDED',
                charged:  0,
                snapshot: await snapshot(sessionId),
                storeSnapshot: shopId != null ? await storeSnapshot(shopId) : null,
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
        // Mirror the spend onto the store's monthly counter (fraud-detection calls
        // never reach here, so the monthly budget only ever tracks conversational AI).
        let storeSnap = null;
        if (shopId != null && cost > 0) {
            storeSnap = await chargeStore(shopId, cost);
        } else if (shopId != null) {
            storeSnap = await storeSnapshot(shopId);
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
            storeSnapshot: storeSnap,
        };
    }

    // ── Per-store monthly budget ────────────────────────────────────────────

    /** Read the per-store monthly limit (Redis override → global default). */
    async function getStoreLimit(shopId) {
        if (shopId == null) return STORE_MONTHLY_BUDGET_USD;
        try {
            const raw = await redisClient.get(storeLimitKey(shopId));
            if (raw !== null && raw !== '' && !isNaN(parseFloat(raw))) return round(parseFloat(raw));
        } catch (err) {
            console.warn('Store limit read error (fail-open):', err.message);
        }
        return STORE_MONTHLY_BUDGET_USD;
    }

    /** Set/override the per-store monthly limit (persisted in Redis; no TTL). */
    async function setStoreLimit(shopId, limitUsd) {
        const val = round(Math.max(0, parseFloat(limitUsd) || 0));
        try { await redisClient.set(storeLimitKey(shopId), String(val)); }
        catch (err) { console.warn('Store limit write error:', err.message); }
        return storeSnapshot(shopId);
    }

    /** Read the current month-to-date store spend (USD). Fails open → 0. */
    async function getStoreSpent(shopId) {
        try {
            const raw = await redisClient.get(storeSpentKey(shopId));
            return raw ? round(parseFloat(raw)) : 0;
        } catch (err) {
            console.warn('Store spend read error (fail-open):', err.message);
            return 0;
        }
    }

    /** Full monthly-budget snapshot for routing + the manager dashboard. */
    async function storeSnapshot(shopId) {
        const limit     = await getStoreLimit(shopId);
        const spent     = await getStoreSpent(shopId);
        const remaining = round(Math.max(0, limit - spent));
        return {
            shopId,
            month:        monthTag(),
            limit,
            spent,
            remaining,
            remainingPct: limit > 0 ? round((remaining / limit) * 100) : 100,
            phase:        storePhaseFor(remaining, limit),
            exhausted:    limit > 0 && remaining <= 0,
        };
    }

    /** Deduct `cost` from the store's monthly counter (best-effort). */
    async function chargeStore(shopId, cost) {
        try {
            const isNew = (await redisClient.exists(storeSpentKey(shopId))) === 0;
            await redisClient.incrByFloat(storeSpentKey(shopId), cost);
            if (isNew) await redisClient.expire(storeSpentKey(shopId), secondsToMonthEnd());
        } catch (err) {
            console.warn('Store charge error (fail-open):', err.message);
        }
        return storeSnapshot(shopId);
    }

    /**
     * Budget snapshot used for ROUTING decisions. When a shopId is supplied, the
     * session and monthly-store budgets are combined: `remaining` is the smaller
     * of the two and `phase` is the more restrictive of the two, so conversational
     * AI degrades gracefully when EITHER budget runs low. (Fraud-detection tasks
     * are exempt from budget stepping inside the router, so they are unaffected.)
     * The session-only meter snapshot is still exposed as `.session`.
     */
    async function routingSnapshot(sessionId, shopId = null) {
        const sess = await snapshot(sessionId);
        if (shopId == null) return sess;
        const store = await storeSnapshot(shopId);
        return {
            ...sess,
            remaining: round(Math.min(sess.remaining, store.remaining)),
            phase:     mostSeverePhase(sess.phase, store.phase),
            session:   sess,
            store,
        };
    }

    /** Reset a session's budget (e.g. new shopping session / new visitor). */
    async function reset(sessionId) {
        try { await redisClient.del(key(sessionId)); } catch (err) {
            console.warn('Budget reset error:', err.message);
        }
        return snapshot(sessionId);
    }

    return {
        snapshot, getSpent, canAfford, charge, reset,
        // Per-store monthly budget API
        getStoreLimit, setStoreLimit, getStoreSpent, storeSnapshot, chargeStore,
        routingSnapshot,
    };
}

module.exports = { createBudgetEngine };
