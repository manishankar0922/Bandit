(() => {
  // src/storage.js
  var PRIMARY_STORAGE_KEY = "banditState";
  var LEGACY_STORAGE_KEY = "rockyState";
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
    updateMessageCount: 0,
    customTemplates: []
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
    if (!Array.isArray(merged.customTemplates)) merged.customTemplates = DEFAULTS.customTemplates;
    return merged;
  }
  var memoryState = structuredClone(DEFAULTS);
  var storageAvailable = storageApiPresent;
  var debounceTimer = null;
  var pending = null;
  async function loadState() {
    if (!storageAvailable) return structuredClone(memoryState);
    try {
      const result = await api.storage.local.get([PRIMARY_STORAGE_KEY, LEGACY_STORAGE_KEY]);
      const stored = result ? result[PRIMARY_STORAGE_KEY] || result[LEGACY_STORAGE_KEY] : null;
      memoryState = mergeDefaults(stored);
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
      api.storage.local.set({ [PRIMARY_STORAGE_KEY]: toWrite, [LEGACY_STORAGE_KEY]: toWrite });
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
  function onStateChanged(callback) {
    if (!storageAvailable || !api.storage.onChanged) return () => {
    };
    try {
      const listener = (changes, areaName) => {
        if (areaName !== "local") return;
        const change = changes[PRIMARY_STORAGE_KEY] || changes[LEGACY_STORAGE_KEY];
        if (!change) return;
        memoryState = mergeDefaults(change.newValue);
        callback(structuredClone(memoryState));
      };
      api.storage.onChanged.addListener(listener);
      return () => {
        try {
          api.storage.onChanged.removeListener(listener);
        } catch (err) {
        }
      };
    } catch (err) {
      console.warn("Bandit: onStateChanged listener failed to attach", err);
      return () => {
      };
    }
  }
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("beforeunload", () => {
      if (pending) flush();
    });
  }

  // src/ai/pipeline.js
  var RATE_LIMIT_MS = 3e3;
  var NANO_TIMEOUT_MS = 15e3;
  function isDebugEnabled() {
    try {
      return typeof localStorage !== "undefined" && localStorage.getItem("rocky_debug") === "1";
    } catch (err) {
      return false;
    }
  }
  function debugLog(...args) {
    if (isDebugEnabled()) console.log("[Bandit AI]", ...args);
  }
  async function tryNano(systemPrompt, userText, onProgress) {
    const lm = globalThis.ai?.languageModel || globalThis.LanguageModel;
    if (typeof lm === "undefined") {
      debugLog("LanguageModel global not present in this browser");
      return null;
    }
    let availability;
    try {
      availability = await lm.availability();
    } catch (err) {
      debugLog("availability() threw", err && err.message);
      return null;
    }
    if (availability === "unavailable") {
      debugLog("Nano unavailable on this device");
      return null;
    }
    let session = null;
    try {
      const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(NANO_TIMEOUT_MS) : void 0;
      session = await lm.create({
        signal,
        initialPrompts: [{ role: "system", content: systemPrompt }],
        monitor(m) {
          try {
            m.addEventListener("downloadprogress", (e) => {
              if (onProgress) onProgress(typeof e.loaded === "number" ? e.loaded : 0);
            });
          } catch (err) {
            debugLog("monitor() not supported", err && err.message);
          }
        }
      });
      const promptSignal = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(NANO_TIMEOUT_MS) : void 0;
      const result = await session.prompt(userText, { signal: promptSignal });
      const text = typeof result === "string" ? result.trim() : "";
      return text || null;
    } catch (err) {
      debugLog("Nano generation failed, falling back to BYOK", err && err.message);
      return null;
    } finally {
      try {
        if (session && typeof session.destroy === "function") session.destroy();
      } catch (err) {
      }
    }
  }
  function callBackgroundWorker(systemPrompt, userText, debug, onChunk) {
    const api3 = globalThis.browser ?? globalThis.chrome;
    return new Promise((resolve, reject) => {
      try {
        if (!api3 || !api3.runtime || !api3.runtime.sendMessage) {
          reject(new Error("extension messaging unavailable here"));
          return;
        }
        const requestId = Math.random().toString(36).substring(2);
        let chunkListener = null;
        if (onChunk) {
          chunkListener = (msg) => {
            if (msg.type === "ROCKY_STREAM_CHUNK" && msg.requestId === requestId) {
              onChunk(msg.text);
            }
          };
          api3.runtime.onMessage.addListener(chunkListener);
        }
        api3.runtime.sendMessage(
          { type: "ROCKY_AI_CALL", systemPrompt, userText, debug, requestId },
          (response) => {
            if (chunkListener) api3.runtime.onMessage.removeListener(chunkListener);
            const lastErr = api3.runtime.lastError;
            if (lastErr) {
              reject(new Error(lastErr.message));
              return;
            }
            if (!response) {
              reject(new Error("no response from Bandit's background worker"));
              return;
            }
            if (!response.ok) {
              reject(new Error(response.error || "AI call failed"));
              return;
            }
            resolve(response);
          }
        );
      } catch (err) {
        reject(err);
      }
    });
  }
  async function getUserAIConfig() {
    try {
      const state2 = await loadState();
      const provider = state2.provider || "builtin";
      const hasBYOK = state2.apiKey && state2.apiKey.trim() || state2.apiKeys && Object.values(state2.apiKeys).some((k) => k && k.trim());
      return { provider, hasBYOK: !!hasBYOK };
    } catch (err) {
      return { provider: "builtin", hasBYOK: false };
    }
  }
  var lastCallAtByAction = /* @__PURE__ */ Object.create(null);
  async function aiPipeline(systemPrompt, userText, opts = {}) {
    const actionKey = opts.actionKey || "default";
    const debug = isDebugEnabled();
    const startedAt = Date.now();
    const now = Date.now();
    if (now - (lastCallAtByAction[actionKey] || 0) < RATE_LIMIT_MS) {
      throw new Error("slow down \u2014 try again in a moment");
    }
    lastCallAtByAction[actionKey] = now;
    const config = await getUserAIConfig();
    if (!config.hasBYOK) {
      let nanoResult = null;
      try {
        nanoResult = await tryNano(systemPrompt, userText, opts.onProgress);
      } catch (err) {
        debugLog("tryNano threw unexpectedly", err && err.message);
      }
      if (nanoResult) {
        if (debug) console.log("[Bandit AI]", "action=" + actionKey, "provider=nano", Date.now() - startedAt + "ms");
        return nanoResult;
      }
      if (config.provider === "builtin") {
        throw new Error("Built-in AI is not available in this browser. Please add a free API key in Settings (\u2699\uFE0F) to use AI enhancement.");
      }
    }
    const response = await callBackgroundWorker(systemPrompt, userText, debug, opts.onChunk);
    if (debug) console.log("[Bandit AI]", "action=" + actionKey, "provider=" + response.provider, Date.now() - startedAt + "ms");
    return response.text;
  }

  // src/ai/prompts.js
  var ENHANCE_CORE = `You are an elite prompt engineer. Your job is to take a user's rough, lazy, or incomplete thought and transform it into a masterclass prompt that will force any AI (ChatGPT, Claude, etc.) to produce excellent, specific output.

A great prompt MUST include:
1. PERSONA: "Act as a world-class expert in [Domain]..."
2. OBJECTIVE: A crystal clear, undeniable goal.
3. CONSTRAINTS: Hard negative rules (e.g., "Do not use AI clich\xE9s like 'delve', 'crucial', or 'tapestry'", "Do not hallucinate imports", etc.).
4. REASONING: A trigger for chain-of-thought (e.g., "Think step-by-step before answering" or "Analyze the request first").

Rules for you:
- Preserve the user's core intent exactly. Do not invent new features or topics they didn't ask for.
- If the input is complete gibberish (random letters with no meaning), output EXACTLY: ERROR_GIBBERISH
- NEVER insert [bracketed placeholders]. Instead, make reasonable assumptions based on context. For example, if the user says "write a blog", assume a general audience \u2014 do NOT write "[target audience]".
- Never write "The user wants". Write the prompt DIRECTLY to the AI as if it's instructions.

ABSOLUTE OUTPUT RULES (violating these is a critical failure):
- Your output MUST be at least 40 words. NEVER output a single word, a single sentence, or a short reply.
- NEVER echo or repeat the user's input back. Transform it \u2014 don't parrot it.
- NEVER respond with pleasantries like "Sure!", "OK!", "Great question!", etc. Jump straight to the rewritten prompt.
- NEVER add [brackets] or placeholders of any kind unless the user explicitly asked for a template.
- Your output IS the enhanced prompt. Nothing else. No commentary, no preamble, no "Here's your enhanced prompt:".

Format example:
Input: "write a blog about space"
Output:
**Role:** Act as a Pulitzer-winning science communicator.
**Objective:** Write a highly engaging, 500-word blog post about recent space exploration milestones for a general audience.
**Rules & Constraints:**
- Keep paragraphs under 3 sentences for scannability.
- Avoid generic AI buzzwords (e.g., 'tapestry', 'delve', 'realm').
- Focus heavily on recent tangible advancements (Mars rovers, James Webb Telescope).
**Formatting:** Use clean markdown with a catchy H1 and concluding call-to-action.
**Process:** Think step-by-step about the narrative arc before writing.`;
  var ENHANCE_STRUCTURED = ENHANCE_CORE + `

Rewrite the user's prompt into a highly structured, professional format exactly like the example: **Role**, **Objective**, **Context**, **Rules & Constraints** (bulleted), **Formatting**, and **Process**. Make it incredibly potent. Between 80-200 words. Output ONLY the rewritten prompt \u2014 no preamble, no commentary, no "Here is your prompt".`;
  var ENHANCE_CONCISE = ENHANCE_CORE + `

Rewrite the user's prompt as a single, devastatingly effective paragraph. It must still establish an expert persona, the exact goal, and at least 2 hard negative constraints to prevent generic AI output. End with a chain-of-thought trigger. Between 40-75 words. Output ONLY the rewritten prompt \u2014 no preamble, no commentary.`;
  var ENHANCE_DETAILED = ENHANCE_CORE + `

Rewrite the user's prompt into an ultimate, comprehensive master-spec. Include: **Role**, **Objective**, **Deep Context**, **Strict Constraints** (at least 5 hard rules), **Edge Cases / Pitfalls to Avoid**, **Output Format**, and a mandatory **Step-by-Step Reasoning Phase**. This prompt should guarantee a flawless zero-shot response from any LLM. Between 150-350 words. Output ONLY the rewritten prompt \u2014 no preamble, no commentary.`;
  var ENHANCE_SYSTEMS = {
    structured: ENHANCE_STRUCTURED,
    concise: ENHANCE_CONCISE,
    detailed: ENHANCE_DETAILED
  };
  var TONE_MODIFIERS = {
    professional: "",
    // default — no modifier needed
    casual: `

TONE OVERRIDE: Write the enhanced prompt in a casual, friendly, conversational tone. Use contractions, informal phrasing, and a warm approachable voice. Avoid stiff corporate language. The prompt should still be effective \u2014 just not stuffy.`,
    academic: `

TONE OVERRIDE: Write the enhanced prompt in a formal academic tone. Use precise terminology, structured argumentation, and scholarly phrasing. Reference established methodologies where appropriate. The prompt should read like instructions from a professor or research advisor.`,
    creative: `

TONE OVERRIDE: Write the enhanced prompt in a vivid, imaginative, boundary-pushing tone. Use rich metaphors, bold phrasing, and creative language that inspires the AI to think outside the box. The prompt should feel like it came from a visionary creative director.`
  };
  var SUMMARIZE_SYSTEM = `You are an expert scribe. Summarize this AI chat session into a context brief the user will paste into a NEW chat so the next AI can continue the work without re-asking anything.

Rules:
- Only facts stated in the chat. Never infer, never invent, never embellish.
- Prefer specifics (names, decisions, exact requirements) over generalities.
- If a section has nothing, write exactly "(none stated)".
- Your output MUST be at least 30 words. Never output a single word or single sentence.

Format \u2014 five sections, under 250 words total:
PROJECT: what is being worked on, one or two sentences.
CONTEXT / TOOLS: the specific tools, frameworks, or context required.
DECISIONS: choices made and, if stated, why.
CURRENT STATE: what works, what was just finished, what's in progress.
OPEN QUESTIONS: unresolved issues, known bugs, next steps.

Output only the brief \u2014 no preamble, no commentary.`;
  function buildSystemPrompt(style, tone, customInstructions = "") {
    const base = ENHANCE_SYSTEMS[style] || ENHANCE_STRUCTURED;
    const modifier = TONE_MODIFIERS[tone] || "";
    const custom = customInstructions && customInstructions.trim() ? `

USER CUSTOM RULES (CRITICAL): ${customInstructions.trim()}` : "";
    return base + modifier + custom;
  }

  // src/ui/injector.js
  function getDeepActiveElement() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) {
      el = el.shadowRoot.activeElement;
    }
    return el;
  }
  function getChatGPTInput() {
    const pm = document.querySelector('#prompt-textarea[contenteditable="true"]');
    if (pm && pm.offsetParent !== null) return pm;
    const ta = document.querySelector("#prompt-textarea");
    if (ta && ta.offsetParent !== null) return ta;
    return null;
  }
  function getGeminiInput() {
    const ql = document.querySelector('rich-textarea .ql-editor[contenteditable="true"]');
    if (ql && ql.offsetParent !== null) return ql;
    const rt = document.querySelector('rich-textarea [contenteditable="true"]');
    if (rt && rt.offsetParent !== null) return rt;
    const ta = document.querySelector(".input-area textarea, .text-input-field textarea");
    if (ta && ta.offsetParent !== null) return ta;
    return null;
  }
  function getClaudeInput() {
    const pm = document.querySelector('div.ProseMirror[contenteditable="true"]');
    if (pm && pm.offsetParent !== null) return pm;
    const anyCe = document.querySelector('fieldset [contenteditable="true"], main [contenteditable="true"]');
    if (anyCe && anyCe.offsetParent !== null) return anyCe;
    return null;
  }
  function getHostInput() {
    const host = window.location.hostname;
    if (host.includes("chatgpt.com") || host.includes("chat.openai.com")) {
      const el = getChatGPTInput();
      if (el) return el;
    }
    if (host.includes("claude.ai")) {
      const el = getClaudeInput();
      if (el) return el;
    }
    if (host.includes("gemini.google.com")) {
      const el = getGeminiInput();
      if (el) return el;
    }
    const active = getDeepActiveElement();
    if (active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT" || active.isContentEditable)) {
      if (active.disabled || active.readOnly) return null;
      const r = active.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return active;
    }
    const candidates = document.querySelectorAll(
      'textarea, input[type="text"], input:not([type]), div[contenteditable="true"], [contenteditable="plaintext-only"]'
    );
    let best = null, bestArea = 0;
    for (const el of candidates) {
      if (el.disabled || el.readOnly) continue;
      if (el.offsetParent === null) continue;
      const r = el.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) {
        bestArea = area;
        best = el;
      }
    }
    return best;
  }
  function dispatchReactInput(el) {
    try {
      el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText" }));
    } catch (err) {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function simulatePaste(el, text) {
    el.focus();
    if (el.isContentEditable) {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      let success = false;
      try {
        success = document.execCommand("insertText", false, text);
      } catch (_) {
      }
      if (!success) {
        el.textContent = text;
      }
      dispatchReactInput(el);
    } else {
      el.select();
      let success = false;
      try {
        success = document.execCommand("insertText", false, text);
      } catch (_) {
      }
      if (!success) {
        const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
        const nativeTextareaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
        if (el.tagName === "INPUT" && nativeInputSetter) nativeInputSetter.call(el, text);
        else if (el.tagName === "TEXTAREA" && nativeTextareaSetter) nativeTextareaSetter.call(el, text);
        else el.value = text;
      }
      dispatchReactInput(el);
    }
  }
  function setPromptText(hostInput, text) {
    hostInput.focus();
    simulatePaste(hostInput, text);
  }

  // src/ai/utils.js
  function detectProviderFromKey(apiKey) {
    const key = (apiKey || "").trim();
    if (!key) return null;
    if (key.startsWith("sk-ant-")) return "anthropic";
    if (key.startsWith("gsk_")) return "groq";
    if (key.startsWith("nvapi-")) return "nvidia";
    if (key.startsWith("sk-proj-") || key.startsWith("sk-")) return "openai";
    return "gemini";
  }

  // src/ui/settings.js
  function initSettings(doc, stateObj, callbacks) {
    const settingsModal = doc.getElementById("settingsModal");
    const settingName = doc.getElementById("settingName");
    const settingSize = doc.getElementById("settingSize");
    const sizeValue = doc.getElementById("sizeValue");
    const settingProvider = doc.getElementById("settingProvider");
    const settingApiKey = doc.getElementById("settingApiKey");
    const settingModel = doc.getElementById("settingModel");
    const settingCustomModel = doc.getElementById("settingCustomModel");
    const settingCustomInstructions = doc.getElementById("settingCustomInstructions");
    const settingStyle = doc.getElementById("settingStyle");
    const settingTone = doc.getElementById("settingTone");
    const settingAskPlaceholders = doc.getElementById("settingAskPlaceholders");
    const testApiKeyBtn = doc.getElementById("testApiKey");
    const testApiKeyStatus = doc.getElementById("testApiKeyStatus");
    const exportBtn = doc.getElementById("exportSettings");
    const importBtn = doc.getElementById("importSettings");
    const backupStatus = doc.getElementById("backupStatus");
    const getApiKeyLink = doc.getElementById("getApiKeyLink");
    const openTemplatesBtn = doc.getElementById("openTemplatesFromSettings");
    const API_LINKS = {
      anthropic: "https://console.anthropic.com/settings/keys",
      openai: "https://platform.openai.com/api-keys",
      gemini: "https://aistudio.google.com/app/apikey",
      groq: "https://console.groq.com/keys",
      nvidia: "https://build.nvidia.com/explore/discover"
    };
    function updateApiKeyLink(provider) {
      if (!getApiKeyLink) return;
      if (provider === "builtin") {
        getApiKeyLink.style.display = "none";
      } else {
        getApiKeyLink.style.display = "inline";
        getApiKeyLink.href = API_LINKS[provider] || "#";
      }
    }
    if (settingProvider) {
      settingProvider.value = stateObj.aiSettings.provider || "builtin";
      updateApiKeyLink(settingProvider.value);
    }
    if (settingApiKey) settingApiKey.value = stateObj.aiSettings.apiKeys && stateObj.aiSettings.apiKeys[stateObj.aiSettings.provider] || stateObj.aiSettings.apiKey || "";
    if (settingModel) settingModel.value = stateObj.aiSettings.model || "";
    if (settingCustomModel) settingCustomModel.value = stateObj.aiSettings.customModel || "";
    if (settingCustomInstructions) settingCustomInstructions.value = stateObj.aiSettings.customInstructions || "";
    if (settingStyle) settingStyle.value = stateObj.enhanceStyle;
    if (settingTone) settingTone.value = stateObj.enhanceTone;
    if (settingAskPlaceholders) settingAskPlaceholders.checked = stateObj.askPlaceholders;
    if (settingName) settingName.value = stateObj.petName;
    if (settingSize) settingSize.value = stateObj.settingsSize || 1;
    if (sizeValue) sizeValue.textContent = Math.round((stateObj.settingsSize || 1) * 100) + "%";
    let currentSettingsProvider = stateObj.aiSettings.provider || "builtin";
    if (settingApiKey) settingApiKey.addEventListener("input", () => {
      const detected = detectProviderFromKey(settingApiKey.value);
      if (detected && settingProvider) settingProvider.value = detected;
    });
    if (settingProvider) {
      settingProvider.addEventListener("change", () => {
        updateApiKeyLink(settingProvider.value);
        if (settingApiKey) settingApiKey.value = stateObj.aiSettings.apiKeys[settingProvider.value] || "";
        if (currentSettingsProvider !== "builtin") {
          stateObj.aiSettings.apiKeys[currentSettingsProvider] = settingApiKey ? settingApiKey.value.trim() : "";
        }
        currentSettingsProvider = settingProvider.value;
        if (settingApiKey) settingApiKey.value = stateObj.aiSettings.apiKeys[currentSettingsProvider] || "";
      });
    }
    const resetDisabledSites = doc.getElementById("resetDisabledSites");
    const resetDisabledStatus = doc.getElementById("resetDisabledStatus");
    if (resetDisabledSites) {
      resetDisabledSites.addEventListener("click", () => {
        callbacks.persist({ disabledSites: [] }, { immediate: true });
        if (resetDisabledStatus) {
          resetDisabledStatus.textContent = "Cleared!";
          setTimeout(() => {
            resetDisabledStatus.textContent = "";
          }, 2e3);
        }
      });
    }
    function saveSettings() {
      stateObj.petName = (settingName ? settingName.value.trim() : stateObj.petName) || "Bandit";
      callbacks.updateXPDisplay();
      const chosenProvider = settingProvider ? settingProvider.value || "builtin" : stateObj.aiSettings.provider;
      const enteredKey = settingApiKey ? settingApiKey.value.trim() : stateObj.aiSettings.apiKey;
      const newApiKeys = { ...stateObj.aiSettings.apiKeys };
      if (chosenProvider !== "builtin") newApiKeys[chosenProvider] = enteredKey;
      const modelOverride = (settingModel ? settingModel.value.trim() : "") || (settingCustomModel ? settingCustomModel.value.trim() : "") || stateObj.aiSettings.model || "";
      stateObj.aiSettings = {
        provider: chosenProvider,
        apiKey: enteredKey,
        model: modelOverride,
        customModel: modelOverride,
        customInstructions: settingCustomInstructions ? settingCustomInstructions.value.trim() : stateObj.aiSettings.customInstructions,
        apiKeys: newApiKeys
      };
      if (settingStyle) stateObj.enhanceStyle = settingStyle.value || "structured";
      if (settingTone) stateObj.enhanceTone = settingTone.value || "professional";
      if (settingAskPlaceholders) stateObj.askPlaceholders = settingAskPlaceholders.checked;
      callbacks.persist({
        petName: stateObj.petName,
        provider: stateObj.aiSettings.provider,
        apiKey: stateObj.aiSettings.apiKey,
        model: stateObj.aiSettings.model,
        customModel: stateObj.aiSettings.customModel,
        customInstructions: stateObj.aiSettings.customInstructions,
        apiKeys: newApiKeys,
        enhanceStyle: stateObj.enhanceStyle,
        enhanceTone: stateObj.enhanceTone,
        askPlaceholders: stateObj.askPlaceholders
      });
    }
    if (settingName) settingName.addEventListener("input", saveSettings);
    if (settingApiKey) settingApiKey.addEventListener("input", saveSettings);
    if (settingProvider) settingProvider.addEventListener("change", saveSettings);
    if (settingModel) settingModel.addEventListener("input", saveSettings);
    if (settingCustomModel) settingCustomModel.addEventListener("input", saveSettings);
    if (settingCustomInstructions) settingCustomInstructions.addEventListener("input", saveSettings);
    if (settingStyle) settingStyle.addEventListener("change", saveSettings);
    if (settingTone) settingTone.addEventListener("change", saveSettings);
    if (settingAskPlaceholders) settingAskPlaceholders.addEventListener("change", saveSettings);
    const closeSettings = doc.getElementById("closeSettings");
    if (closeSettings) closeSettings.addEventListener("click", () => {
      if (settingsModal) settingsModal.classList.remove("show");
      saveSettings();
    });
    if (openTemplatesBtn) {
      openTemplatesBtn.addEventListener("click", () => {
        if (settingsModal) settingsModal.classList.remove("show");
        if (callbacks.openTemplates) callbacks.openTemplates();
      });
    }
    if (exportBtn) exportBtn.addEventListener("click", () => {
      try {
        const historyList = callbacks.getHistory ? callbacks.getHistory() : stateObj.history || [];
        const stateToExport = {
          petName: stateObj.petName,
          xp: stateObj.xp,
          level: stateObj.level,
          enhanceStyle: stateObj.enhanceStyle,
          enhanceTone: stateObj.enhanceTone,
          askPlaceholders: stateObj.askPlaceholders,
          provider: stateObj.aiSettings.provider,
          apiKeys: stateObj.aiSettings.apiKeys,
          model: stateObj.aiSettings.model,
          customModel: stateObj.aiSettings.customModel,
          customInstructions: stateObj.aiSettings.customInstructions,
          history: historyList,
          customTemplates: stateObj.customTemplates || [],
          _banditBackup: true,
          _exportedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        const blob = new Blob([JSON.stringify(stateToExport, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `bandit-backup-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        if (backupStatus) {
          backupStatus.textContent = "Backup exported! \u2705";
          setTimeout(() => {
            backupStatus.textContent = "";
          }, 3e3);
        }
      } catch (err) {
        if (backupStatus) {
          backupStatus.textContent = "Export failed \u274C";
          backupStatus.style.color = "#f44";
          setTimeout(() => {
            backupStatus.textContent = "";
            backupStatus.style.color = "";
          }, 3e3);
        }
      }
    });
    if (importBtn) importBtn.addEventListener("click", () => {
      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = ".json";
      fileInput.addEventListener("change", () => {
        const file = fileInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const data = JSON.parse(reader.result);
            if (!data._banditBackup) throw new Error("Not a Bandit backup file");
            if (data.petName) {
              stateObj.petName = data.petName;
              if (settingName) settingName.value = stateObj.petName;
            }
            if (typeof data.xp === "number") {
              stateObj.xp = data.xp;
            }
            if (typeof data.level === "number") {
              stateObj.level = data.level;
            }
            if (data.enhanceStyle) {
              stateObj.enhanceStyle = data.enhanceStyle;
              if (settingStyle) settingStyle.value = stateObj.enhanceStyle;
            }
            if (data.enhanceTone) {
              stateObj.enhanceTone = data.enhanceTone;
              if (settingTone) settingTone.value = stateObj.enhanceTone;
            }
            if (typeof data.askPlaceholders === "boolean") {
              stateObj.askPlaceholders = data.askPlaceholders;
              if (settingAskPlaceholders) settingAskPlaceholders.checked = stateObj.askPlaceholders;
            }
            if (data.provider) {
              stateObj.aiSettings.provider = data.provider;
              if (settingProvider) settingProvider.value = data.provider;
            }
            if (data.apiKeys && typeof data.apiKeys === "object") {
              stateObj.aiSettings.apiKeys = data.apiKeys;
              if (settingApiKey) settingApiKey.value = data.apiKeys[data.provider] || "";
            }
            if (data.model) {
              stateObj.aiSettings.model = data.model;
              if (settingModel) settingModel.value = data.model;
            }
            if (data.customModel) {
              stateObj.aiSettings.customModel = data.customModel;
              if (settingCustomModel) settingCustomModel.value = data.customModel;
            }
            if (data.apiKeys && typeof data.apiKeys === "object") {
              stateObj.aiSettings.apiKeys = data.apiKeys;
            }
            const activeKey = data.apiKeys && data.apiKeys[stateObj.aiSettings.provider] || data.apiKey || "";
            stateObj.aiSettings.apiKey = activeKey;
            if (settingApiKey) settingApiKey.value = activeKey;
            const restoredModel = data.model || data.customModel || "";
            stateObj.aiSettings.model = restoredModel;
            stateObj.aiSettings.customModel = restoredModel;
            if (settingModel) settingModel.value = restoredModel;
            if (settingCustomModel) settingCustomModel.value = restoredModel;
            if (data.customInstructions) {
              stateObj.aiSettings.customInstructions = data.customInstructions;
              if (settingCustomInstructions) settingCustomInstructions.value = data.customInstructions;
            }
            if (Array.isArray(data.history)) {
              stateObj.history = data.history;
            }
            if (Array.isArray(data.customTemplates)) {
              stateObj.customTemplates = data.customTemplates;
            }
            callbacks.updateXPDisplay();
            callbacks.applyAccessories(stateObj.level);
            callbacks.persist({
              petName: stateObj.petName,
              xp: stateObj.xp,
              level: stateObj.level,
              enhanceStyle: stateObj.enhanceStyle,
              enhanceTone: stateObj.enhanceTone,
              askPlaceholders: stateObj.askPlaceholders,
              provider: stateObj.aiSettings.provider,
              apiKey: stateObj.aiSettings.apiKey,
              model: stateObj.aiSettings.model,
              customModel: stateObj.aiSettings.customModel,
              customInstructions: stateObj.aiSettings.customInstructions,
              apiKeys: stateObj.aiSettings.apiKeys,
              history: stateObj.history || [],
              customTemplates: stateObj.customTemplates || []
            }, { immediate: true });
            if (backupStatus) {
              backupStatus.textContent = "Backup restored! \u{1F389}";
              setTimeout(() => {
                backupStatus.textContent = "";
              }, 3e3);
            }
          } catch (err) {
            if (backupStatus) {
              backupStatus.textContent = "Invalid backup file \u274C";
              backupStatus.style.color = "#f44";
              setTimeout(() => {
                backupStatus.textContent = "";
                backupStatus.style.color = "";
              }, 3e3);
            }
          }
        };
        reader.readAsText(file);
      });
      fileInput.click();
    });
    if (settingSize) settingSize.addEventListener("input", (e) => {
      const s = e.target.value;
      stateObj.settingsSize = parseFloat(s);
      if (sizeValue) sizeValue.textContent = Math.round(s * 100) + "%";
      const wrap = doc.getElementById("petWrap");
      if (wrap) wrap.style.setProperty("--pet-scale", s);
      callbacks.persist({ settings: { size: parseFloat(s) } });
    });
    if (testApiKeyBtn) testApiKeyBtn.addEventListener("click", () => {
      const provider = settingProvider ? settingProvider.value : "builtin";
      if (provider === "builtin") {
        if (testApiKeyStatus) {
          testApiKeyStatus.textContent = "built-in AI needs no key \u2713";
          testApiKeyStatus.className = "test-key-status ok";
        }
        return;
      }
      const testSettings = {
        provider,
        apiKey: settingApiKey ? settingApiKey.value.trim() : "",
        model: settingModel ? settingModel.value.trim() : ""
      };
      if (!testSettings.apiKey) {
        if (testApiKeyStatus) {
          testApiKeyStatus.textContent = "paste a key first";
          testApiKeyStatus.className = "test-key-status fail";
        }
        return;
      }
      if (testApiKeyStatus) {
        testApiKeyStatus.textContent = "testing\u2026";
        testApiKeyStatus.className = "test-key-status";
      }
      testApiKeyBtn.disabled = true;
      callbacks.testAIKey(testSettings).then((res) => {
        if (testApiKeyStatus) {
          testApiKeyStatus.textContent = `\u2713 ${res.provider} key works`;
          testApiKeyStatus.className = "test-key-status ok";
        }
      }).catch((err) => {
        if (testApiKeyStatus) {
          testApiKeyStatus.textContent = `\u2717 ${callbacks.friendlyError(err)}`;
          testApiKeyStatus.className = "test-key-status fail";
        }
      }).finally(() => {
        testApiKeyBtn.disabled = false;
      });
    });
    return {
      show: () => {
        if (settingProvider) {
          settingProvider.value = stateObj.aiSettings.provider || "builtin";
          updateApiKeyLink(settingProvider.value);
        }
        if (settingApiKey) settingApiKey.value = stateObj.aiSettings.apiKeys && stateObj.aiSettings.apiKeys[stateObj.aiSettings.provider] || stateObj.aiSettings.apiKey || "";
        if (settingModel) settingModel.value = stateObj.aiSettings.model || "";
        if (settingCustomModel) settingCustomModel.value = stateObj.aiSettings.customModel || "";
        if (settingCustomInstructions) settingCustomInstructions.value = stateObj.aiSettings.customInstructions || "";
        if (settingStyle) settingStyle.value = stateObj.enhanceStyle;
        if (settingTone) settingTone.value = stateObj.enhanceTone;
        if (settingAskPlaceholders) settingAskPlaceholders.checked = stateObj.askPlaceholders;
        if (testApiKeyStatus) {
          testApiKeyStatus.textContent = "";
          testApiKeyStatus.className = "test-key-status";
        }
        if (settingsModal) settingsModal.classList.add("show");
      }
    };
  }

  // src/ui/modals.js
  function createDialog(onClose, container2) {
    const dialog = document.createElement("dialog");
    dialog.className = "modal";
    dialog.style.pointerEvents = "auto";
    let openedAt = Date.now();
    let backdropMouseDown = false;
    dialog.addEventListener("mousedown", (e) => {
      if (e.target === dialog) {
        const rect = dialog.getBoundingClientRect();
        const inDialog = rect.top <= e.clientY && e.clientY <= rect.top + rect.height && rect.left <= e.clientX && e.clientX <= rect.left + rect.width;
        if (!inDialog) {
          backdropMouseDown = true;
        }
      }
    });
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog && backdropMouseDown && Date.now() - openedAt > 250) {
        const rect = dialog.getBoundingClientRect();
        const inDialog = rect.top <= e.clientY && e.clientY <= rect.top + rect.height && rect.left <= e.clientX && e.clientX <= rect.left + rect.width;
        if (!inDialog) {
          dialog.close();
        }
      }
      backdropMouseDown = false;
    });
    let closed = false;
    dialog.addEventListener("close", () => {
      if (closed) return;
      closed = true;
      dialog.remove();
      if (onClose) onClose();
    });
    const host = container2 || document.body;
    host.appendChild(dialog);
    dialog.showModal();
    return {
      modal: dialog,
      show: () => {
        if (!dialog.open) dialog.showModal();
      },
      close: () => dialog.close()
    };
  }

  // src/ui/history.js
  function showHistoryModal({
    copyHistory,
    openRockyModal,
    timeAgo,
    copyToClipboard,
    showToast,
    persist,
    onClear
  }) {
    const { modal, close } = openRockyModal();
    const h = document.createElement("h3");
    h.textContent = "\u{1F4DC} History";
    modal.appendChild(h);
    const historyItems = Array.isArray(copyHistory) ? copyHistory : [];
    if (!historyItems.length) {
      const empty = document.createElement("div");
      empty.style.cssText = "font-size:12px;color:#8a95a5;line-height:1.6";
      empty.textContent = "Nothing here yet \u2014 enhance a prompt or summarize a chat, and it lands here for re-copying.";
      modal.appendChild(empty);
    } else {
      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "secondary";
      clearBtn.style.cssText = "font-size:11px;opacity:.7;margin-top:4px";
      clearBtn.textContent = "\u{1F5D1} Clear history";
      clearBtn.addEventListener("click", () => {
        if (onClear) onClear();
        persist({ history: [] });
        close();
        showToast("history cleared");
      });
      modal.appendChild(clearBtn);
    }
    historyItems.forEach((item) => {
      if (!item) return;
      const row = document.createElement("button");
      row.type = "button";
      row.className = "secondary";
      row.style.cssText = "text-align:left;white-space:normal;line-height:1.5;display:block;width:100%";
      const icon = item.type === "summary" ? "\u{1F4CB}" : "\u2728";
      const text = item.text || "";
      const preview = text.length > 90 ? text.slice(0, 90) + "\u2026" : text;
      const meta = document.createElement("div");
      meta.style.cssText = "font-size:10px;opacity:.6;margin-bottom:3px";
      meta.textContent = `${icon} ${item.type || "entry"} \xB7 ${timeAgo ? timeAgo(item.at) : "recently"} \xB7 click to copy`;
      const body = document.createElement("div");
      body.textContent = preview;
      row.appendChild(meta);
      row.appendChild(body);
      row.addEventListener("click", () => {
        copyToClipboard(text).then(() => {
          showToast("copied \u{1F4CB}");
          close();
        }).catch(() => {
          showToast("couldn't copy \u{1F616}");
        });
      });
      modal.appendChild(row);
    });
    const done = document.createElement("button");
    done.type = "button";
    done.textContent = "Close";
    done.addEventListener("click", close);
    modal.appendChild(done);
  }

  // src/ui/menu.js
  function bindMenuHandlers(doc, wrap, stateObj, callbacks) {
    const menuEnhance = doc.getElementById("menuEnhance");
    if (menuEnhance) menuEnhance.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      wrap.classList.remove("show-menu");
      callbacks.enhancePrompt();
    });
    const menuTemplates = doc.getElementById("menuTemplates");
    if (menuTemplates) menuTemplates.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      wrap.classList.remove("show-menu");
      callbacks.pokeActivity();
      if (callbacks.openTemplates) callbacks.openTemplates();
    });
    const menuUndo = doc.getElementById("menuUndo");
    if (menuUndo) menuUndo.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      wrap.classList.remove("show-menu");
      callbacks.pokeActivity();
      callbacks.undoEnhance();
    });
    const menuDisable = doc.getElementById("menuDisable");
    if (menuDisable) menuDisable.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      wrap.classList.remove("show-menu");
      const hostname = window.location.hostname;
      if (!hostname) {
        callbacks.say("I cannot be disabled on local files! \u{1F43E}", 3e3);
        return;
      }
      callbacks.disableOnSite(hostname);
    });
    const menuHome = doc.getElementById("menuHome");
    if (menuHome) menuHome.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      wrap.classList.remove("show-menu");
      callbacks.goHome();
    });
    const menuSummarize = doc.getElementById("menuSummarize");
    if (menuSummarize) menuSummarize.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      wrap.classList.remove("show-menu");
      callbacks.runSummarize();
    });
    const menuFeed = doc.getElementById("menuFeed");
    if (menuFeed) menuFeed.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      wrap.classList.remove("show-menu");
      callbacks.feedRocky();
    });
    const menuHistory = doc.getElementById("menuHistory");
    if (menuHistory) menuHistory.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      wrap.classList.remove("show-menu");
      callbacks.pokeActivity();
      showHistoryModal({
        copyHistory: callbacks.getHistory(),
        openRockyModal: callbacks.openRockyModal,
        timeAgo: callbacks.timeAgo,
        copyToClipboard: callbacks.copyToClipboard,
        showToast: callbacks.showToast,
        persist: callbacks.persist,
        onClear: () => {
          callbacks.persist({ history: [] }, { immediate: true });
        }
      });
    });
    const menuSettings = doc.getElementById("menuSettings");
    if (menuSettings) menuSettings.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      wrap.classList.remove("show-menu");
      if (callbacks.showSettings) callbacks.showSettings();
    });
  }

  // src/pet/sprites.js
  var BANDIT_SPRITES = {
    tail: `<rect x="24" y="18" width="4" height="3" fill="#9aa3ae" />
<rect x="27" y="16" width="4" height="3" fill="#1c1f26" />
<rect x="29" y="13" width="4" height="3" fill="#9aa3ae" />
<rect x="30" y="10" width="4" height="3" fill="#1c1f26" />
<rect x="30" y="7" width="4" height="3" fill="#9aa3ae" />
<rect x="29" y="4" width="4" height="3" fill="#1c1f26" />
`,
    ears: `<rect x="4" y="2" width="1" height="1" fill="#1c1f26" />
<rect x="5" y="2" width="1" height="1" fill="#1c1f26" />
<rect x="20" y="2" width="1" height="1" fill="#1c1f26" />
<rect x="21" y="2" width="1" height="1" fill="#1c1f26" />
<rect x="3" y="3" width="1" height="1" fill="#1c1f26" />
<rect x="4" y="3" width="1" height="1" fill="#9aa3ae" />
<rect x="5" y="3" width="1" height="1" fill="#9aa3ae" />
<rect x="6" y="3" width="1" height="1" fill="#1c1f26" />
<rect x="19" y="3" width="1" height="1" fill="#1c1f26" />
<rect x="20" y="3" width="1" height="1" fill="#9aa3ae" />
<rect x="21" y="3" width="1" height="1" fill="#9aa3ae" />
<rect x="22" y="3" width="1" height="1" fill="#1c1f26" />
<rect x="3" y="4" width="1" height="1" fill="#1c1f26" />
<rect x="4" y="4" width="1" height="1" fill="#9aa3ae" />
<rect x="5" y="4" width="1" height="1" fill="#5b6470" />
<rect x="6" y="4" width="1" height="1" fill="#9aa3ae" />
<rect x="7" y="4" width="1" height="1" fill="#1c1f26" />
<rect x="18" y="4" width="1" height="1" fill="#1c1f26" />
<rect x="19" y="4" width="1" height="1" fill="#9aa3ae" />
<rect x="20" y="4" width="1" height="1" fill="#5b6470" />
<rect x="21" y="4" width="1" height="1" fill="#9aa3ae" />
<rect x="22" y="4" width="1" height="1" fill="#1c1f26" />
<rect x="3" y="5" width="1" height="1" fill="#1c1f26" />
<rect x="4" y="5" width="1" height="1" fill="#9aa3ae" />
<rect x="5" y="5" width="1" height="1" fill="#9aa3ae" />
<rect x="6" y="5" width="1" height="1" fill="#9aa3ae" />
<rect x="7" y="5" width="1" height="1" fill="#1c1f26" />
<rect x="8" y="5" width="1" height="1" fill="#1c1f26" />
<rect x="9" y="5" width="1" height="1" fill="#1c1f26" />
<rect x="10" y="5" width="1" height="1" fill="#1c1f26" />
<rect x="11" y="5" width="1" height="1" fill="#1c1f26" />
<rect x="12" y="5" width="1" height="1" fill="#1c1f26" />
<rect x="13" y="5" width="1" height="1" fill="#1c1f26" />
<rect x="14" y="5" width="1" height="1" fill="#1c1f26" />
<rect x="15" y="5" width="1" height="1" fill="#1c1f26" />
<rect x="16" y="5" width="1" height="1" fill="#1c1f26" />
<rect x="17" y="5" width="1" height="1" fill="#1c1f26" />
<rect x="18" y="5" width="1" height="1" fill="#1c1f26" />
<rect x="19" y="5" width="1" height="1" fill="#9aa3ae" />
<rect x="20" y="5" width="1" height="1" fill="#9aa3ae" />
<rect x="21" y="5" width="1" height="1" fill="#9aa3ae" />
<rect x="22" y="5" width="1" height="1" fill="#1c1f26" />
`,
    body: `<rect x="2" y="6" width="1" height="1" fill="#1c1f26" />
<rect x="3" y="6" width="1" height="1" fill="#9aa3ae" />
<rect x="4" y="6" width="1" height="1" fill="#9aa3ae" />
<rect x="5" y="6" width="1" height="1" fill="#9aa3ae" />
<rect x="6" y="6" width="1" height="1" fill="#9aa3ae" />
<rect x="7" y="6" width="1" height="1" fill="#9aa3ae" />
<rect x="8" y="6" width="1" height="1" fill="#9aa3ae" />
<rect x="9" y="6" width="1" height="1" fill="#9aa3ae" />
<rect x="10" y="6" width="1" height="1" fill="#9aa3ae" />
<rect x="11" y="6" width="1" height="1" fill="#9aa3ae" />
<rect x="12" y="6" width="1" height="1" fill="#9aa3ae" />
<rect x="13" y="6" width="1" height="1" fill="#9aa3ae" />
<rect x="14" y="6" width="1" height="1" fill="#9aa3ae" />
<rect x="15" y="6" width="1" height="1" fill="#9aa3ae" />
<rect x="16" y="6" width="1" height="1" fill="#9aa3ae" />
<rect x="17" y="6" width="1" height="1" fill="#9aa3ae" />
<rect x="18" y="6" width="1" height="1" fill="#9aa3ae" />
<rect x="19" y="6" width="1" height="1" fill="#9aa3ae" />
<rect x="20" y="6" width="1" height="1" fill="#9aa3ae" />
<rect x="21" y="6" width="1" height="1" fill="#9aa3ae" />
<rect x="22" y="6" width="1" height="1" fill="#9aa3ae" />
<rect x="23" y="6" width="1" height="1" fill="#1c1f26" />
<rect x="2" y="7" width="1" height="1" fill="#1c1f26" />
<rect x="3" y="7" width="1" height="1" fill="#9aa3ae" />
<rect x="4" y="7" width="1" height="1" fill="#9aa3ae" />
<rect x="5" y="7" width="1" height="1" fill="#9aa3ae" />
<rect x="6" y="7" width="1" height="1" fill="#9aa3ae" />
<rect x="7" y="7" width="1" height="1" fill="#9aa3ae" />
<rect x="8" y="7" width="1" height="1" fill="#9aa3ae" />
<rect x="9" y="7" width="1" height="1" fill="#9aa3ae" />
<rect x="10" y="7" width="1" height="1" fill="#9aa3ae" />
<rect x="11" y="7" width="1" height="1" fill="#9aa3ae" />
<rect x="12" y="7" width="1" height="1" fill="#9aa3ae" />
<rect x="13" y="7" width="1" height="1" fill="#9aa3ae" />
<rect x="14" y="7" width="1" height="1" fill="#9aa3ae" />
<rect x="15" y="7" width="1" height="1" fill="#9aa3ae" />
<rect x="16" y="7" width="1" height="1" fill="#9aa3ae" />
<rect x="17" y="7" width="1" height="1" fill="#9aa3ae" />
<rect x="18" y="7" width="1" height="1" fill="#9aa3ae" />
<rect x="19" y="7" width="1" height="1" fill="#9aa3ae" />
<rect x="20" y="7" width="1" height="1" fill="#9aa3ae" />
<rect x="21" y="7" width="1" height="1" fill="#9aa3ae" />
<rect x="22" y="7" width="1" height="1" fill="#9aa3ae" />
<rect x="23" y="7" width="1" height="1" fill="#1c1f26" />
<rect x="1" y="8" width="1" height="1" fill="#1c1f26" />
<rect x="2" y="8" width="1" height="1" fill="#9aa3ae" />
<rect x="3" y="8" width="1" height="1" fill="#9aa3ae" />
<rect x="4" y="8" width="1" height="1" fill="#9aa3ae" />
<rect x="5" y="8" width="1" height="1" fill="#9aa3ae" />
<rect x="6" y="8" width="1" height="1" fill="#9aa3ae" />
<rect x="7" y="8" width="1" height="1" fill="#9aa3ae" />
<rect x="8" y="8" width="1" height="1" fill="#9aa3ae" />
<rect x="9" y="8" width="1" height="1" fill="#9aa3ae" />
<rect x="10" y="8" width="1" height="1" fill="#9aa3ae" />
<rect x="11" y="8" width="1" height="1" fill="#9aa3ae" />
<rect x="12" y="8" width="1" height="1" fill="#9aa3ae" />
<rect x="13" y="8" width="1" height="1" fill="#9aa3ae" />
<rect x="14" y="8" width="1" height="1" fill="#9aa3ae" />
<rect x="15" y="8" width="1" height="1" fill="#9aa3ae" />
<rect x="16" y="8" width="1" height="1" fill="#9aa3ae" />
<rect x="17" y="8" width="1" height="1" fill="#9aa3ae" />
<rect x="18" y="8" width="1" height="1" fill="#9aa3ae" />
<rect x="19" y="8" width="1" height="1" fill="#9aa3ae" />
<rect x="20" y="8" width="1" height="1" fill="#9aa3ae" />
<rect x="21" y="8" width="1" height="1" fill="#9aa3ae" />
<rect x="22" y="8" width="1" height="1" fill="#9aa3ae" />
<rect x="23" y="8" width="1" height="1" fill="#9aa3ae" />
<rect x="24" y="8" width="1" height="1" fill="#1c1f26" />
<rect x="1" y="9" width="1" height="1" fill="#1c1f26" />
<rect x="2" y="9" width="1" height="1" fill="#9aa3ae" />
<rect x="3" y="9" width="1" height="1" fill="#2b2f38" />
<rect x="4" y="9" width="1" height="1" fill="#2b2f38" />
<rect x="5" y="9" width="1" height="1" fill="#2b2f38" />
<rect x="6" y="9" width="1" height="1" fill="#2b2f38" />
<rect x="7" y="9" width="1" height="1" fill="#2b2f38" />
<rect x="8" y="9" width="1" height="1" fill="#9aa3ae" />
<rect x="9" y="9" width="1" height="1" fill="#9aa3ae" />
<rect x="10" y="9" width="1" height="1" fill="#9aa3ae" />
<rect x="11" y="9" width="1" height="1" fill="#9aa3ae" />
<rect x="12" y="9" width="1" height="1" fill="#9aa3ae" />
<rect x="13" y="9" width="1" height="1" fill="#9aa3ae" />
<rect x="14" y="9" width="1" height="1" fill="#9aa3ae" />
<rect x="15" y="9" width="1" height="1" fill="#9aa3ae" />
<rect x="16" y="9" width="1" height="1" fill="#9aa3ae" />
<rect x="17" y="9" width="1" height="1" fill="#9aa3ae" />
<rect x="18" y="9" width="1" height="1" fill="#2b2f38" />
<rect x="19" y="9" width="1" height="1" fill="#2b2f38" />
<rect x="20" y="9" width="1" height="1" fill="#2b2f38" />
<rect x="21" y="9" width="1" height="1" fill="#2b2f38" />
<rect x="22" y="9" width="1" height="1" fill="#2b2f38" />
<rect x="23" y="9" width="1" height="1" fill="#9aa3ae" />
<rect x="24" y="9" width="1" height="1" fill="#1c1f26" />
<rect x="1" y="10" width="1" height="1" fill="#1c1f26" />
<rect x="2" y="10" width="1" height="1" fill="#2b2f38" />
<rect x="3" y="10" width="1" height="1" fill="#2b2f38" />
<rect x="4" y="10" width="1" height="1" fill="#2b2f38" />
<rect x="5" y="10" width="1" height="1" fill="#2b2f38" />
<rect x="6" y="10" width="1" height="1" fill="#2b2f38" />
<rect x="7" y="10" width="1" height="1" fill="#2b2f38" />
<rect x="8" y="10" width="1" height="1" fill="#2b2f38" />
<rect x="9" y="10" width="1" height="1" fill="#9aa3ae" />
<rect x="10" y="10" width="1" height="1" fill="#9aa3ae" />
<rect x="11" y="10" width="1" height="1" fill="#9aa3ae" />
<rect x="12" y="10" width="1" height="1" fill="#9aa3ae" />
<rect x="13" y="10" width="1" height="1" fill="#9aa3ae" />
<rect x="14" y="10" width="1" height="1" fill="#9aa3ae" />
<rect x="15" y="10" width="1" height="1" fill="#9aa3ae" />
<rect x="16" y="10" width="1" height="1" fill="#9aa3ae" />
<rect x="17" y="10" width="1" height="1" fill="#2b2f38" />
<rect x="18" y="10" width="1" height="1" fill="#2b2f38" />
<rect x="19" y="10" width="1" height="1" fill="#2b2f38" />
<rect x="20" y="10" width="1" height="1" fill="#2b2f38" />
<rect x="21" y="10" width="1" height="1" fill="#2b2f38" />
<rect x="22" y="10" width="1" height="1" fill="#2b2f38" />
<rect x="23" y="10" width="1" height="1" fill="#2b2f38" />
<rect x="24" y="10" width="1" height="1" fill="#1c1f26" />
<rect x="1" y="11" width="1" height="1" fill="#1c1f26" />
<rect x="2" y="11" width="1" height="1" fill="#2b2f38" />
<rect x="3" y="11" width="1" height="1" fill="#2b2f38" />
<rect x="4" y="11" width="1" height="1" fill="#ffffff" />
<rect x="5" y="11" width="1" height="1" fill="#ffffff" />
<rect x="6" y="11" width="1" height="1" fill="#2b2f38" />
<rect x="7" y="11" width="1" height="1" fill="#2b2f38" />
<rect x="8" y="11" width="1" height="1" fill="#2b2f38" />
<rect x="9" y="11" width="1" height="1" fill="#9aa3ae" />
<rect x="10" y="11" width="1" height="1" fill="#9aa3ae" />
<rect x="11" y="11" width="1" height="1" fill="#9aa3ae" />
<rect x="12" y="11" width="1" height="1" fill="#9aa3ae" />
<rect x="13" y="11" width="1" height="1" fill="#9aa3ae" />
<rect x="14" y="11" width="1" height="1" fill="#9aa3ae" />
<rect x="15" y="11" width="1" height="1" fill="#9aa3ae" />
<rect x="16" y="11" width="1" height="1" fill="#9aa3ae" />
<rect x="17" y="11" width="1" height="1" fill="#2b2f38" />
<rect x="18" y="11" width="1" height="1" fill="#2b2f38" />
<rect x="19" y="11" width="1" height="1" fill="#2b2f38" />
<rect x="20" y="11" width="1" height="1" fill="#ffffff" />
<rect x="21" y="11" width="1" height="1" fill="#ffffff" />
<rect x="22" y="11" width="1" height="1" fill="#2b2f38" />
<rect x="23" y="11" width="1" height="1" fill="#2b2f38" />
<rect x="24" y="11" width="1" height="1" fill="#1c1f26" />
<rect x="1" y="12" width="1" height="1" fill="#1c1f26" />
<rect x="2" y="12" width="1" height="1" fill="#2b2f38" />
<rect x="3" y="12" width="1" height="1" fill="#2b2f38" />
<rect x="4" y="12" width="1" height="1" fill="#ffffff" />
<rect x="5" y="12" width="1" height="1" fill="#ffffff" />
<rect x="6" y="12" width="1" height="1" fill="#2b2f38" />
<rect x="7" y="12" width="1" height="1" fill="#2b2f38" />
<rect x="8" y="12" width="1" height="1" fill="#2b2f38" />
<rect x="9" y="12" width="1" height="1" fill="#9aa3ae" />
<rect x="10" y="12" width="1" height="1" fill="#9aa3ae" />
<rect x="11" y="12" width="1" height="1" fill="#9aa3ae" />
<rect x="12" y="12" width="1" height="1" fill="#9aa3ae" />
<rect x="13" y="12" width="1" height="1" fill="#9aa3ae" />
<rect x="14" y="12" width="1" height="1" fill="#9aa3ae" />
<rect x="15" y="12" width="1" height="1" fill="#9aa3ae" />
<rect x="16" y="12" width="1" height="1" fill="#9aa3ae" />
<rect x="17" y="12" width="1" height="1" fill="#2b2f38" />
<rect x="18" y="12" width="1" height="1" fill="#2b2f38" />
<rect x="19" y="12" width="1" height="1" fill="#2b2f38" />
<rect x="20" y="12" width="1" height="1" fill="#ffffff" />
<rect x="21" y="12" width="1" height="1" fill="#ffffff" />
<rect x="22" y="12" width="1" height="1" fill="#2b2f38" />
<rect x="23" y="12" width="1" height="1" fill="#2b2f38" />
<rect x="24" y="12" width="1" height="1" fill="#1c1f26" />
<rect x="1" y="13" width="1" height="1" fill="#1c1f26" />
<rect x="2" y="13" width="1" height="1" fill="#9aa3ae" />
<rect x="3" y="13" width="1" height="1" fill="#2b2f38" />
<rect x="4" y="13" width="1" height="1" fill="#2b2f38" />
<rect x="5" y="13" width="1" height="1" fill="#2b2f38" />
<rect x="6" y="13" width="1" height="1" fill="#2b2f38" />
<rect x="7" y="13" width="1" height="1" fill="#2b2f38" />
<rect x="8" y="13" width="1" height="1" fill="#9aa3ae" />
<rect x="9" y="13" width="1" height="1" fill="#9aa3ae" />
<rect x="10" y="13" width="1" height="1" fill="#efe7d6" />
<rect x="11" y="13" width="1" height="1" fill="#efe7d6" />
<rect x="12" y="13" width="1" height="1" fill="#efe7d6" />
<rect x="13" y="13" width="1" height="1" fill="#efe7d6" />
<rect x="14" y="13" width="1" height="1" fill="#efe7d6" />
<rect x="15" y="13" width="1" height="1" fill="#efe7d6" />
<rect x="16" y="13" width="1" height="1" fill="#9aa3ae" />
<rect x="17" y="13" width="1" height="1" fill="#9aa3ae" />
<rect x="18" y="13" width="1" height="1" fill="#2b2f38" />
<rect x="19" y="13" width="1" height="1" fill="#2b2f38" />
<rect x="20" y="13" width="1" height="1" fill="#2b2f38" />
<rect x="21" y="13" width="1" height="1" fill="#2b2f38" />
<rect x="22" y="13" width="1" height="1" fill="#2b2f38" />
<rect x="23" y="13" width="1" height="1" fill="#9aa3ae" />
<rect x="24" y="13" width="1" height="1" fill="#1c1f26" />
<rect x="1" y="14" width="1" height="1" fill="#1c1f26" />
<rect x="2" y="14" width="1" height="1" fill="#9aa3ae" />
<rect x="3" y="14" width="1" height="1" fill="#9aa3ae" />
<rect x="4" y="14" width="1" height="1" fill="#9aa3ae" />
<rect x="5" y="14" width="1" height="1" fill="#9aa3ae" />
<rect x="6" y="14" width="1" height="1" fill="#9aa3ae" />
<rect x="7" y="14" width="1" height="1" fill="#9aa3ae" />
<rect x="8" y="14" width="1" height="1" fill="#efe7d6" />
<rect x="9" y="14" width="1" height="1" fill="#efe7d6" />
<rect x="10" y="14" width="1" height="1" fill="#efe7d6" />
<rect x="11" y="14" width="1" height="1" fill="#efe7d6" />
<rect x="12" y="14" width="1" height="1" fill="#efe7d6" />
<rect x="13" y="14" width="1" height="1" fill="#efe7d6" />
<rect x="14" y="14" width="1" height="1" fill="#efe7d6" />
<rect x="15" y="14" width="1" height="1" fill="#efe7d6" />
<rect x="16" y="14" width="1" height="1" fill="#efe7d6" />
<rect x="17" y="14" width="1" height="1" fill="#efe7d6" />
<rect x="18" y="14" width="1" height="1" fill="#9aa3ae" />
<rect x="19" y="14" width="1" height="1" fill="#9aa3ae" />
<rect x="20" y="14" width="1" height="1" fill="#9aa3ae" />
<rect x="21" y="14" width="1" height="1" fill="#9aa3ae" />
<rect x="22" y="14" width="1" height="1" fill="#9aa3ae" />
<rect x="23" y="14" width="1" height="1" fill="#9aa3ae" />
<rect x="24" y="14" width="1" height="1" fill="#1c1f26" />
<rect x="1" y="15" width="1" height="1" fill="#1c1f26" />
<rect x="2" y="15" width="1" height="1" fill="#9aa3ae" />
<rect x="3" y="15" width="1" height="1" fill="#9aa3ae" />
<rect x="4" y="15" width="1" height="1" fill="#9aa3ae" />
<rect x="5" y="15" width="1" height="1" fill="#9aa3ae" />
<rect x="6" y="15" width="1" height="1" fill="#9aa3ae" />
<rect x="7" y="15" width="1" height="1" fill="#efe7d6" />
<rect x="8" y="15" width="1" height="1" fill="#efe7d6" />
<rect x="9" y="15" width="1" height="1" fill="#efe7d6" />
<rect x="10" y="15" width="1" height="1" fill="#efe7d6" />
<rect x="11" y="15" width="1" height="1" fill="#1c1f26" />
<rect x="12" y="15" width="1" height="1" fill="#1c1f26" />
<rect x="13" y="15" width="1" height="1" fill="#1c1f26" />
<rect x="14" y="15" width="1" height="1" fill="#1c1f26" />
<rect x="15" y="15" width="1" height="1" fill="#efe7d6" />
<rect x="16" y="15" width="1" height="1" fill="#efe7d6" />
<rect x="17" y="15" width="1" height="1" fill="#efe7d6" />
<rect x="18" y="15" width="1" height="1" fill="#efe7d6" />
<rect x="19" y="15" width="1" height="1" fill="#9aa3ae" />
<rect x="20" y="15" width="1" height="1" fill="#9aa3ae" />
<rect x="21" y="15" width="1" height="1" fill="#9aa3ae" />
<rect x="22" y="15" width="1" height="1" fill="#9aa3ae" />
<rect x="23" y="15" width="1" height="1" fill="#9aa3ae" />
<rect x="24" y="15" width="1" height="1" fill="#1c1f26" />
<rect x="2" y="16" width="1" height="1" fill="#1c1f26" />
<rect x="3" y="16" width="1" height="1" fill="#9aa3ae" />
<rect x="4" y="16" width="1" height="1" fill="#9aa3ae" />
<rect x="5" y="16" width="1" height="1" fill="#9aa3ae" />
<rect x="6" y="16" width="1" height="1" fill="#9aa3ae" />
<rect x="7" y="16" width="1" height="1" fill="#efe7d6" />
<rect x="8" y="16" width="1" height="1" fill="#efe7d6" />
<rect x="9" y="16" width="1" height="1" fill="#efe7d6" />
<rect x="10" y="16" width="1" height="1" fill="#efe7d6" />
<rect x="11" y="16" width="1" height="1" fill="#1c1f26" />
<rect x="12" y="16" width="1" height="1" fill="#1c1f26" />
<rect x="13" y="16" width="1" height="1" fill="#1c1f26" />
<rect x="14" y="16" width="1" height="1" fill="#1c1f26" />
<rect x="15" y="16" width="1" height="1" fill="#efe7d6" />
<rect x="16" y="16" width="1" height="1" fill="#efe7d6" />
<rect x="17" y="16" width="1" height="1" fill="#efe7d6" />
<rect x="18" y="16" width="1" height="1" fill="#efe7d6" />
<rect x="19" y="16" width="1" height="1" fill="#9aa3ae" />
<rect x="20" y="16" width="1" height="1" fill="#9aa3ae" />
<rect x="21" y="16" width="1" height="1" fill="#9aa3ae" />
<rect x="22" y="16" width="1" height="1" fill="#9aa3ae" />
<rect x="23" y="16" width="1" height="1" fill="#1c1f26" />
<rect x="2" y="17" width="1" height="1" fill="#1c1f26" />
<rect x="3" y="17" width="1" height="1" fill="#9aa3ae" />
<rect x="4" y="17" width="1" height="1" fill="#9aa3ae" />
<rect x="5" y="17" width="1" height="1" fill="#9aa3ae" />
<rect x="6" y="17" width="1" height="1" fill="#9aa3ae" />
<rect x="7" y="17" width="1" height="1" fill="#9aa3ae" />
<rect x="8" y="17" width="1" height="1" fill="#efe7d6" />
<rect x="9" y="17" width="1" height="1" fill="#efe7d6" />
<rect x="10" y="17" width="1" height="1" fill="#efe7d6" />
<rect x="11" y="17" width="1" height="1" fill="#efe7d6" />
<rect x="12" y="17" width="1" height="1" fill="#efe7d6" />
<rect x="13" y="17" width="1" height="1" fill="#efe7d6" />
<rect x="14" y="17" width="1" height="1" fill="#efe7d6" />
<rect x="15" y="17" width="1" height="1" fill="#efe7d6" />
<rect x="16" y="17" width="1" height="1" fill="#efe7d6" />
<rect x="17" y="17" width="1" height="1" fill="#efe7d6" />
<rect x="18" y="17" width="1" height="1" fill="#9aa3ae" />
<rect x="19" y="17" width="1" height="1" fill="#9aa3ae" />
<rect x="20" y="17" width="1" height="1" fill="#9aa3ae" />
<rect x="21" y="17" width="1" height="1" fill="#9aa3ae" />
<rect x="22" y="17" width="1" height="1" fill="#9aa3ae" />
<rect x="23" y="17" width="1" height="1" fill="#1c1f26" />
<rect x="3" y="18" width="1" height="1" fill="#1c1f26" />
<rect x="4" y="18" width="1" height="1" fill="#9aa3ae" />
<rect x="5" y="18" width="1" height="1" fill="#9aa3ae" />
<rect x="6" y="18" width="1" height="1" fill="#9aa3ae" />
<rect x="7" y="18" width="1" height="1" fill="#9aa3ae" />
<rect x="8" y="18" width="1" height="1" fill="#9aa3ae" />
<rect x="9" y="18" width="1" height="1" fill="#efe7d6" />
<rect x="10" y="18" width="1" height="1" fill="#efe7d6" />
<rect x="11" y="18" width="1" height="1" fill="#efe7d6" />
<rect x="12" y="18" width="1" height="1" fill="#efe7d6" />
<rect x="13" y="18" width="1" height="1" fill="#efe7d6" />
<rect x="14" y="18" width="1" height="1" fill="#efe7d6" />
<rect x="15" y="18" width="1" height="1" fill="#efe7d6" />
<rect x="16" y="18" width="1" height="1" fill="#efe7d6" />
<rect x="17" y="18" width="1" height="1" fill="#9aa3ae" />
<rect x="18" y="18" width="1" height="1" fill="#9aa3ae" />
<rect x="19" y="18" width="1" height="1" fill="#9aa3ae" />
<rect x="20" y="18" width="1" height="1" fill="#9aa3ae" />
<rect x="21" y="18" width="1" height="1" fill="#9aa3ae" />
<rect x="22" y="18" width="1" height="1" fill="#1c1f26" />
<rect x="3" y="19" width="1" height="1" fill="#1c1f26" />
<rect x="4" y="19" width="1" height="1" fill="#9aa3ae" />
<rect x="5" y="19" width="1" height="1" fill="#9aa3ae" />
<rect x="6" y="19" width="1" height="1" fill="#9aa3ae" />
<rect x="7" y="19" width="1" height="1" fill="#9aa3ae" />
<rect x="8" y="19" width="1" height="1" fill="#9aa3ae" />
<rect x="9" y="19" width="1" height="1" fill="#9aa3ae" />
<rect x="10" y="19" width="1" height="1" fill="#9aa3ae" />
<rect x="11" y="19" width="1" height="1" fill="#9aa3ae" />
<rect x="12" y="19" width="1" height="1" fill="#9aa3ae" />
<rect x="13" y="19" width="1" height="1" fill="#9aa3ae" />
<rect x="14" y="19" width="1" height="1" fill="#9aa3ae" />
<rect x="15" y="19" width="1" height="1" fill="#9aa3ae" />
<rect x="16" y="19" width="1" height="1" fill="#9aa3ae" />
<rect x="17" y="19" width="1" height="1" fill="#9aa3ae" />
<rect x="18" y="19" width="1" height="1" fill="#9aa3ae" />
<rect x="19" y="19" width="1" height="1" fill="#9aa3ae" />
<rect x="20" y="19" width="1" height="1" fill="#9aa3ae" />
<rect x="21" y="19" width="1" height="1" fill="#9aa3ae" />
<rect x="22" y="19" width="1" height="1" fill="#1c1f26" />
<rect x="2" y="20" width="1" height="1" fill="#1c1f26" />
<rect x="3" y="20" width="1" height="1" fill="#9aa3ae" />
<rect x="4" y="20" width="1" height="1" fill="#9aa3ae" />
<rect x="5" y="20" width="1" height="1" fill="#9aa3ae" />
<rect x="6" y="20" width="1" height="1" fill="#9aa3ae" />
<rect x="7" y="20" width="1" height="1" fill="#9aa3ae" />
<rect x="8" y="20" width="1" height="1" fill="#9aa3ae" />
<rect x="9" y="20" width="1" height="1" fill="#9aa3ae" />
<rect x="10" y="20" width="1" height="1" fill="#9aa3ae" />
<rect x="11" y="20" width="1" height="1" fill="#9aa3ae" />
<rect x="12" y="20" width="1" height="1" fill="#9aa3ae" />
<rect x="13" y="20" width="1" height="1" fill="#9aa3ae" />
<rect x="14" y="20" width="1" height="1" fill="#9aa3ae" />
<rect x="15" y="20" width="1" height="1" fill="#9aa3ae" />
<rect x="16" y="20" width="1" height="1" fill="#9aa3ae" />
<rect x="17" y="20" width="1" height="1" fill="#9aa3ae" />
<rect x="18" y="20" width="1" height="1" fill="#9aa3ae" />
<rect x="19" y="20" width="1" height="1" fill="#9aa3ae" />
<rect x="20" y="20" width="1" height="1" fill="#9aa3ae" />
<rect x="21" y="20" width="1" height="1" fill="#9aa3ae" />
<rect x="22" y="20" width="1" height="1" fill="#9aa3ae" />
<rect x="23" y="20" width="1" height="1" fill="#1c1f26" />
<rect x="2" y="21" width="1" height="1" fill="#1c1f26" />
<rect x="3" y="21" width="1" height="1" fill="#9aa3ae" />
<rect x="4" y="21" width="1" height="1" fill="#9aa3ae" />
<rect x="5" y="21" width="1" height="1" fill="#9aa3ae" />
<rect x="6" y="21" width="1" height="1" fill="#9aa3ae" />
<rect x="7" y="21" width="1" height="1" fill="#5b6470" />
<rect x="8" y="21" width="1" height="1" fill="#9aa3ae" />
<rect x="9" y="21" width="1" height="1" fill="#9aa3ae" />
<rect x="10" y="21" width="1" height="1" fill="#9aa3ae" />
<rect x="11" y="21" width="1" height="1" fill="#9aa3ae" />
<rect x="12" y="21" width="1" height="1" fill="#9aa3ae" />
<rect x="13" y="21" width="1" height="1" fill="#9aa3ae" />
<rect x="14" y="21" width="1" height="1" fill="#9aa3ae" />
<rect x="15" y="21" width="1" height="1" fill="#9aa3ae" />
<rect x="16" y="21" width="1" height="1" fill="#9aa3ae" />
<rect x="17" y="21" width="1" height="1" fill="#9aa3ae" />
<rect x="18" y="21" width="1" height="1" fill="#5b6470" />
<rect x="19" y="21" width="1" height="1" fill="#9aa3ae" />
<rect x="20" y="21" width="1" height="1" fill="#9aa3ae" />
<rect x="21" y="21" width="1" height="1" fill="#9aa3ae" />
<rect x="22" y="21" width="1" height="1" fill="#9aa3ae" />
<rect x="23" y="21" width="1" height="1" fill="#1c1f26" />
<rect x="1" y="22" width="1" height="1" fill="#1c1f26" />
<rect x="2" y="22" width="1" height="1" fill="#9aa3ae" />
<rect x="3" y="22" width="1" height="1" fill="#9aa3ae" />
<rect x="4" y="22" width="1" height="1" fill="#9aa3ae" />
<rect x="5" y="22" width="1" height="1" fill="#9aa3ae" />
<rect x="6" y="22" width="1" height="1" fill="#9aa3ae" />
<rect x="7" y="22" width="1" height="1" fill="#5b6470" />
<rect x="8" y="22" width="1" height="1" fill="#9aa3ae" />
<rect x="9" y="22" width="1" height="1" fill="#9aa3ae" />
<rect x="10" y="22" width="1" height="1" fill="#9aa3ae" />
<rect x="11" y="22" width="1" height="1" fill="#9aa3ae" />
<rect x="12" y="22" width="1" height="1" fill="#9aa3ae" />
<rect x="13" y="22" width="1" height="1" fill="#9aa3ae" />
<rect x="14" y="22" width="1" height="1" fill="#9aa3ae" />
<rect x="15" y="22" width="1" height="1" fill="#9aa3ae" />
<rect x="16" y="22" width="1" height="1" fill="#9aa3ae" />
<rect x="17" y="22" width="1" height="1" fill="#9aa3ae" />
<rect x="18" y="22" width="1" height="1" fill="#5b6470" />
<rect x="19" y="22" width="1" height="1" fill="#9aa3ae" />
<rect x="20" y="22" width="1" height="1" fill="#9aa3ae" />
<rect x="21" y="22" width="1" height="1" fill="#9aa3ae" />
<rect x="22" y="22" width="1" height="1" fill="#9aa3ae" />
<rect x="23" y="22" width="1" height="1" fill="#9aa3ae" />
<rect x="24" y="22" width="1" height="1" fill="#1c1f26" />
<rect x="1" y="23" width="1" height="1" fill="#1c1f26" />
<rect x="2" y="23" width="1" height="1" fill="#9aa3ae" />
<rect x="3" y="23" width="1" height="1" fill="#9aa3ae" />
<rect x="4" y="23" width="1" height="1" fill="#9aa3ae" />
<rect x="5" y="23" width="1" height="1" fill="#9aa3ae" />
<rect x="6" y="23" width="1" height="1" fill="#9aa3ae" />
<rect x="7" y="23" width="1" height="1" fill="#5b6470" />
<rect x="8" y="23" width="1" height="1" fill="#9aa3ae" />
<rect x="9" y="23" width="1" height="1" fill="#9aa3ae" />
<rect x="10" y="23" width="1" height="1" fill="#9aa3ae" />
<rect x="11" y="23" width="1" height="1" fill="#9aa3ae" />
<rect x="12" y="23" width="1" height="1" fill="#9aa3ae" />
<rect x="13" y="23" width="1" height="1" fill="#9aa3ae" />
<rect x="14" y="23" width="1" height="1" fill="#9aa3ae" />
<rect x="15" y="23" width="1" height="1" fill="#9aa3ae" />
<rect x="16" y="23" width="1" height="1" fill="#9aa3ae" />
<rect x="17" y="23" width="1" height="1" fill="#9aa3ae" />
<rect x="18" y="23" width="1" height="1" fill="#5b6470" />
<rect x="19" y="23" width="1" height="1" fill="#9aa3ae" />
<rect x="20" y="23" width="1" height="1" fill="#9aa3ae" />
<rect x="21" y="23" width="1" height="1" fill="#9aa3ae" />
<rect x="22" y="23" width="1" height="1" fill="#9aa3ae" />
<rect x="23" y="23" width="1" height="1" fill="#9aa3ae" />
<rect x="24" y="23" width="1" height="1" fill="#1c1f26" />
<rect x="1" y="24" width="1" height="1" fill="#1c1f26" />
<rect x="2" y="24" width="1" height="1" fill="#9aa3ae" />
<rect x="3" y="24" width="1" height="1" fill="#9aa3ae" />
<rect x="4" y="24" width="1" height="1" fill="#9aa3ae" />
<rect x="5" y="24" width="1" height="1" fill="#9aa3ae" />
<rect x="6" y="24" width="1" height="1" fill="#9aa3ae" />
<rect x="7" y="24" width="1" height="1" fill="#9aa3ae" />
<rect x="8" y="24" width="1" height="1" fill="#9aa3ae" />
<rect x="9" y="24" width="1" height="1" fill="#9aa3ae" />
<rect x="10" y="24" width="1" height="1" fill="#9aa3ae" />
<rect x="11" y="24" width="1" height="1" fill="#9aa3ae" />
<rect x="12" y="24" width="1" height="1" fill="#9aa3ae" />
<rect x="13" y="24" width="1" height="1" fill="#9aa3ae" />
<rect x="14" y="24" width="1" height="1" fill="#9aa3ae" />
<rect x="15" y="24" width="1" height="1" fill="#9aa3ae" />
<rect x="16" y="24" width="1" height="1" fill="#9aa3ae" />
<rect x="17" y="24" width="1" height="1" fill="#9aa3ae" />
<rect x="18" y="24" width="1" height="1" fill="#9aa3ae" />
<rect x="19" y="24" width="1" height="1" fill="#9aa3ae" />
<rect x="20" y="24" width="1" height="1" fill="#9aa3ae" />
<rect x="21" y="24" width="1" height="1" fill="#9aa3ae" />
<rect x="22" y="24" width="1" height="1" fill="#9aa3ae" />
<rect x="23" y="24" width="1" height="1" fill="#9aa3ae" />
<rect x="24" y="24" width="1" height="1" fill="#1c1f26" />
<rect x="1" y="25" width="1" height="1" fill="#1c1f26" />
<rect x="2" y="25" width="1" height="1" fill="#9aa3ae" />
<rect x="3" y="25" width="1" height="1" fill="#5b6470" />
<rect x="4" y="25" width="1" height="1" fill="#5b6470" />
<rect x="5" y="25" width="1" height="1" fill="#9aa3ae" />
<rect x="6" y="25" width="1" height="1" fill="#9aa3ae" />
<rect x="7" y="25" width="1" height="1" fill="#9aa3ae" />
<rect x="8" y="25" width="1" height="1" fill="#9aa3ae" />
<rect x="9" y="25" width="1" height="1" fill="#9aa3ae" />
<rect x="10" y="25" width="1" height="1" fill="#9aa3ae" />
<rect x="11" y="25" width="1" height="1" fill="#9aa3ae" />
<rect x="12" y="25" width="1" height="1" fill="#9aa3ae" />
<rect x="13" y="25" width="1" height="1" fill="#9aa3ae" />
<rect x="14" y="25" width="1" height="1" fill="#9aa3ae" />
<rect x="15" y="25" width="1" height="1" fill="#9aa3ae" />
<rect x="16" y="25" width="1" height="1" fill="#9aa3ae" />
<rect x="17" y="25" width="1" height="1" fill="#9aa3ae" />
<rect x="18" y="25" width="1" height="1" fill="#9aa3ae" />
<rect x="19" y="25" width="1" height="1" fill="#9aa3ae" />
<rect x="20" y="25" width="1" height="1" fill="#9aa3ae" />
<rect x="21" y="25" width="1" height="1" fill="#5b6470" />
<rect x="22" y="25" width="1" height="1" fill="#5b6470" />
<rect x="23" y="25" width="1" height="1" fill="#9aa3ae" />
<rect x="24" y="25" width="1" height="1" fill="#1c1f26" />
<rect x="2" y="26" width="1" height="1" fill="#1c1f26" />
<rect x="3" y="26" width="1" height="1" fill="#5b6470" />
<rect x="4" y="26" width="1" height="1" fill="#5b6470" />
<rect x="5" y="26" width="1" height="1" fill="#5b6470" />
<rect x="6" y="26" width="1" height="1" fill="#9aa3ae" />
<rect x="7" y="26" width="1" height="1" fill="#9aa3ae" />
<rect x="8" y="26" width="1" height="1" fill="#9aa3ae" />
<rect x="9" y="26" width="1" height="1" fill="#9aa3ae" />
<rect x="10" y="26" width="1" height="1" fill="#9aa3ae" />
<rect x="11" y="26" width="1" height="1" fill="#9aa3ae" />
<rect x="12" y="26" width="1" height="1" fill="#9aa3ae" />
<rect x="13" y="26" width="1" height="1" fill="#9aa3ae" />
<rect x="14" y="26" width="1" height="1" fill="#9aa3ae" />
<rect x="15" y="26" width="1" height="1" fill="#9aa3ae" />
<rect x="16" y="26" width="1" height="1" fill="#9aa3ae" />
<rect x="17" y="26" width="1" height="1" fill="#9aa3ae" />
<rect x="18" y="26" width="1" height="1" fill="#9aa3ae" />
<rect x="19" y="26" width="1" height="1" fill="#9aa3ae" />
<rect x="20" y="26" width="1" height="1" fill="#5b6470" />
<rect x="21" y="26" width="1" height="1" fill="#5b6470" />
<rect x="22" y="26" width="1" height="1" fill="#5b6470" />
<rect x="23" y="26" width="1" height="1" fill="#1c1f26" />
<rect x="3" y="27" width="1" height="1" fill="#1c1f26" />
<rect x="4" y="27" width="1" height="1" fill="#1c1f26" />
<rect x="5" y="27" width="1" height="1" fill="#1c1f26" />
<rect x="6" y="27" width="1" height="1" fill="#5b6470" />
<rect x="7" y="27" width="1" height="1" fill="#5b6470" />
<rect x="8" y="27" width="1" height="1" fill="#5b6470" />
<rect x="9" y="27" width="1" height="1" fill="#1c1f26" />
<rect x="10" y="27" width="1" height="1" fill="#1c1f26" />
<rect x="11" y="27" width="1" height="1" fill="#1c1f26" />
<rect x="12" y="27" width="1" height="1" fill="#1c1f26" />
<rect x="13" y="27" width="1" height="1" fill="#1c1f26" />
<rect x="14" y="27" width="1" height="1" fill="#1c1f26" />
<rect x="15" y="27" width="1" height="1" fill="#1c1f26" />
<rect x="16" y="27" width="1" height="1" fill="#1c1f26" />
<rect x="17" y="27" width="1" height="1" fill="#5b6470" />
<rect x="18" y="27" width="1" height="1" fill="#5b6470" />
<rect x="19" y="27" width="1" height="1" fill="#5b6470" />
<rect x="20" y="27" width="1" height="1" fill="#1c1f26" />
<rect x="21" y="27" width="1" height="1" fill="#1c1f26" />
<rect x="22" y="27" width="1" height="1" fill="#1c1f26" />
<rect x="6" y="28" width="1" height="1" fill="#1c1f26" />
<rect x="7" y="28" width="1" height="1" fill="#1c1f26" />
<rect x="8" y="28" width="1" height="1" fill="#1c1f26" />
<rect x="17" y="28" width="1" height="1" fill="#1c1f26" />
<rect x="18" y="28" width="1" height="1" fill="#1c1f26" />
<rect x="19" y="28" width="1" height="1" fill="#1c1f26" />
`,
    eyesOpen: `<rect x="4" y="11" width="2" height="2" fill="#ffffff" />
<rect x="20" y="11" width="2" height="2" fill="#ffffff" />`,
    eyesClosed: `<rect x="3" y="12" width="4" height="1" fill="#1c1f26" />
<rect x="19" y="12" width="4" height="1" fill="#1c1f26" />`,
    eyesHappy: `<rect x="4" y="11" width="2" height="1" fill="#ffffff" />
<rect x="20" y="11" width="2" height="1" fill="#ffffff" />
<rect x="2" y="13" width="2" height="1" fill="#ff7b7b" />
<rect x="22" y="13" width="2" height="1" fill="#ff7b7b" />`,
    shades: `<rect x="2" y="10" width="8" height="3" fill="#1c1f26" />
<rect x="18" y="10" width="8" height="3" fill="#1c1f26" />
<rect x="10" y="11" width="8" height="1" fill="#1c1f26" />
<rect x="4" y="11" width="2" height="1" fill="#69d2ff" />
<rect x="20" y="11" width="2" height="1" fill="#69d2ff" />`,
    scarf: `<rect x="3" y="19" width="20" height="2" fill="#d64545" />
<rect x="4" y="21" width="3" height="1" fill="#b23737" />
<rect x="4" y="22" width="2" height="2" fill="#d64545" />`,
    crown: `<rect x="10" y="3" width="1" height="3" fill="#f5c542" />
<rect x="13" y="2" width="1" height="4" fill="#f5c542" />
<rect x="16" y="3" width="1" height="3" fill="#f5c542" />
<rect x="9" y="5" width="9" height="1" fill="#e0a92e" />
<rect x="13" y="1" width="1" height="1" fill="#fff1b8" />`
  };

  // src/pet/engine.js
  function initPet(shadowRoot2, initialState, callbacks) {
    let doc = shadowRoot2;
    let wrap = doc.getElementById("petWrap");
    let pet = doc.getElementById("pet");
    let bubble = doc.getElementById("bubble");
    let bubbleText = doc.getElementById("bubbleText");
    let followUpForm = doc.getElementById("followUpForm");
    let followUpInput = doc.getElementById("followUpInput");
    let xpFill = doc.getElementById("xpFill");
    let xpLabel = doc.getElementById("xpLabel");
    let toast = doc.getElementById("toast");
    let frontSvg = doc.getElementById("frontSvg");
    let bubbleClose = doc.getElementById("bubbleClose");
    if (bubbleClose) bubbleClose.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      bubble.classList.remove("show");
      if (followUpForm) followUpForm.style.display = "none";
    });
    let sideS = doc.getElementById("sideSprite");
    if (sideS) sideS.remove();
    let sleepS = doc.getElementById("sleepSprite");
    if (sleepS) sleepS.remove();
    let dangleS = doc.getElementById("dangleSprite");
    if (dangleS) dangleS.remove();
    if (!frontSvg) return null;
    let petName = initialState.petName || "Bandit";
    let xp = initialState.xp || 0;
    let level = initialState.level || 1;
    let settingsSize = initialState.settingsSize || 1;
    let isDragging = false;
    let startX = 0, startY = 0, initialLeft = 0, initialTop = 0;
    let petLeft = initialState.position?.x ?? window.innerWidth - 180;
    let petTop = initialState.position?.y ?? window.innerHeight - 180;
    let hasMoved = false;
    let activityTimer = null;
    let sleepMode = false;
    let accessories = { shades: false, scarf: false, crown: false };
    function setSafeSvg(element, htmlString) {
      const parser = new DOMParser();
      const doc2 = parser.parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${htmlString}</svg>`, "image/svg+xml");
      element.replaceChildren();
      while (doc2.documentElement.firstChild) {
        element.appendChild(doc2.documentElement.firstChild);
      }
    }
    function renderSprite() {
      let html = BANDIT_SPRITES.body + BANDIT_SPRITES.tail;
      if (accessories.shades) html += BANDIT_SPRITES.shades;
      else html += BANDIT_SPRITES.eyesOpen;
      html += BANDIT_SPRITES.ears;
      if (accessories.scarf) html += BANDIT_SPRITES.scarf;
      if (accessories.crown) html += BANDIT_SPRITES.crown;
      setSafeSvg(frontSvg, `
      <g class="tail">${BANDIT_SPRITES.tail}</g>
      <g class="body-group">
        ${BANDIT_SPRITES.body}
        ${accessories.shades ? BANDIT_SPRITES.shades : BANDIT_SPRITES.eyesOpen}
        <g class="ears">${BANDIT_SPRITES.ears}</g>
        ${accessories.scarf ? BANDIT_SPRITES.scarf : ""}
        ${accessories.crown ? BANDIT_SPRITES.crown : ""}
      </g>
    `);
    }
    function applyAccessories(lv) {
      accessories = { shades: lv >= 2, scarf: lv >= 3, crown: lv >= 4 };
      renderSprite();
    }
    applyAccessories(level);
    function clampPosition() {
      const maxX = window.innerWidth - 60;
      const maxY = window.innerHeight - 60;
      petLeft = Math.max(-20, Math.min(petLeft, maxX));
      petTop = Math.max(-20, Math.min(petTop, maxY));
    }
    let cachedPetCenterX = 0;
    function updatePosition() {
      if (!wrap) return;
      wrap.style.left = petLeft + "px";
      wrap.style.top = petTop + "px";
      wrap.style.bottom = "auto";
      wrap.style.right = "auto";
      if (petLeft > window.innerWidth / 2) {
        wrap.classList.add("menu-left");
      } else {
        wrap.classList.remove("menu-left");
      }
      const rect = wrap.getBoundingClientRect();
      cachedPetCenterX = rect.left + rect.width / 2;
    }
    clampPosition();
    updatePosition();
    if (wrap) wrap.style.setProperty("--pet-scale", settingsSize);
    function pokeActivity() {
      if (sleepMode) wakeUp();
      clearTimeout(activityTimer);
      activityTimer = setTimeout(fallAsleep, 6e4);
    }
    function wakeUp() {
      if (!sleepMode) return;
      sleepMode = false;
      wrap.classList.remove("sleeping");
      const bodyG = frontSvg.querySelector(".body-group");
      if (bodyG) {
        setSafeSvg(bodyG, `
        ${BANDIT_SPRITES.body}
        ${accessories.shades ? BANDIT_SPRITES.shades : BANDIT_SPRITES.eyesOpen}
        <g class="ears">${BANDIT_SPRITES.ears}</g>
        ${accessories.scarf ? BANDIT_SPRITES.scarf : ""}
        ${accessories.crown ? BANDIT_SPRITES.crown : ""}
      `);
      }
      say("*yawns*");
    }
    function fallAsleep() {
      if (isDragging || sleepMode) return;
      sleepMode = true;
      wrap.className = "pet-wrap sleeping";
      wrap.classList.toggle("menu-left", petLeft > window.innerWidth / 2);
      const bodyG = frontSvg.querySelector(".body-group");
      if (bodyG) {
        setSafeSvg(bodyG, `
        ${BANDIT_SPRITES.body}
        ${accessories.shades ? BANDIT_SPRITES.shades : BANDIT_SPRITES.eyesClosed}
        <g class="ears">${BANDIT_SPRITES.ears}</g>
        ${accessories.scarf ? BANDIT_SPRITES.scarf : ""}
        ${accessories.crown ? BANDIT_SPRITES.crown : ""}
      `);
      }
    }
    pokeActivity();
    function onDocMouseMove(e) {
      if (sleepMode || isDragging || !wrap) return;
      if (e.clientX < cachedPetCenterX - 20) {
        pet.classList.add("face-left");
      } else if (e.clientX > cachedPetCenterX + 20) {
        pet.classList.remove("face-left");
      }
    }
    document.addEventListener("mousemove", onDocMouseMove, { passive: true });
    function onWindowResize() {
      clampPosition();
      updatePosition();
    }
    window.addEventListener("resize", onWindowResize);
    function renderMessage(container2, text) {
      if (!container2) return;
      container2.textContent = "";
      const parts = String(text || "").split("<br>");
      parts.forEach((part, i) => {
        if (i > 0) container2.appendChild(document.createElement("br"));
        container2.appendChild(document.createTextNode(part));
      });
    }
    let sayTimer = null;
    function say(text, timeoutMs = 4e3) {
      if (!bubble) return;
      if (followUpForm) followUpForm.style.display = "none";
      renderMessage(bubbleText, text);
      bubble.classList.add("show");
      clearTimeout(sayTimer);
      if (timeoutMs > 0) {
        sayTimer = setTimeout(() => bubble.classList.remove("show"), timeoutMs);
      }
    }
    function askForRefinement(promptHtml, onRefine) {
      if (!bubble || !bubbleText || !followUpForm) return;
      clearTimeout(sayTimer);
      renderMessage(bubbleText, promptHtml);
      followUpForm.style.display = "block";
      bubble.classList.add("show");
      followUpInput.value = "";
      followUpInput.focus();
      const onSubmit = (e) => {
        e.preventDefault();
        const val = followUpInput.value.trim();
        followUpForm.style.display = "none";
        bubble.classList.remove("show");
        followUpForm.removeEventListener("submit", onSubmit);
        if (val) onRefine(val);
      };
      followUpForm.addEventListener("submit", onSubmit);
      sayTimer = setTimeout(() => {
        if (document.activeElement !== followUpInput && followUpInput.value.trim() === "") {
          followUpForm.style.display = "none";
          bubble.classList.remove("show");
          followUpForm.removeEventListener("submit", onSubmit);
        }
      }, 4500);
    }
    function showToast(msg) {
      if (!toast) return;
      toast.textContent = msg;
      toast.classList.add("show");
      setTimeout(() => toast.classList.remove("show"), 2e3);
    }
    function updateXPDisplay() {
      if (!xpFill || !xpLabel) return;
      let nextXP = level * 20;
      let pct = Math.min(100, Math.max(0, xp / nextXP * 100));
      xpFill.style.width = pct + "%";
      xpLabel.textContent = `${petName.toUpperCase()} \xB7 `;
      const b = document.createElement("b");
      b.textContent = `LVL ${level}`;
      xpLabel.appendChild(b);
      xpLabel.appendChild(document.createTextNode(` \xB7 ${xp}/${nextXP} XP`));
    }
    function addXP(amount) {
      xp += amount;
      let nextXP = level * 20;
      let leveledUp = false;
      while (xp >= nextXP) {
        xp -= nextXP;
        level++;
        nextXP = level * 20;
        leveledUp = true;
        applyAccessories(level);
      }
      updateXPDisplay();
      callbacks.persist({ xp, level });
      if (leveledUp) {
        say(`<b>LEVEL UP!</b><br>I'm level ${level} now! \u{1F389}`, 5e3);
        wrap.classList.add("levelup");
        setTimeout(() => wrap.classList.remove("levelup"), 1500);
      } else {
        wrap.classList.add("show-xp");
        setTimeout(() => wrap.classList.remove("show-xp"), 2e3);
      }
    }
    updateXPDisplay();
    function onPointerDown(e) {
      if (e.button !== 0 || !wrap) return;
      const target = e.target;
      if (target.tagName === "BUTTON" || target.closest(".radial-menu") || target.closest("#petMenu") || target.closest(".bubble")) {
        if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
          e.preventDefault();
        }
        return;
      }
      isDragging = true;
      hasMoved = false;
      startX = e.clientX;
      startY = e.clientY;
      initialLeft = petLeft;
      initialTop = petTop;
      wrap.classList.add("dragging");
      pokeActivity();
      e.preventDefault();
      wrap.setPointerCapture(e.pointerId);
      wrap.addEventListener("pointermove", onPointerMove);
      wrap.addEventListener("pointerup", onPointerUp);
      wrap.addEventListener("pointercancel", onPointerUp);
    }
    function onPointerMove(e) {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved = true;
      petLeft = initialLeft + dx;
      petTop = initialTop + dy;
      clampPosition();
      updatePosition();
      if (dx < -2) pet.classList.add("face-left");
      else if (dx > 2) pet.classList.remove("face-left");
    }
    function onPointerUp(e) {
      isDragging = false;
      wrap.classList.remove("dragging");
      wrap.removeEventListener("pointermove", onPointerMove);
      wrap.removeEventListener("pointerup", onPointerUp);
      wrap.removeEventListener("pointercancel", onPointerUp);
      try {
        if (wrap.hasPointerCapture(e.pointerId)) {
          wrap.releasePointerCapture(e.pointerId);
        }
      } catch (err) {
      }
      if (hasMoved) {
        callbacks.persist({ position: { x: petLeft, y: petTop } });
        wrap.classList.add("startled");
        const emote = doc.getElementById("startleEmote");
        if (emote) {
          emote.style.display = "block";
          setTimeout(() => emote.style.display = "none", 600);
        }
        setTimeout(() => wrap.classList.remove("startled"), 500);
      } else {
        toggleMenu();
      }
    }
    if (wrap) wrap.addEventListener("pointerdown", onPointerDown);
    let holdTimer = null;
    if (pet) {
      pet.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        holdTimer = setTimeout(() => {
          holdTimer = null;
          pokeActivity();
          wrap.classList.add("spinning");
          setTimeout(() => wrap.classList.remove("spinning"), 700);
          if (Math.random() < 0.3) {
            addXP(2);
            say("Woohoo! Spin trick! \u{1F389}", 2500);
          } else {
            say("*spins!*", 1500);
          }
        }, 600);
      });
      pet.addEventListener("pointerup", () => {
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
        }
      });
      pet.addEventListener("pointercancel", () => {
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
        }
      });
    }
    let petMoveCount = 0;
    let lastPetTime = 0;
    if (pet) {
      pet.addEventListener("mousemove", (e) => {
        if (isDragging || sleepMode) return;
        petMoveCount++;
        if (petMoveCount >= 8) {
          petMoveCount = 0;
          const now = Date.now();
          if (now - lastPetTime < 2e3) return;
          lastPetTime = now;
          pokeActivity();
          addXP(1);
          say("Purrrr~ \u{1F495}", 1500);
          const heart = document.createElement("span");
          heart.textContent = "\u2764\uFE0F";
          heart.className = "heart";
          const r = wrap.getBoundingClientRect();
          heart.style.left = r.left + r.width / 2 - 8 + (Math.random() * 20 - 10) + "px";
          heart.style.top = r.top - 10 + "px";
          const rootEl = shadowRoot2.getElementById("rocky-root") || shadowRoot2;
          rootEl.appendChild(heart);
          setTimeout(() => heart.remove(), 1e3);
        }
      }, { passive: true });
      pet.addEventListener("mouseleave", () => {
        petMoveCount = 0;
      });
    }
    function toggleMenu() {
      pokeActivity();
      if (wrap.classList.contains("show-menu")) {
        wrap.classList.remove("show-menu");
        const m = doc.getElementById("menuExtra");
        const b = doc.getElementById("menuMore");
        if (m && b) {
          m.style.display = "none";
          b.style.display = "block";
        }
      } else {
        wrap.classList.add("show-menu");
      }
    }
    function onDocPointerDown(e) {
      if (!wrap) return;
      if (wrap.classList.contains("show-menu")) {
        const p = e.composedPath();
        if (!p.includes(wrap) && !p.some((el) => el.classList && el.classList.contains("modal-overlay"))) {
          wrap.classList.remove("show-menu");
        }
      }
    }
    document.addEventListener("pointerdown", onDocPointerDown);
    function destroy2() {
      clearTimeout(activityTimer);
      clearTimeout(sayTimer);
      if (holdTimer) clearTimeout(holdTimer);
      document.removeEventListener("mousemove", onDocMouseMove);
      document.removeEventListener("pointerdown", onDocPointerDown);
      window.removeEventListener("resize", onWindowResize);
    }
    return {
      destroy: destroy2,
      updateState: (partial) => {
        if (partial.petName !== void 0) petName = partial.petName;
        if (partial.xp !== void 0) xp = partial.xp;
        if (partial.level !== void 0) {
          level = partial.level;
          applyAccessories(level);
        }
        if (partial.settingsSize !== void 0) {
          settingsSize = partial.settingsSize;
          if (wrap) wrap.style.setProperty("--pet-scale", settingsSize);
        }
        updateXPDisplay();
      },
      say,
      showToast,
      askForRefinement,
      addXP,
      pokeActivity,
      goHome: () => {
        petLeft = window.innerWidth - 180;
        petTop = window.innerHeight - 180;
        updatePosition();
        callbacks.persist({ position: { x: petLeft, y: petTop } });
        wrap.classList.add("hopping");
        setTimeout(() => wrap.classList.remove("hopping"), 600);
      },
      playAnimation: (className, ms) => {
        pokeActivity();
        wrap.classList.add(className);
        setTimeout(() => wrap.classList.remove(className), ms);
      },
      feed: () => {
        pokeActivity();
        const apple = document.createElement("div");
        apple.className = "fetch-apple";
        apple.textContent = "\u{1F34E}";
        const r = wrap.getBoundingClientRect();
        apple.style.left = r.left + r.width / 2 - 12 + "px";
        apple.style.top = r.top + r.height / 2 - 12 + "px";
        const rootEl = shadowRoot2.getElementById("rocky-root") || shadowRoot2;
        rootEl.appendChild(apple);
        say("Nom nom nom! \u{1F34E}", 2e3);
        wrap.classList.add("happy");
        setTimeout(() => {
          apple.remove();
          wrap.classList.remove("happy");
          addXP(5);
        }, 1e3);
      }
    };
  }

  // src/scraper.js
  function scrapeConversation() {
    const host = window.location.hostname;
    let text = "";
    try {
      if (host.includes("chatgpt.com") || host.includes("chat.openai.com")) {
        text = scrapeChatGPT();
      } else if (host.includes("claude.ai")) {
        text = scrapeClaude();
      } else if (host.includes("gemini.google.com")) {
        text = scrapeGemini();
      } else {
        text = scrapeGeneric();
      }
    } catch (err) {
      console.warn("Bandit scraper failed for " + host, err);
    }
    return text || scrapeGeneric();
  }
  function cleanMessageText(text) {
    if (!text) return "";
    return text.split("\n").filter((line) => {
      const trimmed = line.trim();
      return trimmed !== "Copy code" && trimmed !== "Copy" && trimmed !== "Copied!";
    }).join("\n").trim();
  }
  function scrapeChatGPT() {
    const parts = [];
    const articles = document.querySelectorAll("article[data-message-author-role]");
    if (articles.length) {
      for (const msg of articles) {
        const role = msg.getAttribute("data-message-author-role");
        const content = msg.querySelector(".markdown, .whitespace-pre-wrap, .text-message");
        if (role && content) {
          const cleaned = cleanMessageText(content.innerText);
          if (cleaned) parts.push(`[${role.toUpperCase()}]
${cleaned}`);
        }
      }
      return parts.join("\n\n");
    }
    const divMsgs = document.querySelectorAll("div[data-message-author-role]");
    if (divMsgs.length) {
      for (const msg of divMsgs) {
        const role = msg.getAttribute("data-message-author-role");
        const cleaned = cleanMessageText(msg.innerText);
        if (cleaned) parts.push(`[${role.toUpperCase()}]
${cleaned}`);
      }
      return parts.join("\n\n");
    }
    const turns = document.querySelectorAll('[data-testid^="conversation-turn-"]');
    if (turns.length) {
      for (const turn of turns) {
        const isUser = turn.querySelector('[data-message-author-role="user"]');
        const role = isUser ? "USER" : "ASSISTANT";
        const content = turn.querySelector(".markdown, .whitespace-pre-wrap, .text-message");
        if (content) {
          parts.push(`[${role}]
${content.innerText}`);
        }
      }
      return parts.join("\n\n");
    }
    return "";
  }
  function scrapeClaude() {
    const parts = [];
    const container2 = document.querySelector(".flex-1.flex.flex-col.gap-3, .flex-1.flex.flex-col.items-center");
    if (container2) {
      const children = container2.querySelectorAll(".font-user-message, .font-claude-message");
      for (const child of children) {
        const role = child.classList.contains("font-user-message") ? "USER" : "CLAUDE";
        parts.push(`[${role}]
${child.innerText}`);
      }
      return parts.join("\n\n");
    }
    const userMsgs = document.querySelectorAll(".font-user-message");
    const claudeMsgs = document.querySelectorAll(".font-claude-message");
    for (const m of userMsgs) parts.push(`[USER]
${m.innerText}`);
    for (const m of claudeMsgs) parts.push(`[CLAUDE]
${m.innerText}`);
    return parts.join("\n\n");
  }
  function scrapeGemini() {
    const parts = [];
    const allNodes = document.querySelectorAll("user-query, model-response, query-content, message-content");
    if (allNodes.length) {
      for (const node of allNodes) {
        const tag = node.tagName.toLowerCase();
        const role = tag === "user-query" || tag === "query-content" ? "USER" : "GEMINI";
        const text = node.innerText?.trim();
        if (text) parts.push(`[${role}]
${text}`);
      }
      return parts.join("\n\n");
    }
    const turns = document.querySelectorAll(".conversation-container .turn-content, .chat-turn");
    if (turns.length) {
      for (const turn of turns) {
        const isUser = turn.classList.contains("user-turn") || turn.querySelector(".query-content, user-query");
        const role = isUser ? "USER" : "GEMINI";
        parts.push(`[${role}]
${turn.innerText}`);
      }
      return parts.join("\n\n");
    }
    return "";
  }
  function scrapeGeneric() {
    const main = document.querySelector("main") || document.body;
    const pText = Array.from(main.querySelectorAll("p")).map((p) => p.innerText.trim()).filter((t) => t.length > 20);
    return pText.join("\n\n");
  }

  // src/ui/templates.js
  var BUILTIN_TEMPLATES = [
    // --- WRITING (8) ---
    {
      id: "writing-blog-intro",
      category: "writing",
      categoryLabel: "\u270D\uFE0F Writing",
      name: "Catchy Blog Post Intro",
      description: "Hook readers instantly with a compelling opening paragraph.",
      template: "Write a compelling, magnetic blog post introduction about {{topic}} for {{audience}}. Hook the reader in the first sentence, establish why this matters right now, and set up the article with a {{tone}} tone.",
      variables: [
        { key: "topic", label: "Blog Topic", placeholder: "e.g. Remote work productivity & avoiding burnout" },
        { key: "audience", label: "Target Audience", placeholder: "e.g. Software engineers & startup teams" },
        { key: "tone", label: "Tone", placeholder: "e.g. Relatable, energetic, and practical" }
      ],
      tags: ["blog", "intro", "hook", "writing"]
    },
    {
      id: "writing-email-draft",
      category: "writing",
      categoryLabel: "\u270D\uFE0F Writing",
      name: "Professional Business Email",
      description: "Draft a polite, concise, and persuasive email for any situation.",
      template: "Draft a professional, clear, and courteous email to {{recipient}} regarding {{purpose}}. Key points to mention: {{keyPoints}}. End with this clear call-to-action: {{callToAction}}.",
      variables: [
        { key: "recipient", label: "Recipient", placeholder: "e.g. Prospective client or team manager" },
        { key: "purpose", label: "Purpose of Email", placeholder: "e.g. Following up after yesterday demo meeting" },
        { key: "keyPoints", label: "Key Points to Cover", placeholder: "e.g. Timeline proposal, pricing tier options" },
        { key: "callToAction", label: "Call to Action", placeholder: "e.g. Confirm availability for a 15-min call on Thursday" }
      ],
      tags: ["email", "business", "communication", "work"]
    },
    {
      id: "writing-product-desc",
      category: "writing",
      categoryLabel: "\u270D\uFE0F Writing",
      name: "Product Description & Benefits",
      description: "Turn feature bullet points into high-converting sales copy.",
      template: "Write high-converting product copy for {{productName}}, designed for {{targetCustomer}}. Highlight these core features: {{keyFeatures}}. Focus heavily on customer benefits, emotional payoff, and overcoming objections.",
      variables: [
        { key: "productName", label: "Product Name", placeholder: "e.g. UltraGrip Ergonomic Mouse" },
        { key: "targetCustomer", label: "Target Customer", placeholder: "e.g. Designers working 8+ hours a day" },
        { key: "keyFeatures", label: "Key Features", placeholder: "e.g. 57-degree natural angle, silent clicks, 70-day battery" }
      ],
      tags: ["marketing", "sales", "product", "ecommerce"]
    },
    {
      id: "writing-social-post",
      category: "writing",
      categoryLabel: "\u270D\uFE0F Writing",
      name: "Viral Social Media Post",
      description: "Format high-engagement posts with hooks and hashtags.",
      template: "Create an engaging {{platform}} post about {{topic}}. Include a bold opening hook line, bulleted insights on {{mainTakeaway}}, relevant hashtags, and an open-ended question to spark comments.",
      variables: [
        { key: "platform", label: "Platform", placeholder: "e.g. LinkedIn, Twitter / X, or Threads" },
        { key: "topic", label: "Topic / Story", placeholder: "e.g. Lessons learned from launching my first product" },
        { key: "mainTakeaway", label: "Main Takeaway", placeholder: "e.g. Talk to 10 customers before writing any code" }
      ],
      tags: ["social", "linkedin", "twitter", "content"]
    },
    {
      id: "writing-essay-outline",
      category: "writing",
      categoryLabel: "\u270D\uFE0F Writing",
      name: "Comprehensive Essay Outline",
      description: "Structure academic or opinion essays with clear arguments.",
      template: 'Generate a structured outline for an essay on "{{essayTopic}}". Central thesis: {{thesisIdea}}. Include: Introduction with hook & thesis statement, 3-4 body sections with evidence/sub-arguments, counter-argument & rebuttal, and a strong conclusion.',
      variables: [
        { key: "essayTopic", label: "Essay Topic", placeholder: "e.g. The impact of AI on creative professions" },
        { key: "thesisIdea", label: "Thesis or Stance", placeholder: "e.g. AI empowers artists as a tool rather than replacing them" }
      ],
      tags: ["essay", "academic", "outline", "school"]
    },
    {
      id: "writing-headline-gen",
      category: "writing",
      categoryLabel: "\u270D\uFE0F Writing",
      name: "10 Catchy Headlines",
      description: "Brainstorm irresistible titles for articles, videos, or newsletters.",
      template: "Generate 10 compelling, click-worthy headlines for content about {{topic}}. Target audience: {{audience}}. Provide a mix of styles: how-to, question-based, listicle, contrarian, and benefit-driven.",
      variables: [
        { key: "topic", label: "Content Topic", placeholder: "e.g. Mastering keyboard shortcuts in VS Code" },
        { key: "audience", label: "Target Audience", placeholder: "e.g. Junior web developers" }
      ],
      tags: ["headlines", "titles", "clickbait", "marketing"]
    },
    {
      id: "writing-story-hook",
      category: "writing",
      categoryLabel: "\u270D\uFE0F Writing",
      name: "Fiction Story Opening Scene",
      description: "Set up an evocative scene with sensory details and tension.",
      template: "Write the opening scene for a {{genre}} story featuring {{protagonist}}. The scene begins right as {{incitingIncident}} occurs. Use vivid sensory details, establish atmospheric tension, and avoid exposition dumps.",
      variables: [
        { key: "genre", label: "Genre", placeholder: "e.g. Cyberpunk mystery, Dark fantasy, Sci-fi thriller" },
        { key: "protagonist", label: "Protagonist", placeholder: "e.g. An insomniac air-traffic controller" },
        { key: "incitingIncident", label: "Inciting Incident", placeholder: "e.g. An unidentified beacon signals from the abandoned station" }
      ],
      tags: ["story", "fiction", "creative", "novel"]
    },
    {
      id: "writing-tech-docs",
      category: "writing",
      categoryLabel: "\u270D\uFE0F Writing",
      name: "Technical Documentation Guide",
      description: "Write developer documentation with setup steps and examples.",
      template: "Write developer documentation for {{featureName}}. Outline prerequisites, a step-by-step setup walkthrough for {{targetEnvironment}}, copy-pasteable code examples, and common troubleshooting tips.",
      variables: [
        { key: "featureName", label: "Feature / Library", placeholder: "e.g. User Authentication with JWT in Node.js" },
        { key: "targetEnvironment", label: "Environment / Stack", placeholder: "e.g. Express.js and PostgreSQL" }
      ],
      tags: ["docs", "developer", "technical", "guide"]
    },
    // --- CODING (7) ---
    {
      id: "code-review",
      category: "coding",
      categoryLabel: "\u{1F4BB} Coding",
      name: "Code Review & Security Audit",
      description: "Identify bugs, performance bottlenecks, and security flaws.",
      template: "Perform a senior-level code review for this {{language}} code:\n\n```\n{{codeSnippet}}\n```\n\nAnalyze for: 1) Logic bugs and edge cases, 2) Security vulnerabilities, 3) Performance and memory leaks, 4) Clean code & idiomatic style. Provide concrete code diffs for all suggested fixes.",
      variables: [
        { key: "language", label: "Programming Language", placeholder: "e.g. TypeScript, Python, Go" },
        { key: "codeSnippet", label: "Code to Review", placeholder: "Paste your code here..." }
      ],
      tags: ["code", "review", "security", "audit"]
    },
    {
      id: "code-refactor",
      category: "coding",
      categoryLabel: "\u{1F4BB} Coding",
      name: "Refactor & Clean Architecture",
      description: "Modernize messy or legacy code for readability and DRY principles.",
      template: "Refactor this {{language}} code to adhere to clean code principles, DRY architecture, and modern best practices:\n\n```\n{{codeSnippet}}\n```\n\nExplain what you simplified and why.",
      variables: [
        { key: "language", label: "Language", placeholder: "e.g. JavaScript / React" },
        { key: "codeSnippet", label: "Code Snippet", placeholder: "Paste code to refactor..." }
      ],
      tags: ["refactor", "clean-code", "dry"]
    },
    {
      id: "code-debug",
      category: "coding",
      categoryLabel: "\u{1F4BB} Coding",
      name: "Bug Diagnoser & Fixer",
      description: "Find why an error is occurring and get an instant fix.",
      template: "I am getting this error in {{language}}:\n\nError Message:\n{{errorMessage}}\n\nRelevant Code:\n```\n{{codeSnippet}}\n```\n\nExplain the exact root cause of the bug and show the corrected code.",
      variables: [
        { key: "language", label: "Language / Framework", placeholder: "e.g. Next.js / Python" },
        { key: "errorMessage", label: "Error Message", placeholder: "e.g. TypeError: Cannot read properties of undefined" },
        { key: "codeSnippet", label: "Code Snippet", placeholder: "Paste the broken code..." }
      ],
      tags: ["debug", "bug", "error", "fix"]
    },
    {
      id: "code-explain",
      category: "coding",
      categoryLabel: "\u{1F4BB} Coding",
      name: "Explain Code (ELI5)",
      description: "Break down complex algorithms or regex into plain English.",
      template: "Explain how this {{language}} code works step-by-step in plain, beginner-friendly English. Use simple analogies where helpful:\n\n```\n{{codeSnippet}}\n```",
      variables: [
        { key: "language", label: "Language / Tool", placeholder: "e.g. SQL, Regex, Rust" },
        { key: "codeSnippet", label: "Code to Explain", placeholder: "Paste complex code here..." }
      ],
      tags: ["explain", "learn", "beginner"]
    },
    {
      id: "code-unit-tests",
      category: "coding",
      categoryLabel: "\u{1F4BB} Coding",
      name: "Write Unit Tests (TDD)",
      description: "Generate unit tests covering happy paths, edge cases, and errors.",
      template: "Write comprehensive unit tests using {{testFramework}} for this {{language}} function/component:\n\n```\n{{codeSnippet}}\n```\n\nCover standard happy paths, edge cases (empty, null, overflow), and expected error throws.",
      variables: [
        { key: "testFramework", label: "Testing Framework", placeholder: "e.g. Jest, Vitest, PyTest" },
        { key: "language", label: "Language", placeholder: "e.g. TypeScript" },
        { key: "codeSnippet", label: "Function to Test", placeholder: "Paste function code..." }
      ],
      tags: ["tests", "tdd", "jest", "unit-test"]
    },
    {
      id: "code-api-design",
      category: "coding",
      categoryLabel: "\u{1F4BB} Coding",
      name: "REST / GraphQL API Spec",
      description: "Design production-grade API endpoints with schemas and errors.",
      template: "Design a clean, RESTful API contract for managing {{resourceName}}. Include: 1) Endpoints (GET, POST, PUT, DELETE), 2) Request payloads with validation rules, 3) Response JSON schemas with status codes, 4) Standard error response format.",
      variables: [
        { key: "resourceName", label: "Resource / Domain", placeholder: "e.g. User subscription billing and invoices" }
      ],
      tags: ["api", "rest", "backend", "schema"]
    },
    {
      id: "code-regex-helper",
      category: "coding",
      categoryLabel: "\u{1F4BB} Coding",
      name: "Regex Generator & Explainer",
      description: "Create bulletproof regular expressions with breakdown.",
      template: "Create a regular expression in {{flavor}} that matches: {{patternRequirement}}.\nProvide: 1) The exact regex string, 2) Test cases that should match, 3) Test cases that should fail, 4) A breakdown of every token.",
      variables: [
        { key: "flavor", label: "Regex Flavor", placeholder: "e.g. JavaScript, Python, PCRE" },
        { key: "patternRequirement", label: "What to Match", placeholder: "e.g. Valid international phone numbers with optional country codes" }
      ],
      tags: ["regex", "pattern", "parsing"]
    },
    // --- BUSINESS (6) ---
    {
      id: "biz-meeting-agenda",
      category: "business",
      categoryLabel: "\u{1F4BC} Business",
      name: "Productive Meeting Agenda",
      description: "Structure meetings with goals, time blocks, and owners.",
      template: 'Create a focused, productive meeting agenda for a {{meetingDuration}} meeting about "{{meetingTopic}}". Attendees: {{attendees}}. Goal: {{desiredOutcome}}. Include time allocations for each topic and an action item assignment section.',
      variables: [
        { key: "meetingTopic", label: "Meeting Topic", placeholder: "e.g. Q3 Product Roadmap & Prioritization" },
        { key: "meetingDuration", label: "Duration", placeholder: "e.g. 45 minutes" },
        { key: "attendees", label: "Attendees / Teams", placeholder: "e.g. Product, Engineering, and Design leads" },
        { key: "desiredOutcome", label: "Desired Outcome", placeholder: "e.g. Agreement on top 3 features to build next sprint" }
      ],
      tags: ["meeting", "agenda", "work", "productivity"]
    },
    {
      id: "biz-proposal",
      category: "business",
      categoryLabel: "\u{1F4BC} Business",
      name: "Project Proposal Spec",
      description: "Pitch initiatives with problem statement, timeline, and ROI.",
      template: 'Write a persuasive project proposal for "{{projectName}}".\nProblem statement: {{problemSolved}}.\nProposed solution: {{solutionOverview}}.\nExpected impact/ROI: {{expectedOutcome}}.\nInclude: Executive Summary, Objectives, Implementation Phases, Resource Estimates, and Success Metrics.',
      variables: [
        { key: "projectName", label: "Project Name", placeholder: "e.g. Customer Support AI Assistant" },
        { key: "problemSolved", label: "Problem Being Solved", placeholder: "e.g. Ticket response times currently average 14 hours" },
        { key: "solutionOverview", label: "Solution Overview", placeholder: "e.g. Automated tiered triage bot answering top 40 FAQs" },
        { key: "expectedOutcome", label: "Expected Impact", placeholder: "e.g. 60% reduction in response time, saving $40k/yr" }
      ],
      tags: ["proposal", "project", "pitch", "executive"]
    },
    {
      id: "biz-swot",
      category: "business",
      categoryLabel: "\u{1F4BC} Business",
      name: "SWOT Analysis Matrix",
      description: "Detailed Strengths, Weaknesses, Opportunities, and Threats.",
      template: "Perform an in-depth SWOT analysis for {{businessOrProduct}} in the {{industry}} space. Competitors include {{competitors}}. Break down: Strengths, Weaknesses, Opportunities, and Threats with 4-5 strategic bullet points each, concluding with actionable recommendations.",
      variables: [
        { key: "businessOrProduct", label: "Company / Product", placeholder: "e.g. Boutique specialty coffee subscription" },
        { key: "industry", label: "Industry", placeholder: "e.g. Direct-to-Consumer Food & Beverage" },
        { key: "competitors", label: "Competitors", placeholder: "e.g. Trade Coffee, Blue Bottle" }
      ],
      tags: ["swot", "strategy", "analysis", "business"]
    },
    {
      id: "biz-customer-persona",
      category: "business",
      categoryLabel: "\u{1F4BC} Business",
      name: "Ideal Customer Persona (ICP)",
      description: "Map demographics, pain points, motivations, and triggers.",
      template: "Develop a detailed Ideal Customer Persona for {{productOrService}}. Target demographic: {{targetAudience}}. Include: Profile overview, daily frustrations & pain points, core aspirations, objections to purchasing, and marketing channels they trust.",
      variables: [
        { key: "productOrService", label: "Product / Service", placeholder: "e.g. All-in-one personal budgeting app" },
        { key: "targetAudience", label: "Target Demographic", placeholder: "e.g. Young professionals in their 20s managing student debt" }
      ],
      tags: ["persona", "icp", "marketing", "customer"]
    },
    {
      id: "biz-elevator-pitch",
      category: "business",
      categoryLabel: "\u{1F4BC} Business",
      name: "60-Second Elevator Pitch",
      description: "Memorable, crisp pitch for investors, customers, or partners.",
      template: "Write a sharp, memorable 60-second elevator pitch for {{companyName}}. Problem: {{problemStatement}}. Unique Solution: {{solutionStatement}}. Why now: {{whyNow}}. Make it conversational, punchy, and impossible to forget.",
      variables: [
        { key: "companyName", label: "Company / Project", placeholder: "e.g. FlowState Audio" },
        { key: "problemStatement", label: "The Problem", placeholder: "e.g. 70% of open office workers struggle with noise distractions" },
        { key: "solutionStatement", label: "Unique Solution", placeholder: "e.g. Science-backed generative soundscapes tailored to heart rate" },
        { key: "whyNow", label: "Why Now?", placeholder: "e.g. Hybrid work makes focus tools more critical than ever" }
      ],
      tags: ["pitch", "investor", "startup", "sales"]
    },
    {
      id: "biz-okrs",
      category: "business",
      categoryLabel: "\u{1F4BC} Business",
      name: "Quarterly OKR Framework",
      description: "Formulate inspirational Objectives and measurable Key Results.",
      template: "Draft 3 strategic Objectives and 3-4 measurable Key Results (OKRs) for a {{teamName}} team for {{timeframe}}. Core focus: {{coreFocus}}. Ensure each KR has clear baseline metrics and numerical targets.",
      variables: [
        { key: "teamName", label: "Team / Department", placeholder: "e.g. Growth Marketing or Platform Engineering" },
        { key: "timeframe", label: "Timeframe", placeholder: "e.g. Q4 2026" },
        { key: "coreFocus", label: "Main Strategic Focus", placeholder: "e.g. Accelerate user activation and reduce day-7 churn" }
      ],
      tags: ["okr", "goals", "management", "planning"]
    },
    // --- CREATIVE (5) ---
    {
      id: "creative-character",
      category: "creative",
      categoryLabel: "\u{1F3A8} Creative",
      name: "Character Dossier & Flaws",
      description: "Deep character profile with core desire, fatal flaw, and voice.",
      template: "Create a deep, three-dimensional character profile for a story in the {{genre}} genre. Name: {{characterName}}. Role: {{characterRole}}. Include: Fatal flaw, secret desire, physical tell or quirk, defining backstory event, and how their speech pattern sounds.",
      variables: [
        { key: "characterName", label: "Character Name", placeholder: "e.g. Silas Vance" },
        { key: "characterRole", label: "Role in Story", placeholder: "e.g. Disgraced starship captain turned smuggler" },
        { key: "genre", label: "Genre", placeholder: "e.g. Gritty space western" }
      ],
      tags: ["character", "creative", "writing", "fiction"]
    },
    {
      id: "creative-worldbuilding",
      category: "creative",
      categoryLabel: "\u{1F3A8} Creative",
      name: "Fictional World Building",
      description: "Design unique magic systems, geography, factions, and rules.",
      template: "Flesh out a unique fictional setting named {{worldName}} for a {{genre}} setting. The defining central phenomenon is: {{centralFeature}}. Detail: 1) Physical geography & weather, 2) Social hierarchy & dominant factions, 3) Daily life for ordinary people, 4) Taboos and sacred customs.",
      variables: [
        { key: "worldName", label: "World / City Name", placeholder: "e.g. The Sunken Spire of Aethelgard" },
        { key: "genre", label: "Genre", placeholder: "e.g. Steampunk fantasy" },
        { key: "centralFeature", label: "Unique Central Feature", placeholder: "e.g. Sunlight only falls for three hours each week" }
      ],
      tags: ["worldbuilding", "fantasy", "scifi", "lore"]
    },
    {
      id: "creative-dialogue",
      category: "creative",
      categoryLabel: "\u{1F3A8} Creative",
      name: "Tense Dialogue Scene",
      description: "Write authentic dialogue between two characters with subtext.",
      template: "Write a gripping dialogue scene between {{characterA}} and {{characterB}}. Setting: {{setting}}. Hidden conflict: {{hiddenConflict}}. Focus on subtext \u2014 neither character should say what they truly mean out loud.",
      variables: [
        { key: "characterA", label: "Character A", placeholder: "e.g. A veteran detective" },
        { key: "characterB", label: "Character B", placeholder: "e.g. A politician who owes them a favor" },
        { key: "setting", label: "Setting", placeholder: "e.g. An empty diner at 2 AM in the pouring rain" },
        { key: "hiddenConflict", label: "Subtext / Conflict", placeholder: "e.g. Character A knows Character B leaked the evidence" }
      ],
      tags: ["dialogue", "script", "scene", "drama"]
    },
    {
      id: "creative-poem",
      category: "creative",
      categoryLabel: "\u{1F3A8} Creative",
      name: "Custom Form Poetry",
      description: "Evocative poetry with rich rhythm, imagery, and mood.",
      template: "Write a poem about {{topic}} in the style of {{styleOrForm}}. Mood: {{mood}}. Use striking sensory metaphors, subtle internal rhyme, and an impactful closing line.",
      variables: [
        { key: "topic", label: "Poem Theme / Subject", placeholder: "e.g. Watching fog roll over the city at dawn" },
        { key: "styleOrForm", label: "Style / Form", placeholder: "e.g. Free verse, Sonnet, Haiku sequence" },
        { key: "mood", label: "Mood", placeholder: "e.g. Melancholic yet serene" }
      ],
      tags: ["poetry", "poem", "creative", "art"]
    },
    {
      id: "creative-lyrics",
      category: "creative",
      categoryLabel: "\u{1F3A8} Creative",
      name: "Song Lyrics & Hook",
      description: "Verses, chorus, and bridge with rhythm and emotional beat.",
      template: 'Write song lyrics for a {{genre}} song titled "{{songTitle}}". Theme: {{theme}}. Structure: Verse 1, Pre-Chorus, Hook/Chorus, Verse 2, Chorus, Emotional Bridge, and Outro. Include chord progression cues if applicable.',
      variables: [
        { key: "songTitle", label: "Song Title", placeholder: "e.g. Neon Shadows" },
        { key: "genre", label: "Music Genre", placeholder: "e.g. Indie synth-pop, Folk acoustic" },
        { key: "theme", label: "Theme / Story", placeholder: "e.g. Leaving a small town late at night with nothing to lose" }
      ],
      tags: ["music", "lyrics", "song", "audio"]
    },
    // --- LEARNING (4) ---
    {
      id: "learn-study-guide",
      category: "learning",
      categoryLabel: "\u{1F393} Learning",
      name: "Comprehensive Study Guide",
      description: "Summaries, key formulas, mnemonics, and test questions.",
      template: "Create a comprehensive study guide for {{subjectOrTopic}} at the {{academicLevel}} level. Format into: 1) Core Principles (summarized in 2 sentences each), 2) Key Terminology & Definitions, 3) Common Pitfalls / Mistakes to Avoid, 4) 5 Rapid-Fire Practice Questions with Answers.",
      variables: [
        { key: "subjectOrTopic", label: "Subject / Topic", placeholder: "e.g. Photosynthesis and Cellular Respiration" },
        { key: "academicLevel", label: "Level", placeholder: "e.g. High School AP Biology or Intro College" }
      ],
      tags: ["study", "guide", "school", "exam"]
    },
    {
      id: "learn-eli5",
      category: "learning",
      categoryLabel: "\u{1F393} Learning",
      name: "Explain Like I\u2019m 5 (ELI5)",
      description: "Make complex topics crystal clear using fun analogies.",
      template: 'Explain the concept of "{{concept}}" to someone with zero technical background, as if explaining to a curious 10-year-old. Use a fun, everyday analogy (like cooking, Legos, or sports) to illustrate how it works. Avoid any jargon.',
      variables: [
        { key: "concept", label: "Concept to Explain", placeholder: "e.g. Quantum Computing, Blockchain, or Inflation" }
      ],
      tags: ["eli5", "explain", "simple", "analogy"]
    },
    {
      id: "learn-flashcards",
      category: "learning",
      categoryLabel: "\u{1F393} Learning",
      name: "10 Flashcard Q&A Pairs",
      description: "Active recall question-and-answer pairs for studying.",
      template: "Generate 10 high-impact study flashcards on {{topic}}. Target difficulty: {{difficulty}}. Format each flashcard clearly as:\nFront: [Challenging Question or Prompt]\nBack: [Concise, accurate answer with key takeaway]",
      variables: [
        { key: "topic", label: "Study Topic", placeholder: "e.g. French Revolution Key Events & Causes" },
        { key: "difficulty", label: "Difficulty", placeholder: "e.g. Intermediate / College Prep" }
      ],
      tags: ["flashcards", "memorize", "anki", "quiz"]
    },
    {
      id: "learn-quiz-gen",
      category: "learning",
      categoryLabel: "\u{1F393} Learning",
      name: "Practice Quiz with Explanations",
      description: "Multiple-choice test with detailed reasoning for each answer.",
      template: "Create a {{numQuestions}}-question practice quiz testing understanding of {{topic}}. Include a mix of conceptual and application questions. For each question, provide 4 options (A, B, C, D), and at the very end, include the Answer Key with a 1-sentence explanation of why the correct answer is right.",
      variables: [
        { key: "topic", label: "Quiz Topic", placeholder: "e.g. Python Data Structures (Lists vs Dicts vs Sets)" },
        { key: "numQuestions", label: "Number of Questions", placeholder: "e.g. 5" }
      ],
      tags: ["quiz", "test", "practice", "learning"]
    }
  ];
  var CATEGORIES = [
    { id: "all", label: "\u{1F31F} All" },
    { id: "writing", label: "\u270D\uFE0F Writing" },
    { id: "coding", label: "\u{1F4BB} Coding" },
    { id: "business", label: "\u{1F4BC} Business" },
    { id: "creative", label: "\u{1F3A8} Creative" },
    { id: "learning", label: "\u{1F393} Learning" },
    { id: "custom", label: "\u2B50 My Templates" }
  ];
  function substituteTemplate(templateStr, values = {}, variables = []) {
    return templateStr.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (match, key) => {
      if (values[key] !== void 0 && values[key].trim() !== "") {
        return values[key].trim();
      }
      if (Array.isArray(variables)) {
        const v = variables.find((item) => item.key === key);
        if (v && v.placeholder) {
          const clean = v.placeholder.replace(/^e\.g\.\s*/i, "").trim();
          if (clean) return clean;
        }
      }
      return match;
    });
  }
  function extractVariables(templateStr) {
    const matches = templateStr.match(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g) || [];
    const vars = [];
    const seen = /* @__PURE__ */ new Set();
    for (const m of matches) {
      const key = m.replace(/\{\{\s*|\s*\}\}/g, "");
      if (!seen.has(key)) {
        seen.add(key);
        vars.push({ key, label: key.charAt(0).toUpperCase() + key.slice(1), placeholder: `Enter ${key}...` });
      }
    }
    return vars;
  }
  function showTemplatesModal({ openRockyModal, stateObj, persist, onApply, copyToClipboard, showToast }) {
    const { modal, close } = openRockyModal();
    modal.classList.add("templates-modal");
    let activeCategory = "all";
    let searchQuery = "";
    let selectedTemplate = null;
    let customTemplates = stateObj.customTemplates || [];
    function getCombinedTemplates() {
      const customs = customTemplates.map((t) => ({
        ...t,
        isCustom: true,
        categoryLabel: "\u2B50 My Template",
        variables: t.variables || extractVariables(t.template || "")
      }));
      return [...BUILTIN_TEMPLATES, ...customs];
    }
    function renderHeader() {
      const head = document.createElement("div");
      head.className = "templates-header";
      const topRow = document.createElement("div");
      topRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;";
      const title = document.createElement("h3");
      title.style.cssText = "margin:0;font-size:16px;display:flex;align-items:center;gap:8px;";
      title.textContent = "\u{1F9E9} Prompt Templates";
      const closeBtn = document.createElement("button");
      closeBtn.className = "templates-close-btn";
      closeBtn.style.cssText = "background:none;border:none;color:var(--dim);font-size:18px;cursor:pointer;padding:4px 8px;";
      closeBtn.textContent = "\u2715";
      closeBtn.addEventListener("click", close);
      topRow.appendChild(title);
      topRow.appendChild(closeBtn);
      const desc = document.createElement("p");
      desc.style.cssText = "margin:0 0 12px 0;font-size:12px;color:var(--dim);line-height:1.4;";
      desc.textContent = "Pick a starting prompt, fill in the blanks, and let Bandit enhance it into a masterpiece!";
      head.appendChild(topRow);
      head.appendChild(desc);
      return head;
    }
    function renderView() {
      modal.replaceChildren();
      modal.appendChild(renderHeader());
      if (selectedTemplate) {
        renderRunner(selectedTemplate);
      } else {
        renderBrowser();
      }
    }
    function renderBrowser() {
      const searchWrap = document.createElement("div");
      searchWrap.className = "template-search-wrap";
      searchWrap.style.cssText = "position:relative;margin-bottom:12px;";
      const searchInput = document.createElement("input");
      searchInput.type = "text";
      searchInput.placeholder = "\u{1F50D} Search templates (e.g. blog, code, email, essay)...";
      searchInput.value = searchQuery;
      searchInput.className = "template-search-input";
      searchInput.style.cssText = "width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--line);color:var(--text);padding:8px 12px;border-radius:8px;font-family:var(--font-mono);font-size:12px;outline:none;";
      searchInput.addEventListener("input", (e) => {
        searchQuery = e.target.value.toLowerCase();
        renderCardsList();
      });
      searchWrap.appendChild(searchInput);
      modal.appendChild(searchWrap);
      const tabsContainer = document.createElement("div");
      tabsContainer.className = "template-tabs-container";
      tabsContainer.style.cssText = "display:flex;gap:6px;overflow-x:auto;padding-bottom:8px;margin-bottom:12px;scrollbar-width:none;";
      const allList = getCombinedTemplates();
      CATEGORIES.forEach((cat) => {
        const count = cat.id === "all" ? allList.length : cat.id === "custom" ? customTemplates.length : allList.filter((t) => t.category === cat.id).length;
        const tabBtn = document.createElement("button");
        tabBtn.type = "button";
        tabBtn.className = `tab-pill ${activeCategory === cat.id ? "active" : ""}`;
        tabBtn.style.cssText = `white-space:nowrap;font-size:11px;padding:5px 10px;border-radius:20px;border:1px solid ${activeCategory === cat.id ? "var(--amber)" : "var(--line)"};background:${activeCategory === cat.id ? "rgba(245,165,36,0.15)" : "var(--panel-2)"};color:${activeCategory === cat.id ? "var(--amber)" : "var(--text)"};cursor:pointer;font-family:var(--font-mono);transition:all .15s;`;
        tabBtn.textContent = `${cat.label} (${count})`;
        tabBtn.addEventListener("click", () => {
          activeCategory = cat.id;
          renderView();
        });
        tabsContainer.appendChild(tabBtn);
      });
      modal.appendChild(tabsContainer);
      if (activeCategory === "custom") {
        const addCustomBtn = document.createElement("button");
        addCustomBtn.type = "button";
        addCustomBtn.className = "secondary";
        addCustomBtn.style.cssText = "margin-bottom:12px;width:100%;font-size:12px;padding:8px;border:1px dashed var(--amber);color:var(--amber);background:rgba(245,165,36,0.08);";
        addCustomBtn.textContent = "+ Create New Custom Template";
        addCustomBtn.addEventListener("click", () => renderCustomCreator());
        modal.appendChild(addCustomBtn);
      }
      const grid = document.createElement("div");
      grid.className = "templates-grid";
      grid.id = "templatesGrid";
      grid.style.cssText = "display:flex;flex-direction:column;gap:8px;max-height:50vh;overflow-y:auto;padding-right:4px;";
      modal.appendChild(grid);
      renderCardsList();
    }
    function renderCardsList() {
      const grid = modal.querySelector("#templatesGrid");
      if (!grid) return;
      grid.replaceChildren();
      const all = getCombinedTemplates();
      const filtered = all.filter((t) => {
        const matchesCat = activeCategory === "all" ? true : activeCategory === "custom" ? t.isCustom : t.category === activeCategory;
        if (!matchesCat) return false;
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        const inName = (t.name || "").toLowerCase().includes(q);
        const inDesc = (t.description || "").toLowerCase().includes(q);
        const inTags = (t.tags || []).some((tag) => tag.toLowerCase().includes(q));
        return inName || inDesc || inTags;
      });
      if (filtered.length === 0) {
        const empty = document.createElement("div");
        empty.style.cssText = "text-align:center;padding:32px 16px;color:var(--dim);font-size:12px;line-height:1.6;";
        const line1 = document.createElement("div");
        line1.appendChild(document.createTextNode('No templates found matching "'));
        const boldQuery = document.createElement("b");
        boldQuery.textContent = searchQuery;
        line1.appendChild(boldQuery);
        line1.appendChild(document.createTextNode('".'));
        const line2 = document.createElement("div");
        line2.style.cssText = "color:var(--dim);font-size:11px;margin-top:4px;";
        line2.textContent = "Try searching something else or create a custom one!";
        empty.appendChild(line1);
        empty.appendChild(line2);
        grid.appendChild(empty);
        return;
      }
      filtered.forEach((t) => {
        const card = document.createElement("div");
        card.className = "template-card";
        card.style.cssText = "background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:6px;cursor:pointer;transition:border-color .15s, transform .15s;text-align:left;";
        card.addEventListener("mouseenter", () => {
          card.style.borderColor = "var(--amber)";
          card.style.transform = "translateY(-1px)";
        });
        card.addEventListener("mouseleave", () => {
          card.style.borderColor = "var(--line)";
          card.style.transform = "none";
        });
        const topRow = document.createElement("div");
        topRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;";
        const badge = document.createElement("span");
        badge.style.cssText = "font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--amber);background:rgba(245,165,36,0.12);padding:2px 6px;border-radius:4px;";
        badge.textContent = t.categoryLabel || t.category;
        topRow.appendChild(badge);
        if (t.isCustom) {
          const delBtn = document.createElement("button");
          delBtn.type = "button";
          delBtn.textContent = "\u{1F5D1}";
          delBtn.title = "Delete custom template";
          delBtn.style.cssText = "background:none;border:none;cursor:pointer;font-size:12px;opacity:0.6;padding:2px;";
          delBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            customTemplates = customTemplates.filter((ct) => ct.id !== t.id);
            stateObj.customTemplates = customTemplates;
            persist({ customTemplates }, { immediate: true });
            showToast("Template deleted");
            renderView();
          });
          topRow.appendChild(delBtn);
        }
        const title = document.createElement("b");
        title.style.cssText = "font-size:13px;color:var(--text);";
        title.textContent = t.name;
        const desc = document.createElement("div");
        desc.style.cssText = "font-size:11px;color:var(--dim);line-height:1.4;";
        desc.textContent = t.description;
        const bottomRow = document.createElement("div");
        bottomRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-top:4px;gap:8px;";
        const varCount = t.variables && t.variables.length || 0;
        const varInfo = document.createElement("span");
        varInfo.style.cssText = "font-size:10px;color:#7e8b9b;white-space:nowrap;";
        varInfo.textContent = varCount > 0 ? `\u26A1 ${varCount} blanks` : `\u26A1 Ready`;
        const btnGroup = document.createElement("div");
        btnGroup.style.cssText = "display:flex;gap:6px;align-items:center;";
        const quickBtn = document.createElement("button");
        quickBtn.type = "button";
        quickBtn.className = "secondary";
        quickBtn.style.cssText = "font-size:10px;padding:3px 8px;border-radius:6px;border:1px solid var(--amber);color:var(--amber);background:rgba(245,165,36,0.1);font-weight:bold;cursor:pointer;white-space:nowrap;";
        quickBtn.textContent = "\u{1F680} Quick Use";
        quickBtn.title = "Instantly insert this prompt into chat with smart examples";
        quickBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          close();
          const prompt = substituteTemplate(t.template, {}, t.variables);
          if (onApply) onApply(prompt, { enhance: false });
        });
        const customizeBtn = document.createElement("button");
        customizeBtn.type = "button";
        customizeBtn.className = "secondary";
        customizeBtn.style.cssText = "font-size:10px;padding:3px 8px;border-radius:6px;cursor:pointer;white-space:nowrap;";
        customizeBtn.textContent = "\u270F\uFE0F Edit \u279C";
        customizeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          selectedTemplate = t;
          renderView();
        });
        btnGroup.appendChild(quickBtn);
        btnGroup.appendChild(customizeBtn);
        bottomRow.appendChild(varInfo);
        bottomRow.appendChild(btnGroup);
        card.appendChild(topRow);
        card.appendChild(title);
        card.appendChild(desc);
        card.appendChild(bottomRow);
        card.addEventListener("click", () => {
          selectedTemplate = t;
          renderView();
        });
        grid.appendChild(card);
      });
    }
    function renderRunner(t) {
      const runner = document.createElement("div");
      runner.className = "template-runner";
      runner.style.cssText = "display:flex;flex-direction:column;gap:10px;";
      const navBar = document.createElement("div");
      navBar.style.cssText = "display:flex;align-items:center;justify-content:space-between;";
      const backBtn = document.createElement("button");
      backBtn.type = "button";
      backBtn.className = "secondary";
      backBtn.style.cssText = "font-size:11px;padding:4px 8px;cursor:pointer;";
      backBtn.textContent = "\u2190 Back to Templates";
      backBtn.addEventListener("click", () => {
        selectedTemplate = null;
        renderView();
      });
      const badge = document.createElement("span");
      badge.style.cssText = "font-size:10px;color:var(--amber);background:rgba(245,165,36,0.12);padding:2px 8px;border-radius:12px;font-weight:bold;";
      badge.textContent = t.categoryLabel || t.category;
      navBar.appendChild(backBtn);
      navBar.appendChild(badge);
      runner.appendChild(navBar);
      const info = document.createElement("div");
      info.style.cssText = "background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:10px;text-align:left;";
      const infoTitle = document.createElement("div");
      infoTitle.style.cssText = "font-size:13px;font-weight:bold;color:var(--text);margin-bottom:2px;";
      infoTitle.textContent = t.name;
      const infoDesc = document.createElement("div");
      infoDesc.style.cssText = "font-size:11px;color:var(--dim);";
      infoDesc.textContent = t.description;
      info.appendChild(infoTitle);
      info.appendChild(infoDesc);
      runner.appendChild(info);
      const vars = t.variables || [];
      const values = {};
      const inputElements = {};
      vars.forEach((v) => {
        values[v.key] = "";
      });
      if (vars.length > 0) {
        const formHeader = document.createElement("div");
        formHeader.style.cssText = "display:flex;align-items:center;justify-content:space-between;";
        const formTitle = document.createElement("span");
        formTitle.style.cssText = "font-size:11px;font-weight:bold;color:var(--text);";
        formTitle.textContent = "Customize Blanks:";
        const toolGroup = document.createElement("div");
        toolGroup.style.cssText = "display:flex;gap:6px;";
        const fillExampleBtn = document.createElement("button");
        fillExampleBtn.type = "button";
        fillExampleBtn.className = "secondary";
        fillExampleBtn.style.cssText = "font-size:10px;padding:2px 8px;border-radius:4px;border:1px solid var(--amber);color:var(--amber);cursor:pointer;background:rgba(245,165,36,0.08);";
        fillExampleBtn.textContent = "\u2728 Fill Examples";
        fillExampleBtn.title = "Pre-fill with example values";
        fillExampleBtn.addEventListener("click", () => {
          vars.forEach((v) => {
            if (v.placeholder) {
              const clean = v.placeholder.replace(/^e\.g\.\s*/i, "").trim();
              values[v.key] = clean;
              if (inputElements[v.key]) inputElements[v.key].value = clean;
            }
          });
          updatePreview();
        });
        const clearBtn = document.createElement("button");
        clearBtn.type = "button";
        clearBtn.className = "secondary";
        clearBtn.style.cssText = "font-size:10px;padding:2px 8px;border-radius:4px;cursor:pointer;";
        clearBtn.textContent = "\u{1F9F9} Clear";
        clearBtn.title = "Clear all fields to type your own";
        clearBtn.addEventListener("click", () => {
          vars.forEach((v) => {
            values[v.key] = "";
            if (inputElements[v.key]) inputElements[v.key].value = "";
          });
          updatePreview();
        });
        toolGroup.appendChild(fillExampleBtn);
        toolGroup.appendChild(clearBtn);
        formHeader.appendChild(formTitle);
        formHeader.appendChild(toolGroup);
        runner.appendChild(formHeader);
        const form = document.createElement("div");
        form.style.cssText = "display:flex;flex-direction:column;gap:8px;max-height:26vh;overflow-y:auto;padding-right:4px;";
        vars.forEach((v, idx) => {
          const group = document.createElement("div");
          group.style.cssText = "display:flex;flex-direction:column;gap:4px;text-align:left;";
          const label = document.createElement("label");
          label.style.cssText = "font-size:11px;font-weight:bold;color:var(--text);display:flex;justify-content:space-between;";
          const labelTitle = document.createElement("span");
          labelTitle.textContent = v.label || v.key;
          const labelHint = document.createElement("span");
          labelHint.style.cssText = "font-size:10px;color:var(--dim);font-weight:normal;";
          labelHint.textContent = v.placeholder ? v.placeholder.length > 30 ? v.placeholder.slice(0, 30) + "\u2026" : v.placeholder : "";
          label.appendChild(labelTitle);
          label.appendChild(labelHint);
          const input = document.createElement("input");
          input.type = "text";
          input.placeholder = v.placeholder || `Enter ${v.key}...`;
          input.value = values[v.key] || "";
          input.style.cssText = "background:var(--bg);border:1px solid var(--line);color:var(--text);padding:7px 10px;border-radius:6px;font-family:var(--font-mono);font-size:12px;outline:none;";
          input.addEventListener("input", (e) => {
            values[v.key] = e.target.value;
            updatePreview();
          });
          inputElements[v.key] = input;
          group.appendChild(label);
          group.appendChild(input);
          form.appendChild(group);
          if (idx === 0) {
            setTimeout(() => input.focus(), 100);
          }
        });
        runner.appendChild(form);
      }
      const previewWrap = document.createElement("div");
      previewWrap.style.cssText = "text-align:left;";
      const previewLabel = document.createElement("div");
      previewLabel.style.cssText = "font-size:10px;text-transform:uppercase;color:var(--dim);letter-spacing:0.5px;margin-bottom:4px;display:flex;justify-content:space-between;";
      const previewTitle = document.createElement("span");
      previewTitle.textContent = "Live Prompt Preview";
      const previewBadge = document.createElement("span");
      previewBadge.style.color = "var(--amber)";
      previewBadge.textContent = "ready to insert";
      previewLabel.appendChild(previewTitle);
      previewLabel.appendChild(previewBadge);
      const previewBox = document.createElement("div");
      previewBox.id = "templateLivePreview";
      previewBox.style.cssText = "background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px;font-size:11.5px;font-family:var(--font-mono);line-height:1.5;color:var(--text);max-height:16vh;overflow-y:auto;white-space:pre-wrap;";
      function getFinalText() {
        return substituteTemplate(t.template, values, t.variables);
      }
      function updatePreview() {
        if (previewBox) {
          previewBox.textContent = getFinalText();
        }
      }
      previewWrap.appendChild(previewLabel);
      previewWrap.appendChild(previewBox);
      runner.appendChild(previewWrap);
      updatePreview();
      const actions = document.createElement("div");
      actions.style.cssText = "display:flex;flex-direction:column;gap:8px;margin-top:4px;";
      const primaryBtn = document.createElement("button");
      primaryBtn.type = "button";
      primaryBtn.style.cssText = "background:var(--amber);color:#000;border:none;border-radius:8px;padding:10px;font-weight:bold;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;";
      primaryBtn.textContent = "\u{1F680} Insert into Chat";
      primaryBtn.addEventListener("click", () => {
        const prompt = getFinalText();
        close();
        if (onApply) onApply(prompt, { enhance: false });
      });
      const subActions = document.createElement("div");
      subActions.style.cssText = "display:flex;gap:8px;";
      const enhanceBtn = document.createElement("button");
      enhanceBtn.type = "button";
      enhanceBtn.className = "secondary";
      enhanceBtn.style.cssText = "flex:1;font-size:11px;padding:8px;font-weight:bold;color:var(--amber);border:1px solid var(--amber);cursor:pointer;background:rgba(245,165,36,0.08);";
      enhanceBtn.textContent = "\u2728 Insert & Enhance";
      enhanceBtn.title = "Insert into chat and immediately run AI prompt enhancement";
      enhanceBtn.addEventListener("click", () => {
        const prompt = getFinalText();
        close();
        if (onApply) onApply(prompt, { enhance: true });
      });
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "secondary";
      copyBtn.style.cssText = "flex:1;font-size:11px;padding:8px;cursor:pointer;";
      copyBtn.textContent = "\u{1F4CB} Copy Prompt";
      copyBtn.addEventListener("click", () => {
        const prompt = getFinalText();
        copyToClipboard(prompt).then(() => showToast("Template copied \u{1F4CB}")).catch(() => showToast("Could not copy"));
      });
      subActions.appendChild(enhanceBtn);
      subActions.appendChild(copyBtn);
      actions.appendChild(primaryBtn);
      actions.appendChild(subActions);
      runner.appendChild(actions);
      modal.appendChild(runner);
    }
    function renderCustomCreator() {
      modal.replaceChildren();
      modal.appendChild(renderHeader());
      const form = document.createElement("div");
      form.style.cssText = "display:flex;flex-direction:column;gap:10px;text-align:left;";
      const backBtn = document.createElement("button");
      backBtn.type = "button";
      backBtn.className = "secondary";
      backBtn.style.cssText = "align-self:flex-start;font-size:11px;padding:4px 8px;margin-bottom:4px;";
      backBtn.textContent = "\u2190 Back";
      backBtn.addEventListener("click", () => renderView());
      form.appendChild(backBtn);
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.placeholder = "Template Title (e.g. My Weekly Standup)";
      nameInput.style.cssText = "background:var(--bg);border:1px solid var(--line);color:var(--text);padding:8px 12px;border-radius:6px;font-size:12px;font-family:var(--font-mono);";
      const descInput = document.createElement("input");
      descInput.type = "text";
      descInput.placeholder = "Brief description (e.g. Format my weekly achievements)";
      descInput.style.cssText = "background:var(--bg);border:1px solid var(--line);color:var(--text);padding:8px 12px;border-radius:6px;font-size:12px;font-family:var(--font-mono);";
      const tip = document.createElement("div");
      tip.style.cssText = "font-size:11px;color:var(--amber);line-height:1.4;";
      const tipBold = document.createElement("b");
      tipBold.textContent = "\u{1F4A1} Pro Tip:";
      const code1 = document.createElement("code");
      code1.textContent = "{{variableName}}";
      const code2 = document.createElement("code");
      code2.textContent = "{{topic}}";
      const code3 = document.createElement("code");
      code3.textContent = "{{goal}}";
      tip.appendChild(tipBold);
      tip.appendChild(document.createTextNode(" Add "));
      tip.appendChild(code1);
      tip.appendChild(document.createTextNode(" anywhere to create fill-in blanks (e.g. "));
      tip.appendChild(code2);
      tip.appendChild(document.createTextNode(", "));
      tip.appendChild(code3);
      tip.appendChild(document.createTextNode(")!"));
      const promptText = document.createElement("textarea");
      promptText.placeholder = "Write your template prompt here with {{variables}}...";
      promptText.style.cssText = "background:var(--bg);border:1px solid var(--line);color:var(--text);padding:10px;border-radius:8px;font-size:12px;font-family:var(--font-mono);min-height:100px;resize:vertical;";
      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.style.cssText = "background:var(--amber);color:#000;font-weight:bold;border:none;padding:10px;border-radius:8px;cursor:pointer;";
      saveBtn.textContent = "Save Custom Template";
      saveBtn.addEventListener("click", () => {
        const name = nameInput.value.trim();
        const template = promptText.value.trim();
        if (!name || !template) {
          showToast("Please provide a title and prompt");
          return;
        }
        const newTemplate = {
          id: "custom-" + Date.now(),
          category: "custom",
          categoryLabel: "\u2B50 Custom",
          name,
          description: descInput.value.trim() || "Custom user template",
          template,
          variables: extractVariables(template),
          tags: ["custom"]
        };
        customTemplates.unshift(newTemplate);
        stateObj.customTemplates = customTemplates;
        persist({ customTemplates }, { immediate: true });
        showToast("Template saved! \u2B50");
        activeCategory = "custom";
        renderView();
      });
      form.appendChild(nameInput);
      form.appendChild(descInput);
      form.appendChild(tip);
      form.appendChild(promptText);
      form.appendChild(saveBtn);
      modal.appendChild(form);
    }
    renderView();
  }

  // src/content.js
  var TEMPLATE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bandit \u2014 AI Prompt Companion</title>

