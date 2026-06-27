/**
 * SmartRetail — Otari LLM Gateway Client (Mozilla.ai)
 * ───────────────────────────────────────────────────
 * Replaces the direct Groq SDK. ALL large-language-model traffic now flows
 * through your Otari gateway — Mozilla.ai's open-source, OpenAI-compatible LLM
 * control plane (https://github.com/mozilla-ai/otari).
 *
 * Otari handles upstream provider credentials (BYOK), routing policies, budget
 * enforcement and usage tracking server-side — the application never touches a
 * provider key directly. Because the gateway is OpenAI-compatible we only need
 * a plain HTTPS call (via axios, already a dependency); no Groq/HuggingFace SDK.
 *
 * Endpoint:  POST {OTARI_BASE_URL}/v1/chat/completions
 * Auth:      Authorization: Bearer {OTARI_API_KEY}
 *
 * Env:
 *   OTARI_BASE_URL   e.g. https://api.otari.ai  or  http://localhost:8080
 *   OTARI_API_KEY    gateway key issued by Otari
 *   OTARI_MODEL      default model to route (e.g. a routing alias / open-weight)
 *   OTARI_TIMEOUT_MS optional request timeout (default 15000)
 */

function createOtariClient({
    baseUrl      = process.env.OTARI_BASE_URL || '',
    apiKey       = process.env.OTARI_API_KEY  || '',
    defaultModel = process.env.OTARI_MODEL    || 'gpt-4o-mini',
    timeout      = parseInt(process.env.OTARI_TIMEOUT_MS) || 15000,
    httpClient   = null,   // injectable for testing; defaults to axios
} = {}) {
    const http     = httpClient || require('axios');   // lazy: only loaded when actually used
    // The gateway is considered enabled only once a base URL is configured.
    const enabled  = !!baseUrl;
    const endpoint = enabled ? baseUrl.replace(/\/+$/, '') + '/v1/chat/completions' : null;

    /**
     * OpenAI-compatible chat completion through Otari.
     * @param {Array<{role:string,content:string}>} messages
     * @param {object} [opts]
     * @returns {Promise<{content:string|null, usage:object|null, model:string}|null>}
     *          null when the gateway is not configured or the call fails
     *          (callers fall back to local logic / human handoff).
     */
    async function chat(messages, { model, temperature = 0.3, maxTokens = 256 } = {}) {
        if (!enabled) return null;
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

            const resp = await http.post(endpoint, {
                model: model || defaultModel,
                messages,
                temperature,
                max_tokens: maxTokens,
                stream: false,
            }, { headers, timeout });

            const content = resp.data?.choices?.[0]?.message?.content;
            return {
                content: typeof content === 'string' ? content.trim() : null,
                usage:   resp.data?.usage || null,
                model:   resp.data?.model || model || defaultModel,
            };
        } catch (err) {
            console.warn('Otari gateway call failed:', err.response?.status || '', err.message);
            return null;
        }
    }

    return { enabled, endpoint, defaultModel, chat };
}

module.exports = { createOtariClient };
