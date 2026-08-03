// --- START: storage.js ---
// Rocky's persistence layer: one storage key ("rockyState") holding one object.
// Works as a Chrome/Firefox content script (browser.* / chrome.*) and as a
// plain <script> in the standalone demo page (no extension APIs at all).
(function (root) {
  const api = globalThis.browser ?? globalThis.chrome;
  const STORAGE_KEY = 'rockyState';
  const DEBOUNCE_MS = 300;

  const DEFAULTS = {
    xp: 0,
    level: 1,
    petName: 'Bandit',
    position: { x: null, y: null },
    onboarded: false,
    settings: { size: 1 },
    lastFedAt: 0,
    provider: 'builtin', // 'builtin' | 'anthropic' | 'openai' | 'gemini' | 'groq' | 'nvidia'
    apiKey: '', // key for the active provider (kept for back-compat)
    apiKeys: {}, // per-provider saved keys — enables automatic failover
    model: '', // optional override; empty = provider's default model
    enhanceStyle: 'structured', // 'structured' | 'concise' | 'detailed'
    enhanceTone: 'professional', // 'professional' | 'casual' | 'academic' | 'creative'
    askPlaceholders: false, // off by default — new users find it confusing. Enable in settings.
    streak: 0, // consecutive days Rocky has been visited
    lastVisitDay: '', // 'YYYY-MM-DD' of the last counted visit
    history: [], // last 10 results: { type: 'enhance'|'summary', text, at }
    disabledSites: [], // hostnames where Bandit is disabled
    lastSeenVersion: '', // track version updates
    updateMessageCount: 0, // max 5 reminders
  };

  const KNOWN_PROVIDERS = ['builtin', 'anthropic', 'openai', 'gemini', 'groq', 'nvidia'];
  const KNOWN_STYLES = ['structured', 'concise', 'detailed'];
  const KNOWN_TONES = ['professional', 'casual', 'academic', 'creative'];

  const storageApiPresent = !!(api && api.storage && api.storage.local);

  function mergeDefaults(stored) {
    const s = stored || {};
    const legacyAI = s.ai && typeof s.ai === 'object' ? s.ai : null;
    const merged = {
      ...DEFAULTS,
      ...s,
      position: { ...DEFAULTS.position, ...(s.position || {}) },
      settings: { ...DEFAULTS.settings, ...(s.settings || {}) },
      apiKeys: { ...DEFAULTS.apiKeys, ...(s.apiKeys || {}) }
    };

    if (legacyAI) {
      if (!merged.provider && KNOWN_PROVIDERS.includes(legacyAI.provider)) merged.provider = legacyAI.provider;
      if (!merged.apiKey && typeof legacyAI.apiKey === 'string') merged.apiKey = legacyAI.apiKey;
      if (!merged.model && typeof legacyAI.model === 'string') merged.model = legacyAI.model;
    }
    
    if (typeof merged.petName === 'string') merged.petName = merged.petName.slice(0, 32);
    if (!KNOWN_PROVIDERS.includes(merged.provider)) merged.provider = DEFAULTS.provider;
    if (!KNOWN_STYLES.includes(merged.enhanceStyle)) merged.enhanceStyle = DEFAULTS.enhanceStyle;
    if (!KNOWN_TONES.includes(merged.enhanceTone)) merged.enhanceTone = DEFAULTS.enhanceTone;
    if (!Array.isArray(merged.history)) merged.history = DEFAULTS.history;
    if (!Array.isArray(merged.disabledSites)) merged.disabledSites = DEFAULTS.disabledSites;

    return merged;
  }

  let memoryState = structuredClone(DEFAULTS);
  let storageAvailable = storageApiPresent;
  let debounceTimer = null;
  let pending = null;

  async function loadState() {
    if (!storageAvailable) return structuredClone(memoryState);
    try {
      const result = await api.storage.local.get(STORAGE_KEY);
      memoryState = mergeDefaults(result ? result[STORAGE_KEY] : null);
      return structuredClone(memoryState);
    } catch (err) {
      console.warn('Bandit: storage.local.get failed, falling back to in-memory state', err);
      storageAvailable = false;
      return structuredClone(memoryState);
    }
  }

  function flush() {
    clearTimeout(debounceTimer);
    debounceTimer = null;
    const toWrite = pending;
    pending = null;
    if (!toWrite || !storageAvailable) return;
    try {
      api.storage.local.set({ [STORAGE_KEY]: toWrite });
    } catch (err) {
      console.warn('Bandit: storage.local.set failed, falling back to in-memory state', err);
      storageAvailable = false;
    }
  }

  // Debounced by default (300ms); pass { immediate: true } to flush right away
  // (e.g. once on pointerup, never on every mousemove during a drag).
  function saveState(partial, opts) {
    opts = opts || {};
    try {
      memoryState = mergeDefaults({
        ...memoryState,
        ...partial,
        position: partial && partial.position ? { ...memoryState.position, ...partial.position } : memoryState.position,
        settings: partial && partial.settings ? { ...memoryState.settings, ...partial.settings } : memoryState.settings,
        apiKeys: partial && partial.apiKeys ? { ...memoryState.apiKeys, ...partial.apiKeys } : memoryState.apiKeys,
      });
      pending = memoryState;

      clearTimeout(debounceTimer);
      if (opts.immediate) {
        flush();
      } else {
        debounceTimer = setTimeout(flush, DEBOUNCE_MS);
      }
    } catch (err) {
      console.warn('Bandit: saveState failed, state kept in-memory only', err);
    }
  }

  // Lets other open tabs react when one tab levels Rocky up (XP bar, accessories).
  // Returns an unsubscribe function.
  function onStateChanged(callback) {
    if (!storageAvailable || !api.storage.onChanged) return () => {};
    try {
      const listener = (changes, areaName) => {
        if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
        memoryState = mergeDefaults(changes[STORAGE_KEY].newValue);
        callback(structuredClone(memoryState));
      };
      api.storage.onChanged.addListener(listener);
      return () => {
        try { api.storage.onChanged.removeListener(listener); } catch (err) { /* noop */ }
      };
    } catch (err) {
      console.warn('Bandit: onStateChanged listener failed to attach', err);
      return () => {};
    }
  }

  // Ensure any pending writes are flushed when the page unloads
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('beforeunload', () => {
      if (pending) flush();
    });
  }

  root.RockyStorage = { loadState, saveState, onStateChanged, flush, DEFAULTS };
})((typeof window !== 'undefined' ? window : globalThis));