</head>
<body>

<div class="app">
  <div class="topbar">
    <div class="logo"></div>
    <b>VibeBuild</b><span>\u2014 untitled-project-7</span>
    <span class="demo-tag">DEMO \xB7 Bandit Desktop Pet \u{1F43E}</span>
  </div>
  <div class="stage">
    <div id="rocky-root">
  <div class="pet-wrap" id="petWrap">
    <div class="bubble" id="bubble">
      <button id="bubbleClose" style="position:absolute; top:2px; right:4px; background:none; border:none; font-size:10px; color:#888; cursor:pointer; padding:2px;">\u2715</button>
      <div id="bubbleText"></div>
      <form id="followUpForm" style="display: none; margin-top: 8px; position: relative;">
        <input type="text" id="followUpInput" placeholder="Refine... (e.g. 'shorter')" autocomplete="off" style="width:100%; box-sizing:border-box; border:1px solid rgba(0,0,0,0.1); background:rgba(0,0,0,0.05); color:#232323; padding:6px 28px 6px 10px; border-radius:12px; outline:none; font-family:inherit; font-size:11px;">
        <button type="submit" style="position: absolute; right: 4px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; color: var(--amber); font-size: 14px; padding: 2px;">\u23CE</button>
      </form>
    </div>
    <div class="radial-menu" id="petMenu">
      <button id="menuEnhance" class="radial-item label-left" style="--a: -120deg">\u2728<span class="label">Enhance</span></button>
      <button id="menuTemplates" class="radial-item label-left" style="--a: -85deg">\u{1F9E9}<span class="label">Templates</span></button>
      <button id="menuSummarize" class="radial-item label-left" style="--a: -50deg">\u{1F4CB}<span class="label">Summarize</span></button>
      <button id="menuUndo" class="radial-item label-top" style="--a: -15deg">\u21A9\uFE0F<span class="label">Undo</span></button>
      <button id="menuFeed" class="radial-item label-top" style="--a: 20deg">\u{1F36A}<span class="label">Feed Bandit</span></button>
      <button id="menuHistory" class="radial-item label-right" style="--a: 55deg">\u{1F4DC}<span class="label">History</span></button>
      <button id="menuSettings" class="radial-item label-right" style="--a: 90deg">\u2699\uFE0F<span class="label">Settings</span></button>
      <button id="menuHome" class="radial-item label-right" style="--a: 125deg">\u{1F3E0}<span class="label">Go Home</span></button>
      <button id="menuDisable" class="radial-item label-right" style="--a: 160deg">\u{1F6AB}<span class="label">Disable</span></button>
    </div>
    <div class="emote" id="startleEmote" style="display:none;position:absolute;top:-10px;font-size:28px;z-index:10;animation:pop .3s cubic-bezier(.3,1.4,.5,1)">\u2757\uFE0F</div>
    <div class="pet" id="pet">
      <span class="zzz">z</span><span class="zzz z2">z</span>
      <span class="spark s1"></span><span class="spark s2"></span><span class="spark s3"></span>
      <div class="sprite" id="frontSprite"><svg viewBox="0 0 32 32" id="frontSvg"></svg></div>
      
      
      
    </div>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<div class="modal-overlay" id="settingsModal">
  <div class="modal">
    <h3>Bandit Settings</h3>
    
    <div class="xp-bar" style="opacity:1; transform:none; pointer-events:auto; margin:0 0 4px 0; width:100%; max-width:none; background:#0f1318;"><div class="xp-fill" id="xpFill"></div></div>
    <div class="xp-label" id="xpLabel" style="opacity:1; transform:none; pointer-events:auto; margin-bottom:16px;">BANDIT \xB7 <b>LVL 1</b> \xB7 0/20 XP</div>

    <label>
      Name
      <input type="text" id="settingName" value="Bandit" autocomplete="off" spellcheck="false" maxlength="32">
    </label>
    <label>
      Size (<span id="sizeValue">100%</span>)
      <input type="range" id="settingSize" min="0.5" max="2" step="0.1" value="1">
    </label>

      <div class="field-group">
        <h4>Custom Prompt Rules</h4>
        <textarea id="settingCustomInstructions" placeholder="e.g. 'Always output as a React component' or 'Format it for Midjourney'" style="width:100%; min-height:60px; border:1px solid var(--line); border-radius:4px; padding:4px; font-family:var(--font-sans); font-size:12px; background:transparent; color:white; resize:vertical;"></textarea>
      </div>

      <div class="field-group">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" id="settingAskPlaceholders">
          <span>Ask me to fill in [placeholders] after Enhance</span>
        </label>
      </div>

      <div class="field-group" style="margin-top: 4px;">
        <button id="openTemplatesFromSettings" type="button" class="secondary" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: bold; border-color: var(--amber); color: var(--amber); background: rgba(245,165,36,0.08); padding: 9px 12px; margin: 0;">
          \u{1F9E9} Browse Prompt Templates
        </button>
      </div>

    <hr class="modal-divider">

    <label>
      Enhance Style
      <select id="settingStyle">
        <option value="structured">Structured (GOAL / CONTEXT / REQUIREMENTS)</option>
        <option value="concise">Concise (one tight paragraph)</option>
        <option value="detailed">Detailed (full spec + edge cases)</option>
      </select>
    </label>

    <label>
      Prompt Tone
      <select id="settingTone">
        <option value="professional">\u{1F3E2} Professional (default)</option>
        <option value="casual">\u{1F4AC} Casual & Friendly</option>
        <option value="academic">\u{1F393} Academic & Scholarly</option>
        <option value="creative">\u{1F3A8} Creative & Bold</option>
      </select>
    </label>

    <label>
      AI Provider
      <select id="settingProvider">
        <option value="anthropic">Anthropic Claude</option>
        <option value="openai">OpenAI</option>
        <option value="gemini">Google Gemini</option>
        <option value="groq">Groq (free tier, fast)</option>
        <option value="nvidia">NVIDIA NIM (free tier)</option>
        <option value="builtin">Use built-in Browser AI only (no key)</option>
      </select>
    </label>
    <label>
      API Key
      <span class="label-hint" id="apiKeyHint">
        <a id="getApiKeyLink" href="#" target="_blank" style="color: #64b5f6;">Get your API key here \u{1F517}</a>
      </span>
      <input type="password" id="settingApiKey" autocomplete="off" spellcheck="false" placeholder="paste your key">
    </label>
    <label>
      Model <span class="label-hint">(optional override)</span>
      <input type="text" id="settingModel" autocomplete="off" spellcheck="false" placeholder="defaults to a fast/cheap model">
    </label>
    <div class="settings-row">
      <button id="testApiKey" type="button" class="secondary">Test key</button>
      <span id="testApiKeyStatus" class="test-key-status"></span>
    </div>

    <div class="settings-row" style="margin-top: 12px; display: flex; justify-content: space-between; align-items: center;">
      <button id="resetDisabledSites" type="button" class="secondary" style="font-size: 11px;">Reset disabled sites</button>
      <span id="resetDisabledStatus" style="font-size: 11px; color: var(--green);"></span>
    </div>

    <div style="text-align: center; margin-top: 4px; display: flex; justify-content: center; gap: 8px; font-size: 11px;">
      <a href="https://github.com/manishankar0922/Bandit/blob/main/PRIVACY.md" target="_blank" style="color: var(--dim); text-decoration: underline;">Privacy Policy</a>
      <span style="color: var(--dim);">\xB7</span>
      <a href="https://github.com/manishankar0922/Bandit/blob/main/TERMS.md" target="_blank" style="color: var(--dim); text-decoration: underline;">Terms & Conditions</a>
    </div>

    <hr class="modal-divider">

    <div style="display: flex; gap: 8px; justify-content: center;">
      <button id="exportSettings" type="button" class="secondary" style="font-size: 11px;">\u{1F4BE} Export Backup</button>
      <button id="importSettings" type="button" class="secondary" style="font-size: 11px;">\u{1F4C2} Import Backup</button>
    </div>
    <span id="backupStatus" style="font-size: 11px; color: var(--green); text-align: center; display: block;"></span>

    <button id="closeSettings">Save & Close</button>
  </div>
