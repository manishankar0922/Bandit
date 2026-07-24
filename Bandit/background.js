
const api = globalThis.browser ?? globalThis.chrome;
if (typeof self.RockyStorage === 'undefined' || typeof self.RockyProviders === 'undefined') {
  if (typeof importScripts === 'function') {
    try {
      importScripts('storage.js', 'ai/providers.js');
    } catch (err) {
      console.warn('Bandit: importScripts failed', err && err.message);
    }
  }
}

api.runtime.onInstalled.addListener(() => {
  api.contextMenus.create({
    id: "bandit-enhance",
    title: "Enhance with Bandit ✨",
    contexts: ["selection"]
  });
});

api.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "bandit-enhance") {
    api.tabs.sendMessage(tab.id, { 
      type: "ROCKY_TRIGGER_ENHANCE", 
      text: info.selectionText 
    }).catch(() => {}); // ignore errors if content script not loaded
  }
});
const FETCH_TIMEOUT_MS = 30000;

async function callProviderOnce(providerId, req) {
  try {
    let res;
    try {
      res = await fetch(req.url, { method: 'POST', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: req.headers, body: JSON.stringify(req.body) });
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
    if (!self.RockyProviders) throw new Error('AI providers not loaded — extension may need reinstalling');
    return self.RockyProviders.parseResponse(providerId, data);
  }
}

async function callProvider(providerId, apiKey, model, systemPrompt, userText) {
  if (!self.RockyProviders) throw new Error('AI providers not loaded — extension may need reinstalling');
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
  if (!self.RockyStorage) throw new Error('storage not loaded — extension may need reinstalling');
  let state;
  try {
    state = await self.RockyStorage.loadState();
  } catch (err) {
    throw new Error('failed to read settings from storage');
  }
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
    throw new Error("No API key set — add one in Bandit's settings ⚙️");
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
        console.log('[Bandit background]', provider, (Date.now() - startedAt) + 'ms');
      }
      return { ok: true, text, provider };
    } catch (err) {
      lastErr = err;
      if (message.debug) console.log('[Bandit background]', provider, 'failed, trying next —', err && err.message);
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

api.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.url || !tab.url.startsWith('http')) return;
  const hostname = new URL(tab.url).hostname;
  if (!hostname) return;

  try {
    const state = await self.RockyStorage.loadState();
    const disabledSites = state.disabledSites || [];
    
    if (disabledSites.includes(hostname)) {
      // Re-enable
      self.RockyStorage.saveState({ disabledSites: disabledSites.filter(h => h !== hostname) }, { immediate: true });
    } else {
      // Disable
      self.RockyStorage.saveState({ disabledSites: [...disabledSites, hostname] }, { immediate: true });
    }
    
    // Reload the tab so changes take effect
    api.tabs.reload(tab.id);
  } catch (err) {
    console.error('Failed to toggle Bandit state', err);
  }
});