// --- END: storage.js ---

// --- START: ai/utils.js ---
(function (root) {
  function detectProviderFromKey(apiKey) {
    const key = (apiKey || '').trim();
    if (!key) return null;
    if (key.startsWith('sk-ant-')) return 'anthropic';
    if (key.startsWith('gsk_')) return 'groq';
    if (key.startsWith('nvapi-')) return 'nvidia';
    if (key.startsWith('sk-proj-') || key.startsWith('sk-')) return 'openai';
    return 'gemini';
  }
  
  root.detectProviderFromKey = detectProviderFromKey;
})((typeof self !== 'undefined' ? self : globalThis));

// --- END: ai/utils.js ---

// --- START: ai/providers.js ---
// Provider registry for Rocky's AI pipeline. Runs inside the background
// service worker only (loaded via importScripts) — never in a content
// script, so API keys never touch the host page's JS context.
(function (root) {
  const PROVIDERS = {
    anthropic: { endpoint: 'https://api.anthropic.com/v1/messages', auth: 'x-api-key', model: 'claude-3-5-haiku-20241022', format: 'anthropic' },
    openai:    { endpoint: 'https://api.openai.com/v1/chat/completions', auth: 'bearer', model: 'gpt-4o-mini', format: 'openai' },
    gemini:    { endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent', auth: 'query', model: 'gemini-2.0-flash', format: 'gemini' },
    groq:      { endpoint: 'https://api.groq.com/openai/v1/chat/completions', auth: 'bearer', model: 'llama-3.3-70b-versatile', format: 'openai' }, // Groq speaks the OpenAI chat-completions shape
    nvidia:    { endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', auth: 'bearer', model: 'meta/llama3-70b-instruct', format: 'openai' },
  };



  function buildRequest(providerId, { apiKey, model, systemPrompt, userText, maxTokens }) {
    const cfg = PROVIDERS[providerId];
    if (!cfg) throw new Error('Unknown AI provider: ' + providerId);
    const useModel = (model && model.trim()) || cfg.model;
    const tokens = maxTokens || 500;

    let url = cfg.endpoint;
    // Gemini embeds the model name in the URL path — swap the placeholder.
    if (cfg.format === 'gemini') url = url.replace('{MODEL}', encodeURIComponent(useModel));
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
        max_completion_tokens: tokens, // newer OpenAI models prefer this field
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

  root.RockyProviders = { PROVIDERS, buildRequest, parseResponse };
})(typeof self !== 'undefined' ? self : globalThis);

// --- END: ai/providers.js ---

// --- START: background.js ---

const api = globalThis.browser ?? globalThis.chrome;



if (typeof self.RockyStorage === 'undefined' || typeof self.RockyProviders === 'undefined') {
  console.error('Bandit: storage.js or ai/providers.js failed to load. Some features will not work.');
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
    }).catch((err) => {
      console.warn('Bandit: Failed to trigger enhance from context menu. Content script might not be loaded on this page.', err);
    });
  }
});
const FETCH_TIMEOUT_MS = 30000;
const activeRequests = new Map();

