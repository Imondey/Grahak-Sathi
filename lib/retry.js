/**
 * Grahak Sathi — generic exponential-backoff retry.
 * ─────────────────────────────────────────────────
 * Used by the checkout capture write so a transient local-storage hiccup doesn't
 * drop the audit image. Default policy is 3 attempts with 1s → 2s → 4s delays.
 *
 * `sleepFn` and `onRetry` are injectable so the behaviour is fully unit-testable
 * without waiting real seconds (tests pass a no-op sleep and assert the exact
 * delay sequence and attempt count).
 */

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn` up to `attempts` times. Between failures it waits
 * baseDelayMs, 2×baseDelayMs, 4×baseDelayMs, … (exponential). Returns the first
 * successful result; throws the last error once all attempts are exhausted.
 *
 * @param {(attemptIndex:number)=>Promise<any>} fn         work to attempt (0-indexed attempt number)
 * @param {object}   opts
 * @param {number}   opts.attempts      max attempts (default 3)
 * @param {number}   opts.baseDelayMs   first backoff delay (default 1000 → 1s/2s/4s)
 * @param {string}   opts.label         label for logging
 * @param {Function} opts.sleepFn       (ms)=>Promise — injectable for tests
 * @param {Function} opts.onRetry       (attemptNumber, delayMs, error)=>void — side-effect hook (logging)
 */
async function retryWithBackoff(fn, {
    attempts = 3,
    baseDelayMs = 1000,
    label = 'operation',
    sleepFn = defaultSleep,
    onRetry = null,
} = {}) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn(i);
        } catch (e) {
            lastErr = e;
            if (i < attempts - 1) {
                const delay = baseDelayMs * (2 ** i);
                if (onRetry) onRetry(i + 1, delay, e);
                else console.warn(`⏳ ${label} failed (attempt ${i + 1}/${attempts}): ${e.message} — retrying in ${delay}ms`);
                await sleepFn(delay);
            }
        }
    }
    throw lastErr;
}

/** The delay schedule a given config would use (for tests / docs). */
function backoffSchedule({ attempts = 3, baseDelayMs = 1000 } = {}) {
    const delays = [];
    for (let i = 0; i < attempts - 1; i++) delays.push(baseDelayMs * (2 ** i));
    return delays;   // e.g. [1000, 2000, 4000] for 3 attempts (delays BETWEEN attempts)
}

module.exports = { retryWithBackoff, backoffSchedule, defaultSleep };