</div>


</body>
</html>
`;
  var TEMPLATE_CSS = `:root,:host{
    --bg:#0f1318;
    --panel:#161c24;
    --panel-2:#1d242e;
    --line:#2a3340;
    --text:#dce3ec;
    --dim:#8a95a5;
    --amber:#f5a524;
    --amber-soft:rgba(245,165,36,.14);
    --font-mono:'SFMono-Regular',ui-monospace,'Cascadia Mono',Consolas,monospace;
  }
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{height:100%}
  body{
    background:var(--bg);color:var(--text);
    font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    overflow:hidden;
  }

  /* ---------- fake vibe-coding tool ---------- */
  .app{display:flex;flex-direction:column;height:100vh}
  .topbar{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--line);background:var(--panel);flex-shrink:0}
  .logo{width:22px;height:22px;border-radius:6px;background:linear-gradient(135deg,#5b6cff,#9a4dff)}
  .topbar b{font-size:14px}
  .topbar span{font-size:12px;color:var(--dim)}
  .demo-tag{margin-left:auto;font-family:var(--font-mono);font-size:11px;color:var(--amber);background:var(--amber-soft);border:1px solid rgba(245,165,36,.35);padding:3px 8px;border-radius:99px}

  .stage{flex:1;display:flex;min-height:0}
  .chat{flex:1;display:flex;flex-direction:column;max-width:760px;margin:0 auto;width:100%;padding:0 16px}
  .messages{flex:1;overflow-y:auto;padding:20px 4px;display:flex;flex-direction:column;gap:12px}
  .msg{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px;font-size:13.5px;line-height:1.55;max-width:88%}
  .msg.ai{align-self:flex-start;color:var(--dim);white-space:pre-wrap}
  .msg.you{align-self:flex-end;background:var(--panel-2);white-space:pre-wrap;font-family:var(--font-mono);font-size:12.5px}
  .msg .who{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--dim);margin-bottom:6px;font-family:var(--font-mono)}
  .msg.enhanced{border-color:rgba(245,165,36,.4)}
  .msg.enhanced .who{color:var(--amber)}
  .cursor { animation: blink 1s step-end infinite; color: var(--amber); }
  @keyframes blink { 50% { opacity: 0; } }

  .composer{flex-shrink:0;padding:12px 4px 18px}
  .composer-box{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:10px;transition:border-color .25s, box-shadow .25s}
  .composer-box.rocky-glow{border-color:rgba(245,165,36,.55);box-shadow:0 0 0 1px rgba(245,165,36,.2), 0 8px 32px rgba(245,165,36,.08)}
  textarea{background:transparent;border:none;outline:none;resize:none;color:var(--text);font-family:var(--font-mono);font-size:13px;line-height:1.55;min-height:64px;max-height:200px}
  textarea::placeholder{color:#57616f}
  .composer-actions{display:flex;align-items:center;gap:8px}
  .hint{font-size:11.5px;color:var(--dim);font-family:var(--font-mono)}
  .send{margin-left:auto;background:var(--panel-2);border:1px solid var(--line);color:var(--text);font-size:12.5px;padding:7px 16px;border-radius:9px;cursor:pointer}
  .send:hover{border-color:#3a4656}

  /* ---------- Rocky ---------- */
  #rocky-root{
    all:initial;
    font-family:var(--font-mono);
    color:var(--text);
    font-size:14px;
    line-height:1.5;
    position:fixed;z-index:2147483647;top:0;left:0;width:100%;height:100%;pointer-events:none;
    user-select:none;-webkit-user-select:none;touch-action:none;
    will-change: transform, left, top;
  }
  .pet-wrap{position:absolute;cursor:grab;display:flex;flex-direction:column;align-items:center;pointer-events:auto;}
  .pet-wrap.dragging{cursor:grabbing}
  .pet-wrap.dragging .pet{transform-origin:top center;animation:dangle 1.2s ease-in-out infinite}
  
  
  @keyframes dangle{
    0%,100%{transform:rotate(-6deg) scale(0.92, 1.08)}
    50%{transform:rotate(6deg) scale(0.96, 1.12)}
  }

  .bubble{
    position:absolute;bottom:calc(100% + 12px);right:-8px;
    background:#f4efe4;color:#232323;
    font-family:var(--font-mono);font-size:11.5px;line-height:1.45;
    padding:8px 11px;border-radius:10px;border-bottom-right-radius:3px;
    max-width:210px;width:max-content;
    box-shadow:0 8px 24px rgba(0,0,0,.45);
    opacity:0;transform:translateY(6px) scale(.94);
    transition:opacity .22s,transform .22s;pointer-events:none;
  }
  .bubble::after{content:'';position:absolute;top:100%;right:16px;border:6px solid transparent;border-top-color:#f4efe4}
  .bubble.show{opacity:1;transform:translateY(0) scale(1)}
  .bubble .xp-pop{color:#0b7a3e;font-weight:700}

  .radial-menu {
    position: absolute;
    top: 50%; left: 50%;
    width: 0; height: 0;
    z-index: 5;
    opacity: 0; pointer-events: none;
    transition: opacity 0.3s;
  }
  .pet-wrap.show-menu .radial-menu {
    opacity: 1; pointer-events: auto;
  }
  .radial-item {
    position: absolute;
    top: -24px; left: -24px;
    width: 48px; height: 48px;
    border-radius: 50%;
    background: rgba(22, 28, 36, 0.85);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid rgba(245, 165, 36, 0.2);
    color: white;
    display: flex; align-items: center; justify-content: center;
    font-size: 20px;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    transform: translate(0, 0) scale(0);
    will-change: transform;
    transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), background 0.2s, border-color 0.2s;
  }
  .pet-wrap.show-menu .radial-item {
    transform: rotate(var(--a)) translateY(-105px) rotate(calc(var(--a) * -1)) scale(1);
  }
  .pet-wrap.show-menu .radial-item:hover {
    z-index: 1000 !important;
    background: rgba(36, 44, 55, 0.98);
    border-color: var(--amber);
    transform: rotate(var(--a)) translateY(-105px) rotate(calc(var(--a) * -1)) scale(1.12) !important;
    box-shadow: 0 0 16px rgba(245, 165, 36, 0.4), 0 6px 20px rgba(0,0,0,0.6);
  }
  .radial-item .label {
    position: absolute;
    background: #141a22;
    font-size: 11px; font-family: var(--font-mono); font-weight: bold;
    padding: 5px 10px; border-radius: 6px;
    white-space: nowrap; pointer-events: none;
    opacity: 0; transition: opacity 0.18s cubic-bezier(0.2, 0.9, 0.3, 1), transform 0.18s cubic-bezier(0.2, 0.9, 0.3, 1);
    border: 1px solid var(--amber); color: var(--amber);
    box-shadow: 0 4px 18px rgba(0,0,0,0.85);
    z-index: 1001;
  }
  /* Directional outward positioning so labels never collide with adjacent buttons */
  .radial-item.label-left .label {
    right: calc(100% + 10px);
    top: 50%;
    left: auto;
    bottom: auto;
    transform: translateY(-50%) translateX(4px);
  }
  .radial-item.label-left:hover .label {
    opacity: 1;
    transform: translateY(-50%) translateX(0);
  }
  .radial-item.label-right .label {
    left: calc(100% + 10px);
    top: 50%;
    right: auto;
    bottom: auto;
    transform: translateY(-50%) translateX(-4px);
  }
  .radial-item.label-right:hover .label {
    opacity: 1;
    transform: translateY(-50%) translateX(0);
  }
  .radial-item.label-top .label {
    bottom: calc(100% + 10px);
    left: 50%;
    top: auto;
    right: auto;
    transform: translateX(-50%) translateY(4px);
  }
  .radial-item.label-top:hover .label {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
  .radial-item:not(.label-left):not(.label-right):not(.label-top) .label {
    bottom: calc(100% + 10px);
    left: 50%;
    top: auto;
    right: auto;
    transform: translateX(-50%) translateY(4px);
  }
  .radial-item:not(.label-left):not(.label-right):not(.label-top):hover .label {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }

  /* pet stage holds BOTH sprites; only one visible at a time */
  .pet{width:118px;height:118px;position:relative;filter:drop-shadow(0 8px 12px rgba(0,0,0,.5));zoom:var(--pet-scale, 1);will-change:transform}
  .sprite{position:absolute;inset:0;display:flex;align-items:flex-end;justify-content:center}
  .sprite svg{image-rendering:pixelated;shape-rendering:crispEdges;overflow:visible}
  #frontSprite svg, #dangleSprite svg {width:112px;height:112px}
  #sideSprite svg{width:140px;height:78px;transition:transform .12s}
  #sleepSprite svg{width:118px;height:74px}
  #sideSprite, #sleepSprite, #dangleSprite {display:none !important}
  .pet.face-left #frontSprite svg{transform:scaleX(-1)}
  
  .pet-wrap.running .pet{animation:waddle .35s ease-in-out infinite}
  .pet-wrap.running #frontSprite .tail{animation:waddle-tail .35s ease-in-out infinite}
  @keyframes waddle{0%,100%{transform:translateY(0) rotate(-6deg)}50%{transform:translateY(-12px) rotate(6deg)}}
  @keyframes waddle-tail{0%,100%{transform:rotate(15deg)}50%{transform:rotate(-10deg)}}

  .pet-wrap.scooting .pet{animation:scoot .15s linear infinite}
  .pet-wrap.scooting #frontSprite .tail{animation:scoot-tail .15s linear infinite}
  @keyframes scoot{0%,100%{transform:translateY(0) scale(1,1)}50%{transform:translateY(3px) scale(1.06,.94)}}
  @keyframes scoot-tail{0%,100%{transform:rotate(0)}50%{transform:rotate(8deg)}}

  .pet-wrap.hopping .pet{animation:hop-run .5s cubic-bezier(.3,1.4,.5,1) infinite}
  .pet-wrap.hopping #frontSprite .tail{animation:waddle-tail .5s ease-in-out infinite}
  @keyframes hop-run{0%,100%{transform:translateY(0)}50%{transform:translateY(-24px) scale(.95,1.05)}}

  /* ---------- FRONT sprite states (the classic Rocky) ---------- */
  #frontSprite .body-group{transform-origin:50% 90%;animation:breathe 3.2s ease-in-out infinite}
  @keyframes breathe{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.028)}}
  #frontSprite .tail{transform-origin:18% 88%;animation:f-tail 4s ease-in-out infinite}
  @keyframes f-tail{0%,100%{transform:rotate(0deg)}50%{transform:rotate(-7deg)}}

  .pet-wrap.alert .pet{animation:hop-small .55s ease}
  .pet-wrap.alert #frontSprite .tail{animation:f-tail 1.1s ease-in-out infinite}
  .pet-wrap.alert #frontSprite .ears{animation:ear-perk .5s ease forwards}
  @keyframes ear-perk{to{transform:translateY(-2px)}}
  @keyframes hop-small{0%,100%{transform:translateY(0)}35%{transform:translateY(-8px)}}

  .pet-wrap.working .pet{animation:rummage .5s ease-in-out infinite}
  .pet-wrap.working #frontSprite .tail{animation:f-tail .5s ease-in-out infinite}
  @keyframes rummage{0%,100%{transform:rotate(0deg)}25%{transform:rotate(-2.4deg) translateX(-1px)}75%{transform:rotate(2.4deg) translateX(1px)}}

  .pet-wrap.happy .pet{animation:jump .9s cubic-bezier(.3,1.4,.5,1)}
  @keyframes jump{
    0%{transform:translateY(0) scale(1,1)}
    12%{transform:translateY(2px) scale(1.08,.9)}
    40%{transform:translateY(-26px) scale(.95,1.06)}
    70%{transform:translateY(0) scale(1.05,.94)}
    85%{transform:translateY(-6px) scale(1,1)}
    100%{transform:translateY(0) scale(1,1)}
  }

  .pet-wrap.sleeping .pet{animation:loaf-snooze 4.5s ease-in-out infinite; transform-origin: bottom center}
  
  
  
  @keyframes loaf-snooze{
    0%,100%{transform:scaleY(1) translateY(0)}
    50%{transform:scaleY(0.96) translateY(1px)}
  }
  .zzz{position:absolute;top:-6px;right:2px;font-family:var(--font-mono);color:#7f8ea3;font-size:13px;opacity:0;pointer-events:none}
  .pet-wrap.sleeping .zzz{animation:zfloat 2.6s ease-in-out infinite; top:28px; right:12px}
  .pet-wrap.sleeping .zzz.z2{animation-delay:1.3s;font-size:10px; top:34px; right:2px}
  @keyframes zfloat{
    0%{opacity:0;transform:translateY(0)}
    30%{opacity:1}
    100%{opacity:0;transform:translateY(-20px)}
  }
  
  /* Fetch & Petting & Startle Interactions */
  .fetch-apple { position: fixed; font-size: 24px; user-select: none; pointer-events: none; animation: drop-in 0.4s cubic-bezier(0.3, 1.4, 0.5, 1); z-index: 1000; }
  @keyframes drop-in { 0% { transform: translateY(-40px) scale(0); opacity: 0; } 100% { transform: translateY(0) scale(1); opacity: 1; } }
  
  .heart { position: fixed; color: #ff4b4b; font-size: 16px; pointer-events: none; animation: float-heart 1s ease-out forwards; z-index: 100; }
  @keyframes float-heart { 0% { opacity: 0; transform: translateY(0) scale(0.5); } 20% { opacity: 1; transform: translateY(-10px) scale(1.2); } 100% { opacity: 0; transform: translateY(-30px) scale(1); } }
  
  .pet-wrap.startled .pet { animation: jump-startle 0.4s cubic-bezier(0.3, 1.4, 0.5, 1); }
  .pet-wrap.startled #frontSprite { display: flex !important; }
  .pet-wrap.startled #sleepSprite, .pet-wrap.startled #sideSprite, .pet-wrap.startled #dangleSprite { display: none !important; }
  @keyframes jump-startle { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-35px); } }

  .pet-wrap.spinning .pet{animation:spin-trick .7s cubic-bezier(.3,1.2,.5,1)}
  @keyframes spin-trick{
    0%{transform:rotate(0) translateY(0) scale(1)}
    50%{transform:rotate(180deg) translateY(-22px) scale(1.08)}
    100%{transform:rotate(360deg) translateY(0) scale(1)}
  }

  .pet-wrap.levelup .pet{animation:jump .9s cubic-bezier(.3,1.4,.5,1), glowpulse 1.4s ease}
  @keyframes glowpulse{0%,100%{filter:drop-shadow(0 8px 12px rgba(0,0,0,.5))}40%{filter:drop-shadow(0 0 22px rgba(245,165,36,.9))}}

  .spark{position:absolute;width:7px;height:7px;background:var(--amber);opacity:0;pointer-events:none}
  .pet-wrap.happy .spark{animation:sparkle .85s ease-out forwards}
  .spark.s1{top:8px;left:6px}
  .spark.s2{top:0;right:14px;animation-delay:.12s !important}
  .spark.s3{top:34px;right:-6px;animation-delay:.22s !important}
  @keyframes sparkle{0%{opacity:0;transform:scale(0) rotate(0)}40%{opacity:1;transform:scale(1.25) rotate(45deg)}100%{opacity:0;transform:scale(.4) rotate(90deg) translateY(-14px)}}

  /* (Side sprite removed; using classic front sprite waddle) */

  .xp-bar{margin-top:8px;height:8px;width:100%;max-width:118px;border-radius:99px;background:#242c37;border:1px solid var(--line);overflow:hidden}
  .xp-fill{height:100%;width:0%;background:linear-gradient(90deg,var(--amber),#ffcf6b);transition:width .6s cubic-bezier(.2,.9,.3,1)}
  .xp-label{margin-top:5px;text-align:center;font-family:var(--font-mono);font-size:10px;color:var(--dim);letter-spacing:.4px}
  .xp-label b{color:var(--amber);font-weight:700}
  
  .xp-bar, .xp-label { opacity: 0; transition: opacity .3s; pointer-events: none; }
  .pet-wrap.show-menu .xp-bar, .pet-wrap.show-menu .xp-label,
  .pet-wrap.show-xp .xp-bar, .pet-wrap.show-xp .xp-label { opacity: 1; }

  .toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);background:#f4efe4;color:#232323;font-family:var(--font-mono);font-size:12px;padding:9px 14px;border-radius:10px;opacity:0;transition:.3s;z-index:100000;box-shadow:0 10px 30px rgba(0,0,0,.5)}
  .toast.show{opacity:1;transform:translateX(-50%) translateY(0)}

  .intro{position:fixed;top:64px;right:24px;width:260px;z-index:9999;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px;font-size:12px;line-height:1.6;color:var(--dim)}
  .intro b{color:var(--text)}
  .intro ol{margin:8px 0 0 16px}
  .intro li{margin-bottom:4px}
  .intro .close{position:absolute;top:8px;right:10px;cursor:pointer;color:var(--dim);background:none;border:none;font-size:14px}
  @media (max-width:640px){.intro{display:none}}

  .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:999999;display:none;align-items:center;justify-content:center;transition:opacity .2s;}
  .modal-overlay.show{display:flex;opacity:1;pointer-events:auto;}
  .modal{background:var(--panel);border:1px solid var(--line);padding:24px;border-radius:16px;width:280px;max-height:80vh;overflow-y:auto;display:flex;flex-direction:column;gap:16px;font-family:var(--font-mono);box-shadow:0 12px 40px rgba(0,0,0,.5);transform:translateY(12px);transition:transform .2s}
  .modal-overlay.show .modal{transform:translateY(0)}
  .modal h3{font-size:16px;margin-bottom:4px;color:var(--text)}
  dialog.modal {
    margin: auto;
    color: var(--text);
    background: var(--panel);
    border: 1px solid var(--line);
    outline: none;
    box-sizing: border-box;
  }
  dialog.modal::backdrop {
    background: rgba(0,0,0,.6);
  }

  /* Templates Modal & Runner Styling (Firefox + Chromium compatible) */
  .modal.templates-modal {
    width: min(92vw, 460px);
    max-height: 85vh;
    padding: 20px;
    gap: 12px;
  }
  .templates-grid {
    scrollbar-width: thin;
    scrollbar-color: rgba(245, 165, 36, 0.3) transparent;
  }
  .templates-grid::-webkit-scrollbar {
    width: 6px;
  }
  .templates-grid::-webkit-scrollbar-thumb {
    background: rgba(245, 165, 36, 0.3);
    border-radius: 4px;
  }
  .tab-pill:hover {
    border-color: var(--amber) !important;
  }
  .template-card {
    transition: border-color .15s ease, transform .15s ease, background .15s ease;
  }
  .template-card:hover {
    border-color: var(--amber) !important;
    background: #1c232c !important;
  }
  .template-card:active {
    transform: scale(0.99) !important;
  }
  .template-live-preview {
    scrollbar-width: thin;
    scrollbar-color: rgba(245, 165, 36, 0.3) transparent;
  }
  .template-live-preview::-webkit-scrollbar {
    width: 6px;
  }
  .template-live-preview::-webkit-scrollbar-thumb {
    background: rgba(245, 165, 36, 0.3);
    border-radius: 4px;
  }
  .modal label{display:flex;flex-direction:column;gap:8px;font-size:12px;color:var(--dim)}
  .modal label .label-hint{opacity:.6;font-size:11px}
  .modal input[type="text"],.modal input[type="password"],.modal select{background:var(--bg);border:1px solid var(--line);color:var(--text);padding:8px 12px;border-radius:8px;font-family:var(--font-mono);font-size:13px;outline:none}
  .modal input[type="text"]:focus,.modal input[type="password"]:focus,.modal select:focus{border-color:var(--amber)}
  .modal input[type="range"]{accent-color:var(--amber);cursor:pointer}
  .modal button{background:var(--amber);color:#0f1318;border:none;padding:10px;border-radius:8px;font-weight:bold;cursor:pointer;margin-top:8px}
  .modal button:hover{background:#ffbb4d}
  .modal button.secondary{background:var(--panel-2);color:var(--text);border:1px solid var(--line);margin-top:0;padding:8px 12px;font-size:12px}
  .modal button.secondary:hover{background:#242c37;border-color:var(--amber)}
  .modal button.secondary:disabled{opacity:.5;cursor:default}
  .modal-divider{border:none;border-top:1px solid var(--line);margin:2px 0}
  .settings-row{display:flex;align-items:center;gap:10px}
  .test-key-status{font-size:11px;color:var(--dim)}
  .test-key-status.ok{color:#3ecf6e}
  .test-key-status.fail{color:#ff6b6b}

  @media (prefers-reduced-motion:reduce){ .pet *,.pet-wrap *{animation:none !important;transition:none !important} }
.pet-wrap.menu-left .pet-menu {
  left: auto;
  right: 100%;
}
`;
  var api2 = globalThis.browser ?? globalThis.chrome;
  var state = null;
  var petEngine = null;
  var shadowRoot = null;
  var container = null;
  var settingsView = null;
  var lastInputText = "";
  var openTemplatesHandler = null;
  async function boot() {
    if (document.getElementById("rocky-extension-host") || document.getElementById("bandit-extension-host")) return;
    state = await loadState();
    const hostname = window.location.hostname;
    if (state.disabledSites && state.disabledSites.includes(hostname)) {
      console.log(`[Bandit] disabled on ${hostname}`);
      return;
    }
    container = document.createElement("div");
    container.id = "bandit-extension-host";
    container.style.position = "fixed";
    container.style.zIndex = "2147483647";
    container.style.pointerEvents = "none";
    container.style.top = "0";
    container.style.left = "0";
    container.style.width = "100vw";
    container.style.height = "100vh";
    shadowRoot = container.attachShadow({ mode: "closed" });
    window.banditShadowRoot = shadowRoot;
    shadowRoot.addEventListener("keydown", (e) => e.stopPropagation());
    shadowRoot.addEventListener("keyup", (e) => e.stopPropagation());
    shadowRoot.addEventListener("keypress", (e) => e.stopPropagation());
    const style = document.createElement("style");
    style.textContent = TEMPLATE_CSS;
    shadowRoot.appendChild(style);
    const parser = new DOMParser();
    const doc = parser.parseFromString(TEMPLATE_HTML, "text/html");
    const rockyRoot = doc.querySelector("#rocky-root");
    const toast = doc.querySelector("#toast");
    const settingsModal = doc.querySelector("#settingsModal");
    if (rockyRoot) shadowRoot.appendChild(rockyRoot.cloneNode(true));
    if (toast) shadowRoot.appendChild(toast.cloneNode(true));
    if (settingsModal) shadowRoot.appendChild(settingsModal.cloneNode(true));
    (document.body || document.documentElement).appendChild(container);
    const rootEl = shadowRoot.getElementById("rocky-root");
    if (rootEl) rootEl.style.pointerEvents = "none";
    const wrap = shadowRoot.getElementById("petWrap");
    if (!wrap) {
      console.error("[Bandit] failed to find petWrap in template");
      return;
    }
    wrap.style.pointerEvents = "none";
    const petEl = shadowRoot.getElementById("pet");
    if (petEl) petEl.style.pointerEvents = "auto";
    const petMenuEl = shadowRoot.getElementById("petMenu");
    if (petMenuEl) petMenuEl.style.pointerEvents = "auto";
    const callbacks = {
      persist: (partial, opts) => {
        saveState(partial, opts);
        Object.assign(state, partial);
      }
    };
    petEngine = initPet(shadowRoot, state, callbacks);
    const settingsState = {
      petName: state.petName,
      xp: state.xp,
      level: state.level,
      enhanceStyle: state.enhanceStyle,
      enhanceTone: state.enhanceTone,
      askPlaceholders: state.askPlaceholders,
      customTemplates: state.customTemplates || [],
      aiSettings: {
        provider: state.provider,
        apiKey: state.apiKey,
        apiKeys: state.apiKeys,
        model: state.model,
        customModel: state.customModel,
        customInstructions: state.customInstructions
      },
      settingsSize: state.settings?.size
      // History is fetched dynamically via getter now
    };
    const openTemplates = () => {
      if (petEngine) petEngine.pokeActivity();
      showTemplatesModal({
        openRockyModal: () => createDialog(null, shadowRoot),
        stateObj: state,
        persist: callbacks.persist,
        onApply: (text, opts) => applyTemplatePrompt(text, opts),
        copyToClipboard: (text) => navigator.clipboard.writeText(text),
        showToast: (msg) => {
          if (petEngine) petEngine.showToast(msg);
        }
      });
    };
    openTemplatesHandler = openTemplates;
    const settingsCb = {
      persist: callbacks.persist,
      openTemplates,
      updateXPDisplay: () => {
        state.petName = settingsState.petName;
        state.xp = settingsState.xp;
        state.level = settingsState.level;
        petEngine.updateState({ petName: settingsState.petName, xp: settingsState.xp, level: settingsState.level });
      },
      testAIKey: async (cfg) => {
        if (!api2 || !api2.runtime) throw new Error("No extension runtime");
        return new Promise((resolve, reject) => {
          api2.runtime.sendMessage({ type: "ROCKY_AI_TEST_KEY", ...cfg }, (res) => {
            if (!res) reject(new Error("No response"));
            else if (!res.ok) reject(new Error(res.error));
            else resolve(res);
          });
        });
      },
      friendlyError: (err) => err.message || String(err),
      applyAccessories: (lv) => petEngine.updateState({ level: lv })
    };
    settingsView = initSettings(shadowRoot, settingsState, settingsCb);
    const menuCb = {
      enhancePrompt: runEnhance,
      openTemplates,
      undoEnhance: runUndo,
      runSummarize,
      pokeActivity: petEngine.pokeActivity,
      disableOnSite: (host) => {
        const disabled = state.disabledSites || [];
        if (!disabled.includes(host)) {
          disabled.push(host);
          callbacks.persist({ disabledSites: disabled }, { immediate: true });
          container.remove();
          destroy();
        }
      },
      goHome: petEngine.goHome,
      feedRocky: petEngine.feed,
      say: petEngine.say,
      showToast: petEngine.showToast,
      openRockyModal: () => createDialog(null, shadowRoot),
      timeAgo: (iso) => {
        const ms = Date.now() - new Date(iso).getTime();
        const m = Math.floor(ms / 6e4);
        if (m < 1) return "just now";
        if (m < 60) return m + "m ago";
        const h = Math.floor(m / 60);
        if (h < 24) return h + "h ago";
        return Math.floor(h / 24) + "d ago";
      },
      copyToClipboard: (text) => navigator.clipboard.writeText(text),
      persist: callbacks.persist,
      showSettings: settingsView.show,
      getHistory: () => state.history || []
    };
    bindMenuHandlers(shadowRoot, wrap, settingsState, menuCb);
    const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    if (state.lastVisitDay !== today) {
      const newStreak = (state.streak || 0) + 1;
      callbacks.persist({ lastVisitDay: today, streak: newStreak });
      setTimeout(() => {
        if (petEngine) {
          petEngine.say(`Welcome back! \u{1F43E}<br>Streak: ${newStreak} days`, 4e3);
          petEngine.playAnimation("happy", 1500);
          petEngine.addXP(5);
        }
      }, 1e3);
    }
  }
  function destroy() {
    if (petEngine && petEngine.destroy) petEngine.destroy();
    if (container) container.remove();
    container = null;
    petEngine = null;
    shadowRoot = null;
    openTemplatesHandler = null;
  }
  if (api2 && api2.runtime) {
    api2.runtime.onMessage.addListener((msg) => {
      if (msg.type === "ROCKY_CTX_ENHANCE") runEnhance();
      else if (msg.type === "ROCKY_CTX_TEMPLATES") {
        if (openTemplatesHandler) openTemplatesHandler();
      } else if (msg.type === "ROCKY_CTX_SUMMARIZE") runSummarize();
      else if (msg.type === "ROCKY_TOGGLE") {
        if (msg.disabled) {
          destroy();
        } else {
          boot();
        }
      }
    });
  }
  onStateChanged((newState) => {
    state = newState;
    if (petEngine) {
      petEngine.updateState({ xp: state.xp, level: state.level, petName: state.petName });
    }
  });
  function hasConfiguredAI() {
    if (state.apiKey && state.apiKey.trim()) return true;
    if (state.apiKeys && Object.values(state.apiKeys).some((k) => k && k.trim())) return true;
    if (typeof globalThis.ai?.languageModel !== "undefined" || typeof globalThis.LanguageModel !== "undefined") return true;
    return false;
  }
  function applyTemplatePrompt(text, { enhance = false } = {}) {
    if (petEngine) petEngine.pokeActivity();
    const input = getHostInput();
    if (input) {
      setPromptText(input, text);
      lastInputText = text;
      if (enhance) {
        if (!hasConfiguredAI()) {
          if (petEngine) {
            petEngine.say("Template inserted! \u{1F4DD}\u2728<br><small style='opacity:0.9'>Tip: Add a free Gemini key in Settings (\u2699\uFE0F) to auto-enhance with AI!</small>", 4500);
            petEngine.playAnimation("happy", 1500);
            petEngine.addXP(3);
          }
        } else {
          setTimeout(() => {
            runEnhance();
          }, 100);
        }
      } else {
        if (petEngine) {
          petEngine.say("Template inserted! \u{1F4DD}\u2728", 3e3);
          petEngine.playAnimation("happy", 1500);
          petEngine.addXP(2);
        }
      }
    } else {
      navigator.clipboard.writeText(text).then(() => {
        if (petEngine) {
          petEngine.say("No chat box found, so I copied the prompt to your clipboard! \u{1F4CB}", 4e3);
          petEngine.playAnimation("happy", 1500);
          petEngine.addXP(2);
        }
      }).catch(() => {
        if (petEngine) petEngine.say("Prompt ready! \u{1F43E}", 3e3);
      });
    }
  }
  async function runEnhance(followUpText = null) {
    petEngine.pokeActivity();
    const input = getHostInput();
    if (!input) {
      petEngine.say("I don't see any active text box to enhance! Click inside a chat box first.", 4e3);
      return;
    }
    const text = input.value || input.innerText;
    if (!text || text.trim().length < 2) {
      petEngine.say("Type a little more first! I need something to work with.", 3e3);
      return;
    }
    if (!followUpText) lastInputText = text;
    petEngine.say(followUpText ? "Refining... \u2728" : "Enhancing... \u2728", 0);
    petEngine.playAnimation("working", 99999);
    try {
      let sys = buildSystemPrompt(state.enhanceStyle, state.enhanceTone, state.customInstructions);
      if (followUpText) {
        sys += `

The user wants you to refine the prompt further with this instruction: "${followUpText}". Output ONLY the newly refined prompt.`;
      }
      const result = await aiPipeline(sys, text, {
        actionKey: "enhance",
        onChunk: (currentText) => {
          if (currentText) setPromptText(input, currentText);
        }
      });
      if (!result || !result.trim()) {
        if (lastInputText) setPromptText(input, lastInputText);
        petEngine.say("Received empty response from AI \u{1F616}", 4e3);
        return;
      }
      if (result.includes("ERROR_GIBBERISH")) {
        if (lastInputText) setPromptText(input, lastInputText);
        petEngine.say("That looks like gibberish to me! Try writing a real sentence.", 4e3);
      } else {
        setPromptText(input, result);
        petEngine.addXP(10);
        saveHistory(followUpText ? "refine" : "enhance", result);
        const beforeWords = text.trim().split(/\s+/).length;
        const afterWords = result.trim().split(/\s+/).length;
        petEngine.askForRefinement(`Done! \u2728 ${beforeWords} \u2192 ${afterWords} words<br>Need tweaks?`, (refinement) => {
          runEnhance(refinement);
        });
      }
    } catch (err) {
      if (lastInputText) setPromptText(input, lastInputText);
      const msg = err.message || String(err);
      if (msg.includes("Settings") || msg.includes("API key") || msg.includes("unavailable") || msg.includes("built-in only")) {
        petEngine.say("I need an AI key to enhance! \u{1F511}<br><small style='opacity:0.9'>Open Settings (\u2699\uFE0F) to add a free Gemini key.</small>", 5e3);
      } else {
        petEngine.say("Oops, hit a snag \u{1F616}<br>" + msg, 5e3);
      }
    } finally {
      const wrap = shadowRoot ? shadowRoot.getElementById("petWrap") : null;
      if (wrap) wrap.classList.remove("working");
    }
  }
  function runUndo() {
    if (!lastInputText) {
      petEngine.say("I don't remember what was there before! \u{1F616}", 3e3);
      return;
    }
    const input = getHostInput();
    if (!input) {
      petEngine.say("Click the text box first so I know where to undo!", 3e3);
      return;
    }
    setPromptText(input, lastInputText);
    petEngine.say("Undid that! \u21A9\uFE0F", 2e3);
  }
  async function runSummarize() {
    petEngine.pokeActivity();
    const text = scrapeConversation();
    if (!text || text.length < 50) {
      petEngine.say("I can't find a conversation here to summarize! Make sure you are on a chat page.", 4e3);
      return;
    }
    petEngine.say("Summarizing... \u{1F4CB}", 0);
    const wrap = shadowRoot.getElementById("petWrap");
    if (wrap) wrap.classList.add("working");
    try {
      const result = await aiPipeline(SUMMARIZE_SYSTEM, "Chat history:\n\n" + text.slice(-3e4), {
        actionKey: "summarize",
        onChunk: (currentText) => {
        }
      });
      saveHistory("summary", result);
      try {
        await navigator.clipboard.writeText(result);
        petEngine.say("Summary copied to clipboard! \u{1F4CB}\u2728", 4e3);
        petEngine.addXP(15);
      } catch (err) {
        const { modal, close } = createDialog(null, shadowRoot);
        const h3 = document.createElement("h3");
        h3.style.marginBottom = "8px";
        h3.textContent = "\u{1F4CB} Chat Summary";
        const p = document.createElement("p");
        p.style.cssText = "font-size:12px;margin-bottom:12px";
        p.textContent = "Copy this to continue the context in a new chat:";
        const textarea = document.createElement("textarea");
        textarea.readOnly = true;
        textarea.style.cssText = "width:100%;min-height:120px;font-family:monospace;font-size:11px;background:var(--bg);color:var(--text);padding:8px;border:1px solid var(--line);border-radius:6px;margin-bottom:12px";
        textarea.value = result;
        const btn = document.createElement("button");
        btn.id = "sm-close";
        btn.textContent = "Done";
        btn.addEventListener("click", close);
        modal.appendChild(h3);
        modal.appendChild(p);
        modal.appendChild(textarea);
        modal.appendChild(btn);
        textarea.select();
        petEngine.say("Here is your summary! \u{1F4CB}", 3e3);
        petEngine.addXP(15);
      }
    } catch (err) {
      petEngine.say("Failed to summarize \u{1F616}<br>" + (err.message || String(err)), 5e3);
    } finally {
      if (wrap) wrap.classList.remove("working");
    }
  }
  function saveHistory(type, text) {
    const history = state.history || [];
    history.unshift({ type, text, at: (/* @__PURE__ */ new Date()).toISOString() });
    if (history.length > 20) history.pop();
    state.history = history;
    saveState({ history }, { immediate: true });
  }
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "E" || e.key === "e")) {
      e.preventDefault();
      runEnhance();
    } else if (e.altKey && e.shiftKey && (e.key === "T" || e.key === "t")) {
      e.preventDefault();
      if (openTemplatesHandler) openTemplatesHandler();
    }
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
  setInterval(() => {
    if (!document.getElementById("bandit-extension-host")) {
      if (state && state.disabledSites && state.disabledSites.includes(window.location.hostname)) return;
      boot();
    }
  }, 2e3);
})();
