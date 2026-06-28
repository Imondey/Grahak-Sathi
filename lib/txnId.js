/**
 * Grahak Sathi — Transaction ID generator
 * ───────────────────────────────────────
 * Generates the random, receipt-friendly transaction ID issued to a customer at
 * payment. This ID is what the customer later enters in the support chatbot to
 * start a verified refund/return claim — the auditor uses it to pull the product
 * image saved at checkout (Customer DB) and, for online orders, the delivery
 * photo (Delivery DB).
 *
 * The ID is a pure random NUMBER (returned as a string to preserve any leading
 * structure and to match the TEXT columns it is stored in). It is generated with
 * crypto-grade randomness; callers should still verify uniqueness against the DB
 * (see generateUniqueTransactionId in index.js) before persisting.
 */

const crypto = require('crypto');

/**
 * Generate a random numeric transaction ID.
 * @param {number} [digits=12]  number of digits (default 12 → ~9e11 space)
 * @returns {string} e.g. "734820156093"
 */
function generateTransactionId(digits = 12) {
    const n = Math.max(6, Math.min(18, parseInt(digits) || 12));
    let s = String(crypto.randomInt(1, 10));        // first digit 1–9 (no leading zero)
    for (let i = 1; i < n; i++) s += String(crypto.randomInt(0, 10));
    return s;
}

module.exports = { generateTransactionId };
