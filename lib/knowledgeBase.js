/**
 * Grahak Sathi — Customer Knowledge Base + Rule-Based Intent Classifier
 * ────────────────────────────────────────────────────────────────────
 * The DETERMINISTIC backbone of the customer assistant. This is the part that
 * makes the chatbot "not just an AI wrapper": the vast majority of customer
 * queries are answered here with zero LLM spend, using curated FAQ content and
 * a fast pattern-based intent classifier. The LLM is only reached as a grounded
 * fallback when nothing here matches.
 *
 * Store-specific facts are read from environment variables so the bot never
 * hallucinates business details — each falls back to a clearly generic default.
 */

const STORE_PROFILE = Object.freeze({
    name:     process.env.STORE_NAME     || 'our store',
    hours:    process.env.STORE_HOURS    || '9:00 AM – 9:00 PM, Monday to Sunday',
    address:  process.env.STORE_ADDRESS  || 'your nearest branch (check the address on your receipt)',
    phone:    process.env.STORE_PHONE    || 'the number printed on your receipt',
    email:    process.env.STORE_EMAIL    || (process.env.SENDGRID_FROM || 'support@grahaksathi.com'),
    payments: process.env.STORE_PAYMENTS || 'cash, all major credit/debit cards, and UPI',
    delivery: process.env.STORE_DELIVERY || 'in-store pickup and standard home delivery within 3–5 business days',
    warranty: process.env.STORE_WARRANTY || 'the manufacturer\'s warranty that ships with each product',
    returnDays: parseInt(process.env.RETURN_WINDOW_DAYS) || 30,
});

const RETURN_POLICY_TEXT =
    `You can return eligible items within ${STORE_PROFILE.returnDays} days of purchase. ` +
    `Items are verified against the image captured at checkout. Approved returns can be ` +
    `refunded to the original payment method or exchanged, subject to inspection terms & conditions.`;

/**
 * Intent definitions, evaluated TOP-TO-BOTTOM (order = priority).
 * Each entry: { intent, patterns:[RegExp], answer:string|null }
 *  - answer === null → the orchestrator must take a dynamic/branch action
 *    (DB lookup, visual audit, or AI fallback).
 */
