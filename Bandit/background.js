// MV3 background: the ONLY place that ever sees the user's API key or talks
// to an AI provider. Content scripts (script.js / ai/pipeline.js) message
// this worker; it never talks back to the page directly. Cross-origin fetch
// here bypasses page CSP/CORS because the target domains are declared in
// host_permissions (see ai/providers.js for the Anthropic-specific note on
// why no browser-access header is needed).
//
// Loaded two different ways depending on browser (see manifest.json):
//  - Chrome: background.service_worker loads this file ALONE, in a real
//    ServiceWorker with no window/document — importScripts() pulls in
//    storage.js/ai/providers.js into this same scope.
//  - Firefox: background.scripts loads storage.js, then ai/providers.js,
//    then this file, in order, into one shared background-page scope (an
//    old-style event page, not a real Worker) — by the time this file runs,
//    RockyStorage/RockyProviders already exist and importScripts (a
//    Worker-only API that doesn't exist on a page) is neither available nor
//    needed.
const api = globalThis.browser ?? globalThis.chrome;
if (typeof self.RockyStorage === 'undefined' || typeof self.RockyProviders === 'undefined') {
  if (typeof importScripts === 'function') {
    try {
      importScripts('storage.js', 'ai/providers.js');
    } catch (err) {
      console.warn('Rocky: importScripts failed', err && err.message);
    }
  }
}
const FETCH_TIMEOUT_MS = 30000;

function timeoutSignal(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function callProviderOnce(providerId, req) {
  const { signal, cancel } = timeoutSignal(FETCH_TIMEOUT_MS);
  try {
    let res;
    try {
      res = await fetch(req.url, { method: 'POST', signal, headers: req.headers, body: JSON.stringify(req.body) });
    } catch (err) {
      if (err && err.name === 'AbortError') throw new Error(`${providerId} request timed out`);
      const e = new Error(`${providerId} network error: ` + ((err && err.message) || String(err)));
      e.transient = true; // network blips are worth one silent retry
      throw e;
    }
    let data = {};
    try { data = await res.json(); } catch (err) { data = {}; }
    if (!res.ok) {
      const e = new Error((data.error && data.error.message) || `${providerId} error (HTTP ${res.status})`);
      e.transient = res.status === 429 || res.status >= 500; // rate-limit/server hiccups retry once too
      throw e;
    }
    return self.RockyProviders.parseResponse(providerId, data);
  } finally {
    cancel();
  }
}

async function callProvider(providerId, apiKey, model, systemPrompt, userText) {
  const req = self.RockyProviders.buildRequest(providerId, { apiKey, model, systemPrompt, userText });
  try {
    return await callProviderOnce(providerId, req);
  } catch (err) {
    if (!err || !err.transient) throw err;
    // One automatic retry after a short backoff — invisible to the user
    // unless it also fails. Auth/permission errors (4xx) never retry.
    await new Promise((r) => setTimeout(r, 800));
    return callProviderOnce(providerId, req);
  }
}

async function getAISettings() {
  const state = await self.RockyStorage.loadState();
  return {
    provider: state.provider || 'builtin',
    apiKey: state.apiKey || '',
    model: state.model || '',
    apiKeys: state.apiKeys || {},
  };
}

// Failover chain: the selected provider first (with its key), then every
// other provider the user has a saved key for. Load spreads away from a
// failing/quota-exhausted provider automatically instead of surfacing an
// error while a working alternative sits unused.
function buildCandidates({ provider, apiKey, apiKeys }) {
  const candidates = [];
  const primaryKey = apiKey || apiKeys[provider];
  if (provider && provider !== 'builtin' && primaryKey) {
    candidates.push({ provider, apiKey: primaryKey });
  }
  for (const [p, k] of Object.entries(apiKeys)) {
    if (p !== provider && p !== 'builtin' && k) candidates.push({ provider: p, apiKey: k });
  }
  return candidates;
}

async function handleAICall(message) {
  const settings = await getAISettings();
  if ((!settings.provider || settings.provider === 'builtin') && !Object.keys(settings.apiKeys).length) {
    throw new Error('No cloud provider selected — pick one in settings, or rely on built-in AI');
  }
  const candidates = buildCandidates(settings);
  if (!candidates.length) {
    throw new Error("No API key set — add one in Rocky's settings ⚙️");
  }

  let lastErr = null;
  for (const { provider, apiKey } of candidates) {
    const startedAt = Date.now();
    try {
      // Model override only applies to the user's chosen provider — other
      // providers in the chain use their own defaults.
      const model = provider === settings.provider ? settings.model : '';
      const text = await callProvider(provider, apiKey, model, message.systemPrompt, message.userText);
      if (message.debug) {
        // Debug-only: provider name + latency. Never the prompt text or the key.
        console.log('[Rocky background]', provider, (Date.now() - startedAt) + 'ms');
      }
      return { ok: true, text, provider };
    } catch (err) {
      lastErr = err;
      if (message.debug) console.log('[Rocky background]', provider, 'failed, trying next —', err && err.message);
    }
  }
  throw lastErr || new Error('all providers failed');
}

async function handleTestKey(message) {
  const settings = message.testSettings || (await getAISettings());
  if (!settings.provider || settings.provider === 'builtin') {
    throw new Error('pick a cloud provider first');
  }
  if (!settings.apiKey) {
    throw new Error('paste a key first');
  }
  await callProvider(settings.provider, settings.apiKey, settings.model, 'Reply with exactly one word: OK', 'ping');
  return { ok: true, provider: settings.provider };
}

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || (message.type !== 'ROCKY_AI_CALL' && message.type !== 'ROCKY_AI_TEST_KEY')) {
    return; // not for us
  }

  (async () => {
    try {
      const result = message.type === 'ROCKY_AI_TEST_KEY'
        ? await handleTestKey(message)
        : await handleAICall(message);
      sendResponse(result);
    } catch (err) {
      // Never log prompt text or API keys — only the error message.
      sendResponse({ ok: false, error: (err && err.message) || String(err) });
    }
  })();

  return true; // keep the message channel open for the async sendResponse above
});
