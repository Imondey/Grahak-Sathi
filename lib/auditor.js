/**
 * SmartRetail — Post-Purchase Conversational Auditor (Otari Challenge, Case 1)
 * ───────────────────────────────────────────────────────────────────────────
 * An automated chatbot that resolves 30-day return-policy claims WITHOUT manual
 * employee intervention, while staying inside the per-session budget.
 *
 * Pipeline (every stage is routed + budget-charged):
 *   0. Prompt-injection screen (2-stage). Stage-1 hit → hard block, no spend.
 *      Stage-2 anomaly → Medium-tier model review (charged) before proceeding.
 *   1. Intent capture  — Medium tier parses the claim (refund / exchange / FAQ /
 *      issue type such as "broken label").
 *   2. FAQ branch      — Light tier returns canned policy text (no model spend).
 *   3. Data retrieval  — pull the live checkout image saved for the transaction.
 *   4. Visual verify   — High tier (FastAPI vision) audits the image against the
 *      claim. Under Critical budget this step is locked to Light → policy text
 *      only + deferral, preserving High tier for real-time fraud detection.
 *   5. Automated decision — APPROVED (refund possible + T&C) / DENIED (visual
 *      evidence contradicts claim) / NEEDS_REVIEW.
 *
 * Dependency-injected so it stays testable and reuses the gateway's clients.
 */

const RETURN_POLICY_TEXT =
    'Our return policy allows returns within 30 days of purchase. Eligible items must be ' +
    'verified against the live image captured at checkout. Approved returns may be refunded ' +
    'to the original payment method or exchanged, subject to inspection terms & conditions.';

const ISSUE_KEYWORDS = {
    seal:         /\b(seal|sealed|tamper|tampered|tampering)\b|\b(packaging|package|box|wrapper|wrapping)\b.{0,20}\b(broken|open|opened|torn|tamper|tampered|damaged|missing)\b/i,
    broken_label: /\b(broken|torn|peel|peeled|missing|damaged|illegible)\b.{0,20}\b(label|sticker|tag)\b|\blabel\b.{0,20}\b(broken|torn|missing|damaged)\b/i,
    damaged:      /\b(broken|cracked|damaged|defect|defective|not working|dead|shattered|scratched|leaking|spoilt|spoiled)\b/i,
    wrong_size:   /\b(wrong|incorrect|different)\b.{0,15}\b(size|fit)\b|\b(too (big|small|large|tight|loose))\b|\bsize\b.{0,15}\b(wrong|issue)\b/i,
    wrong_item:   /\b(wrong|different|not what i ordered|incorrect)\b.{0,15}\b(item|product|thing)\b/i,
};

// Detect the purchase channel from the customer's wording.
//   online  → bought online / delivered / shipped / courier
//   offline → bought in-store / at the shop / in person
//   null    → unknown (caller decides; auto-detected from a delivery photo if present)
function detectChannel(message) {
    const m = String(message || '').toLowerCase();
    if (/\b(online|website|web ?site|the app|e-?commerce|delivered|delivery|deliver|courier|shipped|shipping|dispatch|parcel|package (arrived|came)|arrived|amazon|flipkart|home delivery)\b/.test(m)) return 'online';
    if (/\b(in[- ]?store|offline|at the (store|shop)|in person|store counter|physical store|over the counter|came to the (store|shop)|from the shop)\b/.test(m)) return 'offline';
    return null;
}

function heuristicIntent(message) {
    const m = String(message || '').toLowerCase();
    let intent = 'other';
    if (/\b(refund|money back|return.*money|reimburse)\b/.test(m)) intent = 'refund';
    else if (/\b(exchange|replace|swap|different one)\b/.test(m)) intent = 'exchange';
    else if (/\b(return policy|how (long|many days)|policy|\bterms\b|how do i return|can i return)\b/.test(m)) intent = 'faq';
    else if (/\b(refund|return)\b/.test(m)) intent = 'refund';

    let issue = null;
    for (const [k, re] of Object.entries(ISSUE_KEYWORDS)) {
        if (re.test(m)) { issue = k; break; }
    }
    return { intent, issue };
}

