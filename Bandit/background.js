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

async function callProvider(providerId, apiKey, model, systemPrompt, userText) {
  const req = self.RockyProviders.buildRequest(providerId, { apiKey, model, systemPrompt, userText });
  const { signal, cancel } = timeoutSignal(FETCH_TIMEOUT_MS);
  try {
    let res;
    try {
      res = await fetch(req.url, { method: 'POST', signal, headers: req.headers, body: JSON.stringify(req.body) });
    } catch (err) {
      if (err && err.name === 'AbortError') throw new Error(`${providerId} request timed out`);
      throw new Error(`${providerId} network error: ` + ((err && err.message) || String(err)));
    }
    let data = {};
    try { data = await res.json(); } catch (err) { data = {}; }
    if (!res.ok) {
      throw new Error((data.error && data.error.message) || `${providerId} error (HTTP ${res.status})`);
    }
    return self.RockyProviders.parseResponse(providerId, data);
  } finally {
    cancel();
  }
}

async function getAISettings() {
  const state = await self.RockyStorage.loadState();
  return { provider: state.provider || 'builtin', apiKey: state.apiKey || '', model: state.model || '' };
}

async function handleAICall(message) {
  const { provider, apiKey, model } = await getAISettings();
  if (!provider || provider === 'builtin') {
    throw new Error('No cloud provider selected — pick one in settings, or rely on built-in AI');
  }
  if (!apiKey) {
    throw new Error("No API key set — add one in Rocky's settings ⚙️");
  }
  const startedAt = Date.now();
  const text = await callProvider(provider, apiKey, model, message.systemPrompt, message.userText);
  if (message.debug) {
    // Debug-only: provider name + latency. Never the prompt text or the key.
    console.log('[Rocky background]', provider, (Date.now() - startedAt) + 'ms');
  }
  return { ok: true, text, provider };
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
