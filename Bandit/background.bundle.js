// background.js
var api = globalThis.browser ?? globalThis.chrome;
try {
  importScripts("storage.js", "ai/utils.js", "ai/providers.js");
} catch (e) {
  console.error("Bandit: Failed to import scripts in background service worker", e);
}
if (typeof self.RockyStorage === "undefined" || typeof self.RockyProviders === "undefined") {
  console.error("Bandit: storage.js or ai/providers.js failed to load. Some features will not work.");
}
api.runtime.onInstalled.addListener(() => {
  api.contextMenus.create({
    id: "bandit-enhance",
    title: "Enhance with Bandit \u2728",
    contexts: ["selection"]
  });
});
api.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "bandit-enhance") {
    api.tabs.sendMessage(tab.id, {
      type: "ROCKY_TRIGGER_ENHANCE",
      text: info.selectionText
    }).catch((err) => {
      console.warn("Bandit: Failed to trigger enhance from context menu. Content script might not be loaded on this page.", err);
    });
  }
});
var FETCH_TIMEOUT_MS = 3e4;
var activeRequests = /* @__PURE__ */ new Map();
async function callProvider(providerId, apiKey, model, systemPrompt, userText, retries = 2, customSignal = null) {
  if (!self.RockyProviders) throw new Error("AI providers not loaded \u2014 extension may need reinstalling");
  const req = self.RockyProviders.buildRequest(providerId, { apiKey, model, systemPrompt, userText });
  let res;
  let attempt = 0;
  let lastErr = null;
  while (attempt <= retries) {
    try {
      const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
      const combinedSignal = customSignal ? AbortSignal.any ? AbortSignal.any([timeoutSignal, customSignal]) : customSignal : timeoutSignal;
      res = await fetch(req.url, { method: "POST", signal: combinedSignal, headers: req.headers, body: JSON.stringify(req.body) });
      break;
    } catch (err) {
      lastErr = err;
      attempt++;
      if (attempt <= retries) {
        console.warn(`Bandit: provider ${providerId} failed, retrying (${attempt}/${retries})...`);
        await new Promise((r) => setTimeout(r, 1e3 * attempt));
      }
    }
  }
  if (!res) {
    if (lastErr && lastErr.name === "AbortError") throw new Error(`${providerId} request timed out after ${retries} retries`);
    throw new Error(`${providerId} network error: ` + (lastErr && lastErr.message || String(lastErr)));
  }
  let data = {};
  try {
    data = await res.json();
  } catch (err) {
    console.error("Bandit: Failed to parse JSON response", err);
    data = {};
  }
  if (!res.ok) {
    throw new Error(data.error && data.error.message || `${providerId} error (HTTP ${res.status})`);
  }
  return self.RockyProviders.parseResponse(providerId, data);
}
async function getAISettings() {
  if (!self.RockyStorage) throw new Error("storage not loaded \u2014 extension may need reinstalling");
  let state;
  try {
    state = await self.RockyStorage.loadState();
  } catch (err) {
    throw new Error("failed to read settings from storage");
  }
  return {
    provider: state.provider || "builtin",
    apiKey: state.apiKey || "",
    model: state.model || "",
    apiKeys: state.apiKeys || {}
  };
}
async function handleAICall(message, tabId) {
  const settings = await getAISettings();
  if ((!settings.provider || settings.provider === "builtin") && !Object.keys(settings.apiKeys).length) {
    throw new Error("No cloud provider selected \u2014 pick one in settings, or rely on built-in AI");
  }
  const provider = settings.provider;
  const apiKey = settings.apiKey || settings.apiKeys[provider];
  if (provider !== "builtin" && !apiKey) {
    throw new Error("No API key set for the selected provider \u2014 add one in Bandit's settings \u2699\uFE0F");
  }
  const startedAt = Date.now();
  if (tabId) {
    if (activeRequests.has(tabId)) {
      activeRequests.get(tabId).abort("Cancelled by new request");
    }
    activeRequests.set(tabId, new AbortController());
  }
  const signal = tabId ? activeRequests.get(tabId).signal : null;
  try {
    const text = await callProvider(provider, apiKey, settings.model, message.systemPrompt, message.userText, 2, signal);
    if (message.debug) {
      console.log("[Bandit background]", provider, Date.now() - startedAt + "ms");
    }
    return { ok: true, text, provider };
  } catch (err) {
    if (message.debug) console.log("[Bandit background]", provider, "failed \u2014", err && err.message);
    throw err;
  } finally {
    if (tabId && activeRequests.has(tabId)) {
      activeRequests.delete(tabId);
    }
  }
}
async function handleTestKey(message) {
  const settings = message.testSettings || await getAISettings();
  if (!settings.provider || settings.provider === "builtin") {
    throw new Error("pick a cloud provider first");
  }
  if (!settings.apiKey) {
    throw new Error("paste a key first");
  }
  await callProvider(settings.provider, settings.apiKey, settings.model, "Reply with exactly one word: OK", "ping");
  return { ok: true, provider: settings.provider };
}
api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "ROCKY_AI_CALL" && message.type !== "ROCKY_AI_TEST_KEY") {
    return;
  }
  (async () => {
    try {
      const result = message.type === "ROCKY_AI_TEST_KEY" ? await handleTestKey(message) : await handleAICall(message, sender.tab ? sender.tab.id : null);
      sendResponse(result);
    } catch (err) {
      sendResponse({ ok: false, error: err && err.message || String(err) });
    }
  })();
  return true;
});
api.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.url || !tab.url.startsWith("http")) return;
  const hostname = new URL(tab.url).hostname;
  if (!hostname) return;
  try {
    const state = await self.RockyStorage.loadState();
    const disabledSites = state.disabledSites || [];
    if (disabledSites.includes(hostname)) {
      self.RockyStorage.saveState({ disabledSites: disabledSites.filter((h) => h !== hostname) }, { immediate: true });
    } else {
      self.RockyStorage.saveState({ disabledSites: [...disabledSites, hostname] }, { immediate: true });
    }
    api.tabs.reload(tab.id);
  } catch (err) {
    console.error("Failed to toggle Bandit state", err);
  }
});