const INTENTS = [
    {
        intent: 'greeting',
        patterns: [/^\s*(hi|hii+|hey|hello|yo|good (morning|afternoon|evening)|namaste|greetings)\b/i],
        answer: `Hello! I'm the ${STORE_PROFILE.name} assistant. I can help with returns & refunds, ` +
                `product availability and prices, order status, store hours, payments, and our policies. ` +
                `What can I help you with?`,
    },
    {
        intent: 'thanks',
        patterns: [/\b(thank|thanks|thx|ty|appreciate|that helps|great help)\b/i],
        answer: `You're welcome! Is there anything else I can help you with?`,
    },
    {
        intent: 'goodbye',
        patterns: [/\b(bye|goodbye|see you|that'?s all|nothing else|no thanks)\b/i],
        answer: `Thanks for visiting ${STORE_PROFILE.name}. Have a great day!`,
    },
    {
        // A genuine refund/return CLAIM with a described problem → needs visual audit.
        intent: 'return_claim',
        patterns: [
            /\b(refund|return|money back|reimburse|exchange|replace)\b.*\b(broken|cracked|damaged|defect|defective|torn|peel|missing|label|seal|wrong|not working|expired|stale|leaking|size|fit|tamper)\b/i,
            /\b(broken|cracked|damaged|defect|defective|torn|wrong size|wrong item|not working|expired|leaking|tamper)\b.*\b(refund|return|money back|exchange|replace)\b/i,
            // "i want a refund", "i want to return", and the article-less "i want refund".
            /\bi (want|need|would like|wanna)\b(?:\s+(?:a|an|to|my|the))?\s*\b(refund|return|exchange|replace|money back|reimburse)\b/i,
            // Bare intent verbs at the start of a message: "refund please", "return my order".
            /^\s*(refund|reimburse|money back)\b/i,
            // Seal / tampering complaints always need a visual audit.
            /\b(seal|sealed|packaging|package|box)\b.*\b(broken|open|opened|torn|tamper|tampered|damaged|missing)\b/i,
        ],
        answer: null,
    },
    {
        // A POLICY question about returns (no specific item problem) → KB answer.
        intent: 'return_policy',
        patterns: [
            /\b(return|refund|exchange)\b.*\b(policy|policies|window|how long|how many days|days|eligible|eligibility|process|procedure)\b/i,
            /\b(how (do|can) i return|can i return|what'?s your return)\b/i,
            /\breturn policy\b/i,
        ],
        answer: RETURN_POLICY_TEXT + ' If you\'d like to start a claim, just tell me the transaction ID and what went wrong.',
    },
    {
        intent: 'order_status',
        patterns: [
            /\b(order|transaction|purchase|claim)\b.*\b(status|track|where|update|progress|approved|processed)\b/i,
            /\b(track|where is)\b.*\b(my )?(order|refund|return|delivery|package)\b/i,
            /\bstatus of my\b/i,
        ],
        answer: null,
    },
    {
        intent: 'product_query',
        patterns: [
            /\b(price|cost|how much|mrp|rate)\b/i,
            /\b(do you (have|sell|stock)|in stock|available|availability|carry)\b/i,
            /\b(is|are)\b.*\b(available|in stock)\b/i,
        ],
        answer: null,
    },
    {
        intent: 'store_hours',
        patterns: [/\b(open|close|closing|opening|hours|timing|timings|what time|when (do|are) you)\b/i],
        answer: `We're open ${STORE_PROFILE.hours}.`,
    },
    {
        intent: 'store_location',
        patterns: [/\b(where|location|address|located|directions|how to reach|find you)\b/i],
        answer: `You can find us at ${STORE_PROFILE.address}.`,
    },
    {
        intent: 'contact_info',
        patterns: [/\b(contact|phone|call|reach|email|helpline|customer (care|service|support) number)\b/i],
        answer: `You can reach us by phone at ${STORE_PROFILE.phone} or email ${STORE_PROFILE.email}.`,
    },
    {
        intent: 'payment_methods',
        patterns: [/\b(payment|pay|card|upi|cash|wallet|credit|debit|net banking|accept)\b/i],
        answer: `We accept ${STORE_PROFILE.payments}.`,
    },
    {
        intent: 'shipping_delivery',
        patterns: [/\b(deliver|delivery|shipping|ship|courier|dispatch|pickup|pick up)\b/i],
        answer: `We offer ${STORE_PROFILE.delivery}.`,
    },
    {
        intent: 'warranty',
        patterns: [/\b(warranty|guarantee|guaranty|guranted|warrenty)\b/i],
        answer: `Products are covered by ${STORE_PROFILE.warranty}. Keep your receipt as proof of purchase.`,
    },
];

const STOPWORDS = new Set([
    'the','a','an','is','are','do','you','have','i','want','need','to','of','for','my','me','can',
    'price','cost','how','much','in','stock','available','availability','sell','stocks','this','that',
    'whats','what','your','please','tell','about','buy','any','it','get','there','and','with','some',
]);

/**
 * Fast rule-based intent classifier. No I/O, no model call.
 * @returns {{ intent:string, confidence:number, answer:string|null }}
 */
function detectIntent(message) {
    const text = String(message || '').trim();
    if (!text) return { intent: 'other', confidence: 0, answer: null };

    for (const entry of INTENTS) {
        if (entry.patterns.some(re => re.test(text))) {
            return { intent: entry.intent, confidence: 0.9, answer: entry.answer };
        }
    }
    return { intent: 'other', confidence: 0, answer: null };
}

/**
 * Extract candidate product search terms from a product query.
 * Strips intent/stopwords and keeps meaningful tokens for an ILIKE search.
 * @returns {string[]}
 */
function extractProductTerms(message) {
    return String(message || '')
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOPWORDS.has(w))
        .slice(0, 6);
}

/** Build a compact grounding context string for the AI fallback. */
function groundingContext() {
    return [
        `Store name: ${STORE_PROFILE.name}.`,
        `Hours: ${STORE_PROFILE.hours}.`,
        `Payments accepted: ${STORE_PROFILE.payments}.`,
        `Delivery: ${STORE_PROFILE.delivery}.`,
        `Warranty: ${STORE_PROFILE.warranty}.`,
        `Returns: ${RETURN_POLICY_TEXT}`,
    ].join(' ');
}

module.exports = {
    STORE_PROFILE,
    RETURN_POLICY_TEXT,
    INTENTS,
    detectIntent,
    extractProductTerms,
    groundingContext,
};
