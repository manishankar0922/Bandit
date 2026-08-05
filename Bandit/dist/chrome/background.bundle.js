(() => {
  // src/storage.js
  var STORAGE_KEY = "rockyState";
  var DEBOUNCE_MS = 300;
  var DEFAULTS = {
    xp: 0,
    level: 1,
    petName: "Bandit",
    position: { x: null, y: null },
    onboarded: false,
    settings: { size: 1 },
    lastFedAt: 0,
    provider: "builtin",
    apiKey: "",
    apiKeys: {},
    model: "",
    customModel: "",
    customInstructions: "",
    enhanceStyle: "structured",
    enhanceTone: "professional",
    askPlaceholders: false,
    streak: 0,
    lastVisitDay: "",
    history: [],
    disabledSites: [],
    lastSeenVersion: "",
    updateMessageCount: 0
  };
  var KNOWN_PROVIDERS = ["builtin", "anthropic", "openai", "gemini", "groq", "nvidia"];
  var KNOWN_STYLES = ["structured", "concise", "detailed"];
  var KNOWN_TONES = ["professional", "casual", "academic", "creative"];
  var api = globalThis.browser ?? globalThis.chrome;
  var storageApiPresent = !!(api && api.storage && api.storage.local);
  function mergeDefaults(stored) {
    const s = stored || {};
    const legacyAI = s.ai && typeof s.ai === "object" ? s.ai : null;
    const merged = {
      ...DEFAULTS,
      ...s,
      position: { ...DEFAULTS.position, ...s.position || {} },
      settings: { ...DEFAULTS.settings, ...s.settings || {} },
      apiKeys: { ...DEFAULTS.apiKeys, ...s.apiKeys || {} }
    };
    if (legacyAI) {
      if (!merged.provider && KNOWN_PROVIDERS.includes(legacyAI.provider)) merged.provider = legacyAI.provider;
      if (!merged.apiKey && typeof legacyAI.apiKey === "string") merged.apiKey = legacyAI.apiKey;
      if (!merged.model && typeof legacyAI.model === "string") merged.model = legacyAI.model;
    }
    if (typeof merged.petName === "string") merged.petName = merged.petName.slice(0, 32);
    if (!KNOWN_PROVIDERS.includes(merged.provider)) merged.provider = DEFAULTS.provider;
    if (!KNOWN_STYLES.includes(merged.enhanceStyle)) merged.enhanceStyle = DEFAULTS.enhanceStyle;
    if (!KNOWN_TONES.includes(merged.enhanceTone)) merged.enhanceTone = DEFAULTS.enhanceTone;
    if (!Array.isArray(merged.history)) merged.history = DEFAULTS.history;
    if (!Array.isArray(merged.disabledSites)) merged.disabledSites = DEFAULTS.disabledSites;
    return merged;
  }
  var memoryState = structuredClone(DEFAULTS);
  var storageAvailable = storageApiPresent;
  var debounceTimer = null;
  var pending = null;
  async function loadState() {
    if (!storageAvailable) return structuredClone(memoryState);
    try {
      const result = await api.storage.local.get(STORAGE_KEY);
      memoryState = mergeDefaults(result ? result[STORAGE_KEY] : null);
      return structuredClone(memoryState);
    } catch (err) {
      console.warn("Bandit: storage.local.get failed, falling back to in-memory state", err);
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
      console.warn("Bandit: storage.local.set failed, falling back to in-memory state", err);
      storageAvailable = false;
    }
  }
  function saveState(partial, opts = {}) {
    try {
      memoryState = mergeDefaults({
        ...memoryState,
        ...partial,
        position: partial && partial.position ? { ...memoryState.position, ...partial.position } : memoryState.position,
        settings: partial && partial.settings ? { ...memoryState.settings, ...partial.settings } : memoryState.settings,
        apiKeys: partial && partial.apiKeys ? { ...memoryState.apiKeys, ...partial.apiKeys } : memoryState.apiKeys
      });
      pending = memoryState;
      clearTimeout(debounceTimer);
      if (opts.immediate) {
        flush();
      } else {
        debounceTimer = setTimeout(flush, DEBOUNCE_MS);
      }
    } catch (err) {
      console.warn("Bandit: saveState failed, state kept in-memory only", err);
    }
  }
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("beforeunload", () => {
      if (pending) flush();
    });
  }

  // src/ai/providers.js
  var PROVIDERS = {
    anthropic: { endpoint: "https://api.anthropic.com/v1/messages", auth: "x-api-key", model: "claude-3-5-haiku-20241022", format: "anthropic" },
    openai: { endpoint: "https://api.openai.com/v1/chat/completions", auth: "bearer", model: "gpt-4o-mini", format: "openai" },
    gemini: { endpoint: "https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent", auth: "query", model: "gemini-2.0-flash", format: "gemini" },
    groq: { endpoint: "https://api.groq.com/openai/v1/chat/completions", auth: "bearer", model: "llama-3.3-70b-versatile", format: "openai" },
    nvidia: { endpoint: "https://integrate.api.nvidia.com/v1/chat/completions", auth: "bearer", model: "meta/llama3-70b-instruct", format: "openai" }
  };
  function buildRequest(providerId, { apiKey, model, systemPrompt, userText, maxTokens }) {
    const cfg = PROVIDERS[providerId];
    if (!cfg) throw new Error("Unknown AI provider: " + providerId);
    const useModel = model && model.trim() || cfg.model;
    const tokens = maxTokens || 500;
    let url = cfg.endpoint;
    if (cfg.format === "gemini") {
      url = url.replace("{MODEL}", encodeURIComponent(useModel));
    }
    const headers = { "content-type": "application/json" };
    if (cfg.auth === "x-api-key") {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else if (cfg.auth === "bearer") {
      headers["authorization"] = "Bearer " + apiKey;
    } else if (cfg.auth === "query") {
      url += (url.includes("?") ? "&" : "?") + "key=" + encodeURIComponent(apiKey);
    }
    let body;
    if (cfg.format === "anthropic") {
      body = {
        model: useModel,
        max_tokens: tokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userText }],
        stream: true
      };
    } else if (cfg.format === "openai") {
      body = {
        model: useModel,
        max_tokens: tokens,
        max_completion_tokens: tokens,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userText }
        ],
        stream: true
      };
    } else if (cfg.format === "gemini") {
      body = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userText }] }],
        generationConfig: { maxOutputTokens: tokens }
      };
      if (!url.includes("streamGenerateContent")) {
        url = url.replace("generateContent", "streamGenerateContent?alt=sse");
      }
    } else {
      throw new Error("Unknown provider format: " + cfg.format);
    }
    return { url, headers, body };
  }
  function parseStreamChunk(providerId, line) {
    if (!line || !line.startsWith("data: ")) return "";
    const dataStr = line.slice(6).trim();
    if (dataStr === "[DONE]") return "";
    try {
      const data = JSON.parse(dataStr);
      const cfg = PROVIDERS[providerId];
      if (cfg.format === "openai") {
        const choices = Array.isArray(data.choices) ? data.choices : [];
        if (!choices[0] || !choices[0].delta) return "";
        return choices[0].delta.content || "";
      }
      if (cfg.format === "anthropic") {
        if (data.type === "content_block_delta" && data.delta && data.delta.text) {
          return data.delta.text;
        }
        return "";
      }
      if (cfg.format === "gemini") {
        const candidates = Array.isArray(data.candidates) ? data.candidates : [];
        const parts = candidates[0] && candidates[0].content && candidates[0].content.parts ? candidates[0].content.parts : [];
        return parts.map((p) => p && p.text || "").join("");
      }
    } catch (err) {
    }
    return "";
  }

  // src/background.js
  var api2 = globalThis.browser ?? globalThis.chrome;
  var lastSeenProvider = "builtin";
  var isEnabled = true;
  async function initWorker() {
    if (!api2 || !api2.storage) return;
    const state = await loadState();
    lastSeenProvider = state.provider || "builtin";
    const disabled = state.disabledSites || [];
    isEnabled = true;
    if (api2.contextMenus) {
      api2.contextMenus.removeAll(() => {
        api2.contextMenus.create({
          id: "rocky-enhance",
          title: "\u2728 Enhance Prompt with Bandit",
          contexts: ["editable", "selection"]
        });
        api2.contextMenus.create({
          id: "rocky-summarize",
          title: "\u{1F4CB} Summarize Chat",
          contexts: ["page", "selection"]
        });
      });
      api2.contextMenus.onClicked.addListener((info, tab) => {
        if (!tab || !tab.id) return;
        if (info.menuItemId === "rocky-enhance") {
          api2.tabs.sendMessage(tab.id, { type: "ROCKY_CTX_ENHANCE" }).catch(() => {
          });
        } else if (info.menuItemId === "rocky-summarize") {
          api2.tabs.sendMessage(tab.id, { type: "ROCKY_CTX_SUMMARIZE" }).catch(() => {
          });
        }
      });
    }
    if (api2.action) {
      api2.action.onClicked.addListener(async (tab) => {
        if (!tab || !tab.id || !tab.url) return;
        if (tab.url.startsWith("chrome://") || tab.url.startsWith("about:")) return;
        const urlObj = new URL(tab.url);
        const host = urlObj.hostname;
        const st = await loadState();
        let disabled2 = st.disabledSites || [];
        const isCurrentlyDisabled = disabled2.includes(host);
        if (isCurrentlyDisabled) {
          disabled2 = disabled2.filter((h) => h !== host);
          api2.action.setBadgeText({ text: "ON", tabId: tab.id });
          api2.action.setBadgeBackgroundColor({ color: "#4caf50", tabId: tab.id });
        } else {
          disabled2.push(host);
          api2.action.setBadgeText({ text: "OFF", tabId: tab.id });
          api2.action.setBadgeBackgroundColor({ color: "#f44336", tabId: tab.id });
        }
        saveState({ disabledSites: disabled2 }, { immediate: true });
        api2.tabs.sendMessage(tab.id, { type: "ROCKY_TOGGLE", disabled: !isCurrentlyDisabled }).catch(() => {
        });
      });
    }
  }
  initWorker();
  if (api2 && api2.runtime) {
    api2.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.type === "ROCKY_AI_CALL") {
        handleAICall(msg, sender).then(sendResponse);
        return true;
      }
      if (msg.type === "ROCKY_AI_TEST_KEY") {
        handleTestKey(msg).then(sendResponse);
        return true;
      }
    });
  }
  async function handleAICall(msg, sender) {
    try {
      const state = await loadState();
      const provider = state.provider || "builtin";
      if (provider === "builtin") {
        throw new Error("On-device AI failed, and no API keys are set. Open settings (\u2699\uFE0F) to add one.");
      }
      const apiKeys = state.apiKeys || {};
      const apiKey = apiKeys[provider] || state.apiKey;
      if (!apiKey) {
        throw new Error(`No API key saved for ${provider}. Open settings (\u2699\uFE0F) to add one.`);
      }
      const req = buildRequest(provider, {
        apiKey,
        model: state.customModel || state.model,
        systemPrompt: msg.systemPrompt,
        userText: msg.userText,
        maxTokens: 500
      });
      if (msg.debug) console.log(`[Bandit BG] fetching ${provider} via ${req.url}`);
      const res = await fetch(req.url, {
        method: "POST",
        headers: req.headers,
        body: JSON.stringify(req.body)
      });
      if (!res.ok) {
        let errText = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          errText = data.error && data.error.message || errText;
        } catch (e) {
        }
        throw new Error(errText);
      }
      if (!res.body) throw new Error("No response body from API");
      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let fullText = "";
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        let chunkText = "";
        for (const line of lines) {
          if (line.trim() === "") continue;
          const text = parseStreamChunk(provider, line);
          if (text) chunkText += text;
        }
        if (chunkText && msg.requestId && sender && sender.tab && sender.tab.id) {
          fullText += chunkText;
          api2.tabs.sendMessage(sender.tab.id, {
            type: "ROCKY_STREAM_CHUNK",
            requestId: msg.requestId,
            text: fullText
          }).catch(() => {
          });
        }
      }
      if (buffer.trim() !== "") {
        const text = parseStreamChunk(provider, buffer);
        if (text) fullText += text;
      }
      return { ok: true, text: fullText.trim(), provider };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  }
  async function handleTestKey(msg) {
    try {
      const provider = msg.provider;
      if (provider === "builtin") return { ok: true, provider };
      const req = buildRequest(provider, {
        apiKey: msg.apiKey,
        model: msg.model,
        systemPrompt: 'You are a test script. Reply with "OK".',
        userText: "Hello.",
        maxTokens: 10
      });
      const res = await fetch(req.url, {
        method: "POST",
        headers: req.headers,
        body: JSON.stringify(req.body)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error && data.error.message || `HTTP ${res.status}`);
      }
      return { ok: true, provider };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  }
})();
