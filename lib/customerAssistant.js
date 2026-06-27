/**
 * SmartRetail — Hybrid Customer Assistant (Otari Challenge)
 * ─────────────────────────────────────────────────────────
 * A general-purpose customer-support chatbot that answers ALL customer queries
 * — deliberately NOT a thin "AI wrapper". The LLM is the LAST resort, reached
 * only when grounded, deterministic sources can't answer.
 *
 * Resolution order (cheapest / most reliable first):
 *   0. Prompt-injection screen (2-stage) — block / escalate.
 *   1. Rule-based intent classifier (Light, no model call).
 *   2. Knowledge base       → curated FAQ / policy answers          [source: knowledge_base | policy]
 *   3. Live inventory lookup→ real product price & stock from DB    [source: live_inventory]
 *   4. Order lookup         → transaction / claim status from DB    [source: order_lookup]
 *   5. Visual audit         → delegate refund claims to the auditor [source: visual_audit]
 *   6. Grounded AI fallback → Medium-tier LLM with store context    [source: ai_generated]
 *   7. Human handoff        → out of scope / budget exhausted       [source: human_handoff]
 *
 * Every reply is tagged with the `source` that produced it, so it is provable
 * that most answers never touch an LLM.
 */

const KB_INTENT_SOURCE = {
    greeting:         'knowledge_base',
    thanks:           'knowledge_base',
    goodbye:          'knowledge_base',
    return_policy:    'policy',
    store_hours:      'knowledge_base',
    store_location:   'knowledge_base',
    contact_info:     'knowledge_base',
    payment_methods:  'knowledge_base',
    shipping_delivery:'knowledge_base',
    warranty:         'knowledge_base',
};

