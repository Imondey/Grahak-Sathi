/**
 * Grahak Sathi — Otari LLM Gateway Client (Mozilla.ai)
 * ───────────────────────────────────────────────────
 * Replaces the direct Groq SDK. ALL large-language-model traffic now flows
 * through your Otari gateway — Mozilla.ai's open-source, OpenAI-compatible LLM
 * control plane (https://github.com/mozilla-ai/otari), powered by any-llm.
 *
 * Otari handles upstream provider credentials (BYOK), routing policies, budget
 * enforcement and usage tracking server-side — the application never touches a
 * provider key directly. Because the gateway is OpenAI-compatible we only need
 * a plain HTTPS call (via axios, already a dependency); no Groq/HuggingFace SDK.
 *
 * Endpoint:  POST {OTARI_BASE_URL}/v1/chat/completions
 * Auth:      Authorization: Bearer {OTARI_API_KEY}
 *
 * ⚠️ MODEL NAME FORMAT — Otari is built on any-llm-gateway, which generally
 * expects a fully-qualified `provider/model` identifier (e.g.
 *   openai/gpt-4o-mini, mistral/mistral-small-latest, groq/llama-3.3-70b-versatile).
 * A bare model name like `gpt-4o-mini` is frequently REJECTED by the gateway,
 * which is the most common reason the Medium tier "stops working" (the call
 * fails, chat() returns null, and the assistant falls back to human handoff).
 * Set OTARI_MODEL to the fully-qualified id, OR set OTARI_PROVIDER (e.g. `openai`)
 * and this client will auto-prefix any bare model name for you.
 *
 * Env:
 *   OTARI_BASE_URL   e.g. https://api.otari.ai  or  http://localhost:8080
 *   OTARI_API_KEY    gateway key issued by Otari
 *   OTARI_MODEL      default model to route (e.g. openai/gpt-4o-mini)
 *   OTARI_PROVIDER   optional provider prefix applied to bare model names
 *   OTARI_TIMEOUT_MS optional request timeout (default 15000)
 */

function createOtariClient({
    baseUrl      = process.env.OTARI_BASE_URL || '',
    apiKey       = process.env.OTARI_API_KEY  || '',
    defaultModel = process.env.OTARI_MODEL    || 'gpt-4o-mini',
    provider     = process.env.OTARI_PROVIDER || '',
    timeout      = parseInt(process.env.OTARI_TIMEOUT_MS) || 15000,
    httpClient   = null,   // injectable for testing; defaults to axios
} = {}) {
    const http     = httpClient || require('axios');   // lazy: only loaded when actually used
    // The gateway is considered enabled only once a base URL is configured.
    const enabled  = !!baseUrl;
    const endpoint = enabled ? baseUrl.replace(/\/+$/, '') + '/v1/chat/completions' : null;

    /**
     * Normalise a model id for any-llm-gateway. If OTARI_PROVIDER is configured
     * and the model is bare (no `provider/model` or `provider:model` separator),
     * prefix it so the gateway can resolve the upstream provider.
     */
    function resolveModel(model) {
        const m = (model || defaultModel || '').trim();
        if (provider && m && !m.includes('/') && !m.includes(':')) {
            return `${provider}/${m}`;
        }
        return m;
    }

    /**
     * Extract a human-readable error message from a failed gateway response.
     * any-llm / OpenAI-compatible gateways return the real cause in the body.
     */
    function describeError(err) {
        const status = err.response?.status;
        const data   = err.response?.data;
        let body;
        if (data) {
            if (typeof data === 'string') body = data.slice(0, 500);
            else if (data.error) body = typeof data.error === 'string' ? data.error : JSON.stringify(data.error).slice(0, 500);
            else if (data.detail) body = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail).slice(0, 500);
            else body = JSON.stringify(data).slice(0, 500);
        }
        return { status: status || null, body: body || null, message: err.message };
    }

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
        const resolvedModel = resolveModel(model);
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

            const resp = await http.post(endpoint, {
                model: resolvedModel,
                messages,
                temperature,
                max_tokens: maxTokens,
                stream: false,
            }, { headers, timeout });

            // Some gateways return a 200 with an error envelope instead of throwing.
            if (resp.data?.error) {
                const e = resp.data.error;
                console.warn('Otari gateway returned an error envelope:',
                    `model=${resolvedModel}`, typeof e === 'string' ? e : JSON.stringify(e).slice(0, 500));
                return null;
            }

            const content = resp.data?.choices?.[0]?.message?.content;
            if (typeof content !== 'string' || !content.trim()) {
                console.warn('Otari gateway returned no message content:',
                    `model=${resolvedModel}`, JSON.stringify(resp.data || {}).slice(0, 400));
            }
            return {
                content: typeof content === 'string' ? content.trim() : null,
                usage:   resp.data?.usage || null,
                model:   resp.data?.model || resolvedModel,
            };
        } catch (err) {
            const e = describeError(err);
            // Log the FULL cause (status + response body) so Medium-tier failures
            // are diagnosable instead of silently degrading to human handoff.
            console.warn(
                `Otari gateway call failed → model=${resolvedModel} status=${e.status || 'n/a'} ` +
                `msg="${e.message}"` + (e.body ? ` body=${e.body}` : '')
            );
            return null;
        }
    }

    /**
     * Lightweight connectivity/credentials probe for diagnostics. Performs a tiny
     * real completion and reports exactly why it succeeded or failed.
     * @returns {Promise<object>} { enabled, ok, endpoint, model, status?, error?, body?, sampleContent? }
     */
    async function healthCheck() {
        if (!enabled) {
            return { enabled: false, ok: false, endpoint: null, model: null,
                     error: 'OTARI_BASE_URL is not set — Otari gateway disabled (Medium tier unavailable).' };
        }
        const resolvedModel = resolveModel();
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
            const resp = await http.post(endpoint, {
                model: resolvedModel,
                messages: [{ role: 'user', content: 'ping' }],
                temperature: 0,
                max_tokens: 5,
                stream: false,
            }, { headers, timeout });

            if (resp.data?.error) {
                const e = resp.data.error;
                return { enabled: true, ok: false, endpoint, model: resolvedModel,
                         hasApiKey: !!apiKey, status: 200,
                         error: typeof e === 'string' ? e : JSON.stringify(e).slice(0, 500) };
            }
            const content = resp.data?.choices?.[0]?.message?.content || null;
            return { enabled: true, ok: !!content, endpoint, model: resolvedModel,
                     hasApiKey: !!apiKey, status: resp.status, sampleContent: content };
        } catch (err) {
            const e = describeError(err);
            return { enabled: true, ok: false, endpoint, model: resolvedModel,
                     hasApiKey: !!apiKey, status: e.status, error: e.message, body: e.body };
        }
    }

    return { enabled, endpoint, defaultModel, provider, resolveModel, chat, healthCheck };
}

module.exports = { createOtariClient };
