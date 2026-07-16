// Provider registry for Rocky's AI pipeline. Runs inside the background
// service worker only (loaded via importScripts) — never in a content
// script, so API keys never touch the host page's JS context.
(function (root) {
  const PROVIDERS = {
    anthropic: { endpoint: 'https://api.anthropic.com/v1/messages', auth: 'x-api-key', model: 'claude-haiku-4-5-20251001', format: 'anthropic' },
    openai:    { endpoint: 'https://api.openai.com/v1/chat/completions', auth: 'bearer', model: 'gpt-4o-mini', format: 'openai' },
    gemini:    { endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent', auth: 'query', model: 'gemini-2.0-flash', format: 'gemini' },
    groq:      { endpoint: 'https://api.groq.com/openai/v1/chat/completions', auth: 'bearer', model: 'llama-3.3-70b-versatile', format: 'openai' }, // Groq speaks the OpenAI chat-completions shape
  };

  // Best-effort guess from key shape, used to auto-select the settings
  // dropdown when the user pastes a key. Order matters: sk-ant- must be
  // checked before the generic sk-/sk-proj- OpenAI patterns.
  function detectProvider(apiKey) {
    const key = (apiKey || '').trim();
    if (!key) return null;
    if (key.startsWith('sk-ant-')) return 'anthropic';
    if (key.startsWith('gsk_')) return 'groq';
    if (key.startsWith('sk-proj-') || key.startsWith('sk-')) return 'openai';
    return 'gemini'; // Gemini keys have no consistent prefix — last resort.
  }

  function buildRequest(providerId, { apiKey, model, systemPrompt, userText, maxTokens }) {
    const cfg = PROVIDERS[providerId];
    if (!cfg) throw new Error('Unknown AI provider: ' + providerId);
    const useModel = (model && model.trim()) || cfg.model;
    const tokens = maxTokens || 500;

    let url = cfg.endpoint;
    const headers = { 'content-type': 'application/json' };

    if (cfg.auth === 'x-api-key') {
      headers['x-api-key'] = apiKey;
      // Anthropic requires the extra version header for /v1/messages. No
      // anthropic-dangerous-direct-browser-access header is needed here:
      // that header exists to let Anthropic's API accept CORS preflight
      // requests from a WEBPAGE origin. This call runs in the extension's
      // background service worker, not a webpage — service worker fetches
      // aren't subject to the page-origin CORS/preflight dance at all (the
      // https://api.anthropic.com/* host_permissions entry is what grants
      // cross-origin fetch here), so the browser-access opt-in doesn't apply.
      headers['anthropic-version'] = '2023-06-01';
    } else if (cfg.auth === 'bearer') {
      headers['authorization'] = 'Bearer ' + apiKey;
    } else if (cfg.auth === 'query') {
      url += (url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(apiKey);
    }

    let body;
    if (cfg.format === 'anthropic') {
      body = {
        model: useModel,
        max_tokens: tokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userText }],
      };
    } else if (cfg.format === 'openai') {
      body = {
        model: useModel,
        max_tokens: tokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userText },
        ],
      };
    } else if (cfg.format === 'gemini') {
      body = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        generationConfig: { maxOutputTokens: tokens },
      };
    } else {
      throw new Error('Unknown provider format: ' + cfg.format);
    }

    return { url, headers, body };
  }

  function parseResponse(providerId, data) {
    const cfg = PROVIDERS[providerId];
    if (!cfg) throw new Error('Unknown AI provider: ' + providerId);
    if (!data || typeof data !== 'object') throw new Error(providerId + ' returned invalid response data');

    try {
      if (cfg.format === 'anthropic') {
        const text = (Array.isArray(data.content) ? data.content : [])
          .map((block) => (block && block.text) || '').join('').trim();
        if (!text) throw new Error((data.error && data.error.message) || 'Empty response from Anthropic');
        return text;
      }

      if (cfg.format === 'openai') {
        const choices = Array.isArray(data.choices) ? data.choices : [];
        const text = choices[0] && choices[0].message
          ? (choices[0].message.content || '').trim() : '';
        if (!text) throw new Error((data.error && data.error.message) || 'Empty response from provider');
        return text;
      }

      if (cfg.format === 'gemini') {
        const candidates = Array.isArray(data.candidates) ? data.candidates : [];
        const parts = candidates[0] && candidates[0].content
          ? (Array.isArray(candidates[0].content.parts) ? candidates[0].content.parts : []) : [];
        const text = parts.map((p) => (p && p.text) || '').join('').trim();
        if (!text) throw new Error((data.error && data.error.message) || 'Empty response from Gemini');
        return text;
      }
    } catch (parseErr) {
      // Re-throw if it's already one of our errors; wrap anything unexpected
      if (parseErr instanceof Error) throw parseErr;
      throw new Error(providerId + ' response parsing failed: ' + String(parseErr));
    }

    throw new Error('Unknown provider format: ' + cfg.format);
  }

  root.RockyProviders = { PROVIDERS, detectProvider, buildRequest, parseResponse };
})(typeof self !== 'undefined' ? self : globalThis);