function createCustomerAssistant({
    kb, injection, router, budget, auditor,
    llm,
    classifyInjection = async () => null,
    lookupProduct = async () => [],
    lookupOrder   = async () => null,
    logUsage = async () => {}, logInjection = async () => {},
}) {

    // Whether the Otari LLM gateway is configured/available.
    const llmEnabled = !!(llm && llm.enabled);

    // Route an LLM call through the Otari gateway; null on failure → local fallback.
    async function callLLM(model, messages, { temperature = 0.3, maxTokens = 220 } = {}) {
        if (!llmEnabled) return null;
        const r = await llm.chat(messages, { model, temperature, maxTokens });
        return r ? r.content : null;
    }

    // Charge + log a routed step, returning the routing decision used.
    async function chargeStep(sessionId, shopId, taskType, snapshot, latencyMs = null) {
        const decision = router.route(taskType, { budget: snapshot });
        if (!decision.denied) {
            const c = await budget.charge(sessionId, { tier: decision.tier, taskType, cost: decision.estCost });
            await logUsage({ sessionId, shopId, taskType, tier: decision.tier, model: decision.model, cost: c.charged, latencyMs });
            decision._snapshot = c.snapshot;
        } else {
            decision._snapshot = snapshot;
        }
        return decision;
    }

    /**
     * @param {object} p
     * @param {string} p.sessionId
     * @param {number} [p.shopId]
     * @param {string} p.message
     * @param {string|number} [p.transactionId]
     * @param {string} [p.imageB64]
     */
    async function handle(p) {
        const { sessionId, shopId = null, message = '', transactionId = null, imageB64 = null } = p;
        const routing = [];

        // ── 0. Prompt injection — Stage 1 (sub-ms, free) ──────────────────────
        const scr = injection.screen(message);
        if (!scr.safe) {
            await logInjection({ sessionId, shopId, rawInput: message, stage: 1, pattern: scr.pattern });
            return {
                reply: 'I can only help with genuine questions about your purchase, our products, ' +
                       'and store policies. I can\'t change policy or authorise refunds without proper verification. ' +
                       'How can I help with your order?',
                intent: 'blocked', source: 'security', decision: 'BLOCKED_INJECTION',
                routing, budget: await budget.snapshot(sessionId),
                injection: { stage: 1, pattern: scr.pattern, blocked: true }, confidence: 1,
            };
        }
        // ── 0b. Prompt injection — Stage 2: local self-hosted LSTM classifier ─
        // Runs on every message that passed Stage-1. No external AI; fails open.
        const ml = await classifyInjection(message);
        if (ml && ml.available) {
            const snap0 = await budget.snapshot(sessionId);
            const dec0  = router.route('injection_classify', { budget: snap0 });   // light/local
            if (!dec0.denied) {
                const c = await budget.charge(sessionId, { tier: dec0.tier, taskType: 'injection_classify', cost: dec0.estCost });
                await logUsage({ sessionId, shopId, taskType: 'injection_classify', tier: dec0.tier, model: 'security-lstm', cost: c.charged });
                dec0._snapshot = c.snapshot;
            }
            routing.push({ ...dec0, model: 'security-lstm', reason: 'Local LSTM injection classifier (Stage 2)' });
            if (ml.injection) {
                await logInjection({ sessionId, shopId, rawInput: message, stage: 2, pattern: `LSTM_MODEL:${(ml.score ?? 0).toFixed(2)}` });
                return {
                    reply: 'I\'m only able to assist with legitimate store and order questions. Could you rephrase what you need?',
                    intent: 'blocked', source: 'security', decision: 'BLOCKED_INJECTION',
                    routing, budget: dec0._snapshot || await budget.snapshot(sessionId),
                    injection: { stage: 2, model: 'security-lstm', score: ml.score, blocked: true }, confidence: ml.confidence ?? 1,
                };
            }
        }

        // ── 1. Rule-based intent (Light, deterministic) ───────────────────────
        const det = kb.detectIntent(message);

        // ── 2/5. Static KB answers + greetings ────────────────────────────────
        if (det.answer && det.intent !== 'return_policy') {
            const dec = await chargeStep(sessionId, shopId, 'store_faq', await budget.snapshot(sessionId));
            routing.push(dec);
            return finalize({ reply: det.answer, intent: det.intent, source: KB_INTENT_SOURCE[det.intent] || 'knowledge_base',
                routing, budget: dec._snapshot, confidence: det.confidence });
        }
        if (det.intent === 'return_policy') {
            const dec = await chargeStep(sessionId, shopId, 'store_faq', await budget.snapshot(sessionId));
            routing.push(dec);
            return finalize({ reply: det.answer, intent: 'return_policy', source: 'policy',
                routing, budget: dec._snapshot, confidence: det.confidence });
        }

        // ── 3. Live inventory lookup ──────────────────────────────────────────
        if (det.intent === 'product_query') {
            const dec = await chargeStep(sessionId, shopId, 'product_lookup', await budget.snapshot(sessionId));
            routing.push(dec);
            const terms = kb.extractProductTerms(message);
            let products = [];
            if (shopId != null && terms.length) products = await lookupProduct(shopId, terms).catch(() => []);

            let reply;
            if (!shopId) {
                reply = 'I can check live prices and stock once you\'re in a store session. ' +
                        'Meanwhile, ask me about our return policy, store hours, payments, or delivery.';
            } else if (products.length === 0) {
                reply = `I couldn't find a matching product${terms.length ? ` for "${terms.join(' ')}"` : ''} ` +
                        `in our current inventory. Could you tell me the exact product name or barcode?`;
            } else {
                const lines = products.map(pr => {
                    const stock = pr.quantity > 0 ? `${pr.quantity} in stock` : 'out of stock';
                    const price = pr.price != null ? `₹${pr.price}` : 'price on request';
                    return `• ${pr.product_name} — ${price} (${stock})`;
                }).join('\n');
                reply = `Here's what I found in our live inventory:\n${lines}`;
            }
            return finalize({ reply, intent: 'product_query', source: 'live_inventory',
                routing, budget: dec._snapshot, confidence: det.confidence, products });
        }

        // ── 4. Order / claim status lookup ────────────────────────────────────
        if (det.intent === 'order_status') {
            const dec = await chargeStep(sessionId, shopId, 'order_lookup', await budget.snapshot(sessionId));
            routing.push(dec);
            let order = null;
            if (transactionId != null) order = await lookupOrder(shopId, transactionId).catch(() => null);

            let reply;
            if (!transactionId) {
                reply = 'Sure — please share your transaction ID and I\'ll look up the status for you.';
            } else if (!order) {
                reply = `I couldn't find any record for transaction "${transactionId}". ` +
                        `Please double-check the ID from your receipt.`;
            } else if (order.type === 'claim') {
                reply = `Your return claim for transaction ${transactionId} is currently: ${order.decision}. ` +
                        (order.decision === 'NEEDS_REVIEW' ? 'A store associate is reviewing it.' :
                         order.decision === 'APPROVED'     ? 'Your refund/exchange is approved.' :
                                                             'If you have questions, a store associate can help.');
            } else {
                reply = `Transaction ${transactionId} (${order.product_name || 'item'}) status: ${order.status || 'recorded'}.`;
            }
            return finalize({ reply, intent: 'order_status', source: 'order_lookup',
                routing, budget: dec._snapshot, confidence: det.confidence });
        }

        // ── 5. Refund/return CLAIM → delegate to the visual auditor ───────────
        if (det.intent === 'return_claim') {
            const res = await auditor.handleMessage({ sessionId, shopId, message, transactionId, imageB64, skipInjection: true });
            // Merge the auditor's routing into our trace.
            const mergedRouting = routing.concat(res.routing || []);
            return {
                reply: res.reply, intent: res.intent || 'return_claim', source: 'visual_audit',
                decision: res.decision, verification: res.verification || null,
                routing: mergedRouting, budget: res.budget, injection: res.injection || { stage: 0, blocked: false },
                confidence: 0.9,
            };
        }

        // ── 6. Grounded AI fallback (Medium tier) — last resort ───────────────
        const snapAI = await budget.snapshot(sessionId);
        const aiDec  = router.route('general_chat', { budget: snapAI });
        routing.push(aiDec);

        // Budget too low for Medium, or no LLM gateway configured → human handoff.
        if (aiDec.denied || aiDec.tier !== 'medium' || !llmEnabled) {
            return finalize({
                reply: 'I\'m not certain I can answer that accurately. You can reach our team at ' +
                       `${kb.STORE_PROFILE.phone} or ${kb.STORE_PROFILE.email}, or ask me about returns, ` +
                       'products, orders, store hours, payments, or delivery.',
                intent: 'other', source: 'human_handoff',
                routing, budget: snapAI, confidence: 0.2,
            });
        }

        const t0 = Date.now();
        const answer = await callLLM(aiDec.model, [
            { role: 'system', content:
                `You are the customer-support assistant for ${kb.STORE_PROFILE.name}. Answer ONLY using the ` +
                `store context below. If the answer isn't in the context, say you'll connect them to a store ` +
                `associate — do NOT invent details, prices, or policies. Be concise and friendly.\n\n` +
                `STORE CONTEXT: ${kb.groundingContext()}` },
            { role: 'user', content: message.slice(0, 600) },
        ], { temperature: 0.3, maxTokens: 220 });
        const latencyMs = Date.now() - t0;

        const charge = await budget.charge(sessionId, { tier: aiDec.tier, taskType: 'general_chat', cost: aiDec.estCost });
        await logUsage({ sessionId, shopId, taskType: 'general_chat', tier: aiDec.tier, model: aiDec.model, cost: charge.charged, latencyMs });

        if (!answer) {
            return finalize({
                reply: 'I\'m having trouble answering that right now. Please reach our team at ' +
                       `${kb.STORE_PROFILE.phone} or ${kb.STORE_PROFILE.email}.`,
                intent: 'other', source: 'human_handoff',
                routing, budget: charge.snapshot, confidence: 0.2,
            });
        }
        return finalize({
            reply: answer, intent: 'other', source: 'ai_generated',
            routing, budget: charge.snapshot, confidence: 0.6, latencyMs,
        });
    }

    function finalize(o) {
        return {
            reply: o.reply,
            intent: o.intent,
            source: o.source,
            decision: o.decision || null,
            verification: o.verification || null,
            routing: o.routing || [],
            budget: o.budget,
            injection: o.injection || { stage: 0, blocked: false },
            confidence: o.confidence ?? null,
            products: o.products || null,
            latencyMs: o.latencyMs || null,
        };
    }

    return { handle };
}

module.exports = { createCustomerAssistant };