function createAuditor({ llm, axios, fastapiUrl, budget, router, injection,
                          classifyInjection = async () => null,
                          logUsage = async () => {}, logInjection = async () => {},
                          getCheckoutImage = async () => null,
                          getDeliveryImage = async () => null }) {

    // Whether the Otari LLM gateway is configured/available for this orchestrator.
    const llmEnabled = !!(llm && llm.enabled);

    /** Route an LLM call through the Otari gateway; null on any failure (caller falls back). */
    async function callLLM(model, messages, { temperature = 0.2, maxTokens = 200 } = {}) {
        if (!llmEnabled) return null;
        const r = await llm.chat(messages, { model, temperature, maxTokens });
        return r ? r.content : null;
    }

    /**
     * @param {object} p
     * @param {string} p.sessionId      budget session id (per visitor)
     * @param {number} [p.shopId]
     * @param {string} p.message        the customer's chat message
     * @param {string|number} [p.transactionId]
     * @param {string} [p.imageB64]     optional client-supplied checkout image
     */
    async function handleMessage(p) {
        const { sessionId, shopId = null, message = '', transactionId = null, imageB64 = null, skipInjection = false } = p;
        const channelHint = p.channel ? String(p.channel).toLowerCase() : null;
        const userId = p.userId || null;        // customer identifier for purchase-history check
        const mkId   = p.mkId   || null;        // explicit MK-ID, if provided
        const routing = [];

        // ── STAGE 0 — Prompt injection screening (skipped if caller already did it) ──
        if (!skipInjection) {
            // Stage 1 — sub-ms regex pass.
            const scr = injection.screen(message);
            if (!scr.safe) {
                await logInjection({ sessionId, shopId, rawInput: message, stage: 1, pattern: scr.pattern });
                const snap = await budget.snapshot(sessionId);
                return {
                    reply: 'I can only help with genuine return and refund questions for your purchase. ' +
                           'I can\'t change store policy or authorise refunds without verifying your checkout image.',
                    intent: 'blocked',
                    decision: 'BLOCKED_INJECTION',
                    verification: null,
                    routing,
                    budget: snap,
                    injection: { stage: 1, pattern: scr.pattern, blocked: true },
                };
            }

            // Stage 2 — local self-hosted LSTM classifier (no external AI; fails open).
            const ml = await classifyInjection(message);
            if (ml && ml.available) {
                const snap0 = await budget.snapshot(sessionId);
                const dec0  = router.route('injection_classify', { budget: snap0 });
                if (!dec0.denied) {
                    const charge = await budget.charge(sessionId, { tier: dec0.tier, taskType: 'injection_classify', cost: dec0.estCost });
                    await logUsage({ sessionId, shopId, taskType: 'injection_classify', tier: dec0.tier, model: 'security-lstm', cost: charge.charged });
                    dec0._snapshot = charge.snapshot;
                }
                routing.push({ ...dec0, model: 'security-lstm', reason: 'Local LSTM injection classifier (Stage 2)' });
                if (ml.injection) {
                    await logInjection({ sessionId, shopId, rawInput: message, stage: 2, pattern: `LSTM_MODEL:${(ml.score ?? 0).toFixed(2)}` });
                    return {
                        reply: 'I\'m only able to assist with legitimate return requests. Could you tell me, in plain words, ' +
                               'what is wrong with the item you purchased?',
                        intent: 'blocked',
                        decision: 'BLOCKED_INJECTION',
                        verification: null,
                        routing,
                        budget: dec0._snapshot || await budget.snapshot(sessionId),
                        injection: { stage: 2, model: 'security-lstm', score: ml.score, blocked: true },
                    };
                }
            }
        }

        // ── STAGE 1 — Intent capture (Medium tier) ────────────────────────────
        const snap1 = await budget.snapshot(sessionId);
        const intentDecision = router.route('intent_parse', { budget: snap1 });
        routing.push(intentDecision);

        let parsed = heuristicIntent(message);
        if (intentDecision.tier === 'medium' && !intentDecision.denied) {
            const llmRaw = await callLLM(intentDecision.model, [
                { role: 'system', content:
                    'Classify a retail customer message. Respond ONLY as compact JSON: ' +
                    '{"intent":"refund|exchange|faq|other","issue":"broken_label|damaged|wrong_size|wrong_item|none"}.' },
                { role: 'user', content: message.slice(0, 600) },
            ], { temperature: 0, maxTokens: 40 });
            const charge = await budget.charge(sessionId, { tier: intentDecision.tier, taskType: 'intent_parse', cost: intentDecision.estCost });
            await logUsage({ sessionId, shopId, taskType: 'intent_parse', tier: intentDecision.tier, model: intentDecision.model, cost: charge.charged });
            if (llmRaw) {
                try {
                    const j = JSON.parse(llmRaw.replace(/```json|```/g, '').trim());
                    parsed = { intent: j.intent || parsed.intent, issue: (j.issue && j.issue !== 'none') ? j.issue : parsed.issue };
                } catch { /* keep heuristic */ }
            }
        } else if (!intentDecision.denied) {
            // Degraded to Light tier — heuristic only, charge Light.
            const charge = await budget.charge(sessionId, { tier: intentDecision.tier, taskType: 'intent_parse', cost: intentDecision.estCost });
            await logUsage({ sessionId, shopId, taskType: 'intent_parse', tier: intentDecision.tier, model: intentDecision.model, cost: charge.charged });
        }

        // ── STAGE 2 — FAQ branch (Light tier, deterministic, free-ish) ────────
        if (parsed.intent === 'faq' || parsed.intent === 'other') {
            const snapF = await budget.snapshot(sessionId);
            const decF  = router.route('faq', { budget: snapF });
            routing.push(decF);
            const charge = await budget.charge(sessionId, { tier: decF.tier, taskType: 'faq', cost: decF.estCost });
            await logUsage({ sessionId, shopId, taskType: 'faq', tier: decF.tier, model: decF.model, cost: charge.charged });
            return {
                reply: parsed.intent === 'faq'
                    ? RETURN_POLICY_TEXT
                    : 'I can help with returns and refunds. ' + RETURN_POLICY_TEXT +
                      ' If you\'d like to start a claim, tell me your transaction ID and what went wrong.',
                intent: parsed.intent,
                decision: 'INFO',
                verification: null,
                routing,
                budget: charge.snapshot,
                injection: { stage: 0, blocked: false },
            };
        }

        // ── refund / exchange claim → MK-ID-anchored verification + pickup ────
        // The decision hinges on the transaction id: we look up the MK-ID(s)
        // linked to that transaction (the unit[s] the customer bought), extract
        // the MK-ID from their uploaded photo, and if it matches one of them we
        // confirm the refund and initiate pickup.
        const customerImage = imageB64 || null;
        const productName   = (p.productName || '').toString().trim() || null;

        // We need the transaction ID plus a way to identify the unit: a photo we
        // can read the MK-ID from, or an MK-ID the customer provides directly.
        const missing = [];
        if (!transactionId)          missing.push('your transaction ID');
        if (!customerImage && !mkId) missing.push('a clear photo of the product (or its MK-ID)');
        if (missing.length) {
            const list = missing.length === 1 ? missing[0]
                : missing.slice(0, -1).join(', ') + ' and ' + missing[missing.length - 1];
            return {
                reply: `Sure, I can help with your refund. To verify it I need ${list}. ` +
                       `Everything is checked against your transaction ID — please add the missing detail(s) and send again.`,
                intent: parsed.intent,
                decision: 'NEEDS_REVIEW',
                verification: { reason: 'AWAITING_INFO', missing, transaction_id: transactionId || null },
                routing,
                budget: await budget.snapshot(sessionId),
                injection: { stage: 0, blocked: false },
            };
        }

        // Reading the MK-ID from the photo is a High-tier (vision) task — budget-
        // aware degradation. If the customer typed the MK-ID we can still verify
        // it against the transaction without vision; we only defer when we'd
        // actually need to OCR the photo.
        const snap2  = await budget.snapshot(sessionId);
        const visDec = router.route('auditor_vision', { budget: snap2 });
        routing.push(visDec);

        if (visDec.tier !== 'high' && !mkId) {
            const charge = await budget.charge(sessionId, { tier: visDec.tier, taskType: 'auditor_vision', cost: visDec.estCost });
            await logUsage({ sessionId, shopId, taskType: 'auditor_vision_degraded', tier: visDec.tier, model: visDec.model, cost: charge.charged });
            return {
                reply: `Thanks — I've logged your ${parsed.intent} request for transaction ${transactionId}. ` +
                       'Automated photo verification is temporarily limited right now, so a store associate ' +
                       'will complete the check and follow up. ' + RETURN_POLICY_TEXT,
                intent: parsed.intent,
                decision: 'NEEDS_REVIEW',
                verification: { degraded: true, reason: visDec.reason, transaction_id: transactionId },
                routing,
                budget: charge.snapshot,
                injection: { stage: 0, blocked: false },
            };
        }

        // Extract the MK-ID from the photo (or use the provided one) and match it
        // against the MK-ID(s) linked to this transaction.
        let rv = null;
        const t0 = Date.now();
        try {
            const r = await axios.post(`${fastapiUrl}/audit/refund-pickup`, {
                transaction_id: transactionId,
                image_b64:      customerImage,
                mk_id:          mkId,
                product_name:   productName,
            }, { timeout: 30000 });
            rv = r.data;
        } catch (err) {
            console.warn('Refund-pickup verification unavailable:', err.message);
        }
        const latencyMs = Date.now() - t0;

        const charge = await budget.charge(sessionId, { tier: visDec.tier, taskType: 'auditor_vision', cost: visDec.estCost });
        await logUsage({ sessionId, shopId, taskType: 'auditor_vision', tier: visDec.tier, model: visDec.model, cost: charge.charged, latencyMs });

        if (!rv) {
            return {
                reply: 'Our verification service is briefly unavailable. Your request is saved and a store ' +
                       'associate will complete the review shortly.',
                intent: parsed.intent,
                decision: 'NEEDS_REVIEW',
                verification: { reason: 'VERIFY_UNAVAILABLE', transaction_id: transactionId },
                routing,
                budget: charge.snapshot,
                injection: { stage: 0, blocked: false },
            };
        }

        // Decision — driven by whether the extracted MK-ID matches the transaction.
        let decision, reply;
        if (rv.refund_done || rv.matched) {
            decision = 'APPROVED';
            reply = `✅ ${rv.message} ${RETURN_POLICY_TEXT}`;
        } else if (rv.reason === 'lookup_error' || rv.reason === 'unrecognized') {
            decision = 'NEEDS_REVIEW';
            reply = rv.message;
        } else {
            decision = 'DENIED';
            reply = `❌ ${rv.message} If you believe this is a mistake, a store associate can take a closer look.`;
        }

        return {
            intent: parsed.intent,
            decision,
            reply,
            verification: {
                transaction_id: transactionId,
                product_name:   rv.product_name || productName,
                mk_id:          rv.recognized_mk_id || mkId || null,
                recognition:    rv.recognition_method || null,
                refund_done:    rv.refund_done ?? false,
                matched:        rv.matched ?? false,
                reason:         rv.reason || null,
                latencyMs,
            },
            routing,
            budget: charge.snapshot,
            injection: { stage: 0, blocked: false },
        };
    }

    return { handleMessage, RETURN_POLICY_TEXT };
}

module.exports = { createAuditor, RETURN_POLICY_TEXT };
