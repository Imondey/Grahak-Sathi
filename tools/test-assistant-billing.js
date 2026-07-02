/**
 * Customer-assistant billing regression suite
 * (run: `npm run test:billing` or `node --test tools/test-assistant-billing.js`).
 *
 * Guards the fix where a failed/empty Medium-tier LLM completion must NOT charge
 * the session budget or show a cost in the usage-transparency panel (the panel
 * sums each routing step's estCost). A successful completion still bills once.
 *
 * customerAssistant is a pure factory (no top-level requires), so it's driven
 * here with in-memory fakes — no services / node_modules needed.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCustomerAssistant } = require('../lib/customerAssistant');

function build(llmChatImpl) {
    const charges = [];
    const assistant = createCustomerAssistant({
        kb: {
            detectIntent: () => ({ intent: 'other', confidence: 0, answer: null }), // force AI fallback
            STORE_PROFILE: { name: 'Test Store', phone: 'PH', email: 'EM' },
            groundingContext: () => 'ctx',
        },
        injection: { screen: () => ({ safe: true }), looksLikePromptLeak: () => false },
        router: {
            route: (taskType) => ({
                taskType, tier: 'medium', model: 'openai/gpt-4o-mini',
                estCost: 0.01, denied: false, degraded: false, reason: 'default',
            }),
        },
        budget: {
            snapshot:        async () => ({ phase: 'NORMAL', remaining: 2 }),
            routingSnapshot: async () => ({ phase: 'NORMAL', remaining: 2 }),
            charge: async (_sessionId, args) => { charges.push(args); return { charged: args.cost, snapshot: { phase: 'NORMAL', remaining: 2 - args.cost } }; },
        },
        auditor: { handleMessage: async () => ({ reply: 'n/a' }) },
        llm: { enabled: true, chat: llmChatImpl },
    });
    return { assistant, charges };
}

test('empty LLM completion → NOT charged, routing cost zeroed, handed off', async () => {
    const { assistant, charges } = build(async () => null);            // gateway returns nothing
    const r = await assistant.handle({ sessionId: 's1', shopId: 1, message: 'tell me a joke' });

    assert.equal(r.source, 'human_handoff');
    assert.equal(charges.length, 0, 'budget.charge must NOT be called for an empty completion');

    const step = r.routing.find(s => s.taskType === 'general_chat');
    assert.ok(step, 'the general_chat routing step should still be shown');
    assert.equal(step.estCost, 0, 'the failed step must show $0 in the transparency panel');
    // total request cost (what the panel sums) is 0
    const total = r.routing.reduce((s, x) => s + (x.denied ? 0 : (x.estCost || 0)), 0);
    assert.equal(total, 0);
});

test('successful completion → charged exactly once at the routed estCost', async () => {
    const { assistant, charges } = build(async () => ({ content: 'Here is a helpful answer.' }));
    const r = await assistant.handle({ sessionId: 's2', shopId: 1, message: 'tell me a joke' });

    assert.equal(r.source, 'ai_generated');
    assert.equal(r.reply, 'Here is a helpful answer.');
    assert.equal(charges.length, 1, 'a successful completion should be billed once');
    assert.equal(charges[0].cost, 0.01);

    const step = r.routing.find(s => s.taskType === 'general_chat');
    assert.equal(step.estCost, 0.01, 'a successful step keeps its cost');
});