async function callProvider(providerId, apiKey, model, systemPrompt, userText, retries = 2, customSignal = null) {
  if (!self.RockyProviders) throw new Error('AI providers not loaded — extension may need reinstalling');
  const req = self.RockyProviders.buildRequest(providerId, { apiKey, model, systemPrompt, userText });
  
  let res;
  let attempt = 0;
  let lastErr = null;

  while (attempt <= retries) {
    try {
      const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
      const combinedSignal = customSignal ? (AbortSignal.any ? AbortSignal.any([timeoutSignal, customSignal]) : customSignal) : timeoutSignal;
      res = await fetch(req.url, { method: 'POST', signal: combinedSignal, headers: req.headers, body: JSON.stringify(req.body) });
      break; // Success
    } catch (err) {
      lastErr = err;
      attempt++;
      if (attempt <= retries) {
        console.warn(`Bandit: provider ${providerId} failed, retrying (${attempt}/${retries})...`);
        await new Promise(r => setTimeout(r, 1000 * attempt)); // Exponential backoff
      }
    }
  }

  if (!res) {
    if (lastErr && lastErr.name === 'AbortError') throw new Error(`${providerId} request timed out after ${retries} retries`);
    throw new Error(`${providerId} network error: ` + ((lastErr && lastErr.message) || String(lastErr)));
  }
  
  let data = {};
  try { data = await res.json(); } catch (err) { console.error('Bandit: Failed to parse JSON response', err); data = {}; }
  if (!res.ok) {
    throw new Error((data.error && data.error.message) || `${providerId} error (HTTP ${res.status})`);
  }
  return self.RockyProviders.parseResponse(providerId, data);
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

async function handleAICall(message, tabId) {
  const settings = await getAISettings();
  if ((!settings.provider || settings.provider === 'builtin') && !Object.keys(settings.apiKeys).length) {
    throw new Error('No cloud provider selected — pick one in settings, or rely on built-in AI');
  }
  
  const provider = settings.provider;
  const apiKey = settings.apiKey || settings.apiKeys[provider];
  
  if (provider !== 'builtin' && !apiKey) {
    throw new Error("No API key set for the selected provider — add one in Bandit's settings ⚙️");
  }

  const startedAt = Date.now();
  
  if (tabId) {
    if (activeRequests.has(tabId)) {
      activeRequests.get(tabId).abort('Cancelled by new request');
    }
    activeRequests.set(tabId, new AbortController());
  }
  const signal = tabId ? activeRequests.get(tabId).signal : null;

  try {
    const text = await callProvider(provider, apiKey, settings.model, message.systemPrompt, message.userText, 2, signal);
    if (message.debug) {
      console.log('[Bandit background]', provider, (Date.now() - startedAt) + 'ms');
    }
    return { ok: true, text, provider };
  } catch (err) {
    if (message.debug) console.log('[Bandit background]', provider, 'failed —', err && err.message);
    throw err;
  } finally {
    if (tabId && activeRequests.has(tabId)) {
      activeRequests.delete(tabId);
    }
  }
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
        : await handleAICall(message, sender.tab ? sender.tab.id : null);
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
// --- END: background.js ---

