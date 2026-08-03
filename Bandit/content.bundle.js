(() => {
const BanditEnv = {};
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

// --- START: ai/prompts.js ---
// System prompts shared by both AI features. Kept separate from pipeline.js
// so the prompts themselves are easy to find and tweak without touching logic.
//
// Design notes (why these prompts look like this):
//  - Role + objective first: models follow persona-anchored instructions best.
//  - Explicit silent process: "analyze, then write" beats "rewrite" alone.
//  - Few-shot anchor: one tiny input→output example pins the format harder
//    than any amount of description (and kills placeholder-spam, the observed
//    failure mode where the model bracketed random words like "[create/use]").
//  - Hard negative rules: models need "never do X" stated explicitly.
//  - Output discipline last: the final instruction is the one obeyed most.
//  - ABSOLUTE OUTPUT RULES: enforces minimum response quality so models never
//    return a single word, echo the input, or produce placeholder-heavy output.
(function (root) {

  const ENHANCE_CORE = `You are an elite prompt engineer. Your job is to take a user's rough, lazy, or incomplete thought and transform it into a masterclass prompt that will force any AI (ChatGPT, Claude, etc.) to produce excellent, specific output.

A great prompt MUST include:
1. PERSONA: "Act as a world-class expert in [Domain]..."
2. OBJECTIVE: A crystal clear, undeniable goal.
3. CONSTRAINTS: Hard negative rules (e.g., "Do not use AI clichés like 'delve', 'crucial', or 'tapestry'", "Do not hallucinate imports", etc.).
4. REASONING: A trigger for chain-of-thought (e.g., "Think step-by-step before answering" or "Analyze the request first").

Rules for you:
- Preserve the user's core intent exactly. Do not invent new features or topics they didn't ask for.
- If the input is complete gibberish (random letters with no meaning), output EXACTLY: ERROR_GIBBERISH
- NEVER insert [bracketed placeholders]. Instead, make reasonable assumptions based on context. For example, if the user says "write a blog", assume a general audience — do NOT write "[target audience]".
- Never write "The user wants". Write the prompt DIRECTLY to the AI as if it's instructions.

ABSOLUTE OUTPUT RULES (violating these is a critical failure):
- Your output MUST be at least 40 words. NEVER output a single word, a single sentence, or a short reply.
- NEVER echo or repeat the user's input back. Transform it — don't parrot it.
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

  const ENHANCE_STRUCTURED = ENHANCE_CORE + `

Rewrite the user's prompt into a highly structured, professional format exactly like the example: **Role**, **Objective**, **Context**, **Rules & Constraints** (bulleted), **Formatting**, and **Process**. Make it incredibly potent. Between 80-200 words. Output ONLY the rewritten prompt — no preamble, no commentary, no "Here is your prompt".`;

  const ENHANCE_CONCISE = ENHANCE_CORE + `

Rewrite the user's prompt as a single, devastatingly effective paragraph. It must still establish an expert persona, the exact goal, and at least 2 hard negative constraints to prevent generic AI output. End with a chain-of-thought trigger. Between 40-75 words. Output ONLY the rewritten prompt — no preamble, no commentary.`;

  const ENHANCE_DETAILED = ENHANCE_CORE + `

Rewrite the user's prompt into an ultimate, comprehensive master-spec. Include: **Role**, **Objective**, **Deep Context**, **Strict Constraints** (at least 5 hard rules), **Edge Cases / Pitfalls to Avoid**, **Output Format**, and a mandatory **Step-by-Step Reasoning Phase**. This prompt should guarantee a flawless zero-shot response from any LLM. Between 150-350 words. Output ONLY the rewritten prompt — no preamble, no commentary.`;

  const ENHANCE_SYSTEMS = {
    structured: ENHANCE_STRUCTURED,
    concise: ENHANCE_CONCISE,
    detailed: ENHANCE_DETAILED,
  };

  const SUMMARIZE_SYSTEM = `You are an expert scribe. Summarize this AI chat session into a context brief the user will paste into a NEW chat so the next AI can continue the work without re-asking anything.

Rules:
- Only facts stated in the chat. Never infer, never invent, never embellish.
- Prefer specifics (names, decisions, exact requirements) over generalities.
- If a section has nothing, write exactly "(none stated)".
- Your output MUST be at least 30 words. Never output a single word or single sentence.

Format — five sections, under 250 words total:
PROJECT: what is being worked on, one or two sentences.
CONTEXT / TOOLS: the specific tools, frameworks, or context required.
DECISIONS: choices made and, if stated, why.
CURRENT STATE: what works, what was just finished, what's in progress.
OPEN QUESTIONS: unresolved issues, known bugs, next steps.

Output only the brief — no preamble, no commentary.`;

  // --- TONE MODIFIERS ---
  // These are layered ON TOP of the style (structured/concise/detailed) to
  // control the voice and personality of the output without changing its shape.
  const TONE_MODIFIERS = {
    professional: '', // default — no modifier needed, the base prompts are already professional
    casual: `\n\nTONE OVERRIDE: Write the enhanced prompt in a casual, friendly, conversational tone. Use contractions, informal phrasing, and a warm approachable voice. Avoid stiff corporate language. The prompt should still be effective — just not stuffy.`,
    academic: `\n\nTONE OVERRIDE: Write the enhanced prompt in a formal academic tone. Use precise terminology, structured argumentation, and scholarly phrasing. Reference established methodologies where appropriate. The prompt should read like instructions from a professor or research advisor.`,
    creative: `\n\nTONE OVERRIDE: Write the enhanced prompt in a vivid, imaginative, boundary-pushing tone. Use rich metaphors, bold phrasing, and creative language that inspires the AI to think outside the box. The prompt should feel like it came from a visionary creative director.`,
  };

  // Combines a style template with a tone modifier. Used by the pipeline.
  function buildSystemPrompt(style, tone) {
    const base = ENHANCE_SYSTEMS[style] || ENHANCE_STRUCTURED;
    const modifier = TONE_MODIFIERS[tone] || '';
    return base + modifier;
  }

  // ENHANCE_SYSTEM kept as an alias for the default style (back-compat).
  root.RockyPrompts = { ENHANCE_SYSTEM: ENHANCE_STRUCTURED, ENHANCE_SYSTEMS, TONE_MODIFIERS, buildSystemPrompt, SUMMARIZE_SYSTEM };
})((typeof window !== 'undefined' ? window : globalThis));

// --- END: ai/prompts.js ---

// --- START: ai/pipeline.js ---
// rockyAIPipeline(systemPrompt, userText, opts) — the ONLY entry point for
// Rocky's AI features (Enhance + Summarize both call this, nothing else).
//
// Order:
//   1. IF the user has no BYOK keys (builtin-only mode), try Chrome's on-device
//      Prompt API (Gemini Nano) — free, on-device, no key.
//   2. Otherwise, go STRAIGHT to the background service worker which holds the
//      user's BYOK provider + key. Skipping Nano entirely when the user has
//      configured cloud keys makes Bandit 5–30 seconds faster per call.
//
// Each action (Enhance, Summarize) is rate-limited to once per 3s
// independently. Prompt text and API keys are never logged, even in debug
// mode — debug mode (localStorage.rocky_debug === "1", set per-site in
// DevTools) only logs which provider handled a call and how long it took.
(function (root) {
  const RATE_LIMIT_MS = 3000;
  const NANO_TIMEOUT_MS = 15000; // 15s — was 30s, too slow for users who expect instant

  function isDebugEnabled() {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem('rocky_debug') === '1';
    } catch (err) {
      return false;
    }
  }

  function debugLog(...args) {
    if (isDebugEnabled()) console.log('[Rocky AI]', ...args);
  }



  // Tries the on-device model. Returns the generated string, or null if Nano
  // isn't available/usable here — callers fall back to BYOK on null.
  async function tryNano(systemPrompt, userText, onProgress) {
    const lm = globalThis.ai?.languageModel || globalThis.LanguageModel;
    if (typeof lm === 'undefined') {
      debugLog('LanguageModel global not present in this browser');
      return null;
    }

    let availability;
    try {
      availability = await lm.availability();
    } catch (err) {
      debugLog('availability() threw', err && err.message);
      return null;
    }
    if (availability === 'unavailable') {
      debugLog('Nano unavailable on this device');
      return null;
    }

    let session = null;
    try {
      const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(NANO_TIMEOUT_MS) : undefined;
      session = await lm.create({
        signal,
        initialPrompts: [{ role: 'system', content: systemPrompt }],
        monitor(m) {
          try {
            m.addEventListener('downloadprogress', (e) => {
              if (onProgress) onProgress(typeof e.loaded === 'number' ? e.loaded : 0);
            });
          } catch (err) {
            debugLog('monitor() not supported', err && err.message);
          }
        },
      });

      const promptSignal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(NANO_TIMEOUT_MS) : undefined;
      const result = await session.prompt(userText, { signal: promptSignal });
      const text = typeof result === 'string' ? result.trim() : '';
      return text || null;
    } catch (err) {
      debugLog('Nano generation failed, falling back to BYOK', err && err.message);
      return null;
    } finally {
      try { if (session && typeof session.destroy === 'function') session.destroy(); } catch (err) { /* noop */ }
    }
  }

  function callBackgroundWorker(systemPrompt, userText, debug) {
    const api = globalThis.browser ?? globalThis.chrome;
    return new Promise((resolve, reject) => {
      try {
        if (!api || !api.runtime || !api.runtime.sendMessage) {
          reject(new Error('extension messaging unavailable here'));
          return;
        }
        api.runtime.sendMessage(
          { type: 'ROCKY_AI_CALL', systemPrompt, userText, debug },
          (response) => {
            const lastErr = api.runtime.lastError;
            if (lastErr) { reject(new Error(lastErr.message)); return; }
            if (!response) { reject(new Error("no response from Rocky's background worker")); return; }
            if (!response.ok) { reject(new Error(response.error || 'AI call failed')); return; }
            resolve(response); // { ok, text, provider }
          }
        );
      } catch (err) {
        reject(err);
      }
    });
  }

  // Check if the user has ANY BYOK keys configured (not just the active provider).
  // If they do, we skip Nano entirely for speed.
  async function getUserAIConfig() {
    try {
      if (!root.RockyStorage) return { provider: 'builtin', hasBYOK: false };
      const state = await root.RockyStorage.loadState();
      const provider = state.provider || 'builtin';
      const hasBYOK = (state.apiKey && state.apiKey.trim()) ||
        (state.apiKeys && Object.values(state.apiKeys).some(k => k && k.trim()));
      return { provider, hasBYOK: !!hasBYOK };
    } catch (err) {
      return { provider: 'builtin', hasBYOK: false };
    }
  }

  const lastCallAtByAction = Object.create(null);

  // opts.actionKey scopes the 3s rate limit per action ('enhance',
  // 'summarize', ...) so using one doesn't block the other. opts.onProgress
  // is an optional Nano-download progress callback (0..1).
  async function rockyAIPipeline(systemPrompt, userText, opts) {
    opts = opts || {};
    const actionKey = opts.actionKey || 'default';
    const debug = isDebugEnabled();
    const startedAt = Date.now();

    const now = Date.now();
    if (now - (lastCallAtByAction[actionKey] || 0) < RATE_LIMIT_MS) {
      throw new Error('slow down — try again in a moment');
    }
    lastCallAtByAction[actionKey] = now;

    const config = await getUserAIConfig();

    // SPEED OPTIMIZATION: Only try Nano if the user has NO cloud keys.
    // When the user has BYOK configured, Nano is skipped entirely — this
    // saves 5–30 seconds of wasted time trying (and failing) the on-device
    // model before falling back to the cloud provider the user actually wants.
    if (!config.hasBYOK) {
      let nanoResult = null;
      try {
        nanoResult = await tryNano(systemPrompt, userText, opts.onProgress);
      } catch (err) {
        debugLog('tryNano threw unexpectedly', err && err.message);
        nanoResult = null;
      }
      if (nanoResult) {
        if (debug) console.log('[Bandit AI]', 'action=' + actionKey, 'provider=nano', (Date.now() - startedAt) + 'ms');
        return nanoResult;
      }

      // No BYOK and Nano failed — nothing left to try
      if (config.provider === 'builtin') {
        throw new Error('on-device AI is unavailable right now, and "built-in only" is selected');
      }
    }

    const response = await callBackgroundWorker(systemPrompt, userText, debug);
    if (debug) console.log('[Bandit AI]', 'action=' + actionKey, 'provider=' + response.provider, (Date.now() - startedAt) + 'ms');
    return response.text;
  }

  root.rockyAIPipeline = rockyAIPipeline;
})((typeof window !== 'undefined' ? window : globalThis));

// --- END: ai/pipeline.js ---

// --- START: ui/template.js (compiled) ---
BanditEnv.BanditTemplate = { html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bandit — AI Prompt Companion</title>
  <link rel="stylesheet" href="styles.css">

</head>
<body>

<div class="app">
  <div class="topbar">
    <div class="logo"></div>
    <b>VibeBuild</b><span>— untitled-project-7</span>
    <span class="demo-tag">DEMO · Bandit Desktop Pet 🐾</span>
  </div>
  <div class="stage">
    <div id="rocky-root">
  <div class="pet-wrap" id="petWrap">
    <div class="bubble" id="bubble"></div>
    <div class="pet-menu" id="petMenu">
      <button id="menuEnhance">✨ Enhance Prompt</button>
      <button id="menuUndo">↩️ Undo</button>
      <button id="menuSummarize">📋 Summarize Chat</button>
      <button id="menuDisable">🚫 Disable on this site</button>
      <button id="menuSettings">⚙️ Settings</button>
      <button id="menuMore">➕ More...</button>
      <div id="menuExtra" style="display: none; flex-direction: column; gap: 4px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 4px;">
        <button id="menuHistory">📜 History</button>
        <button id="menuHome">🏠 Go Home (Corner)</button>
        <button id="menuFeed">🍪 Feed Bandit</button>
      </div>
    </div>
    <div class="emote" id="startleEmote" style="display:none;position:absolute;top:-10px;font-size:28px;z-index:10;animation:pop .3s cubic-bezier(.3,1.4,.5,1)">❗️</div>
    <div class="pet" id="pet">
      <span class="zzz">z</span><span class="zzz z2">z</span>
      <span class="spark s1"></span><span class="spark s2"></span><span class="spark s3"></span>
      <div class="sprite" id="frontSprite"><svg viewBox="0 0 32 32" id="frontSvg"></svg></div>
      
      
      
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<div class="modal-overlay" id="settingsModal">
  <div class="modal">
    <h3>Bandit Settings</h3>
    
    <div class="xp-bar" style="opacity:1; transform:none; pointer-events:auto; margin:0 0 4px 0; width:100%; max-width:none; background:#0f1318;"><div class="xp-fill" id="xpFill"></div></div>
    <div class="xp-label" id="xpLabel" style="opacity:1; transform:none; pointer-events:auto; margin-bottom:16px;">BANDIT · <b>LVL 1</b> · 0/20 XP</div>

    <label>
      Name
      <input type="text" id="settingName" value="Bandit" autocomplete="off" spellcheck="false" maxlength="32">
    </label>
    <label>
      Size (<span id="sizeValue">100%</span>)
      <input type="range" id="settingSize" min="0.5" max="2" step="0.1" value="1">
    </label>

    <hr class="modal-divider">

    <label style="flex-direction:row;align-items:center;gap:8px;cursor:pointer">
      <input type="checkbox" id="settingAskPlaceholders" style="accent-color:#f5a524">
      Ask me to fill in [placeholders] after Enhance <span class="label-hint">(advanced)</span>
    </label>

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
        <option value="professional">🏢 Professional (default)</option>
        <option value="casual">💬 Casual & Friendly</option>
        <option value="academic">🎓 Academic & Scholarly</option>
        <option value="creative">🎨 Creative & Bold</option>
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
        <option value="builtin">Use built-in Chrome AI only (no key)</option>
      </select>
    </label>
    <label>
      API Key
      <span class="label-hint" id="apiKeyHint">
        <a id="getApiKeyLink" href="#" target="_blank" style="color: #64b5f6;">Get your API key here 🔗</a>
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

    <div style="text-align: center; margin-top: 4px;">
      <a href="https://github.com/manishankar0922/Bandit/blob/main/PRIVACY.md" target="_blank" style="font-size: 11px; color: var(--dim); text-decoration: underline;">Privacy Policy</a>
    </div>

    <hr class="modal-divider">

    <div style="display: flex; gap: 8px; justify-content: center;">
      <button id="exportSettings" type="button" class="secondary" style="font-size: 11px;">💾 Export Backup</button>
      <button id="importSettings" type="button" class="secondary" style="font-size: 11px;">📂 Import Backup</button>
    </div>
    <span id="backupStatus" style="font-size: 11px; color: var(--green); text-align: center; display: block;"></span>

    <button id="closeSettings">Save & Close</button>
  </div>
</div>

<script src="storage.js"></script>
<script src="ai/prompts.js"></script>
<script src="ai/pipeline.js"></script>


<script src="ui/injector.js"></script>
<script src="ui/modals.js"></script>
<script src="ui/popup.js"></script>
<script src="pet/core.js"></script>
<script src="demo.js"></script>

</body>
</html>
`, css: `:root,:host{
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
    position:fixed;z-index:2147483647;right:32px;bottom:110px;
    user-select:none;-webkit-user-select:none;touch-action:none;
    will-change: transform, left, top;
  }
  .pet-wrap{position:relative;cursor:grab;display:flex;flex-direction:column;align-items:center}
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

  .pet-menu{position:absolute;top:10px;left:100%;padding-left:12px;display:flex;flex-direction:column;gap:6px;opacity:0;pointer-events:none;transform:translateX(-6px);transition:opacity .25s .1s,transform .25s .1s;z-index:2}
  .pet-wrap.show-menu .pet-menu{opacity:1;pointer-events:auto;transform:translateX(0);transition:opacity .2s,transform .2s}
  .pet-menu button{background:#1d242e;color:var(--text);border:1px solid var(--line);font-family:var(--font-mono);font-size:12px;padding:8px 12px;border-radius:8px;cursor:pointer;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,.3)}
  .pet-menu button:hover{border-color:var(--amber);color:var(--amber);background:#242c37}

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
  }
  dialog.modal::backdrop {
    background: rgba(0,0,0,.6);
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
` };
// --- END: ui/template.js ---

// --- START: ui/injector.js ---
(function(root) {
  function getDeepActiveElement() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) {
      el = el.shadowRoot.activeElement;
    }
    return el;
  }

  function getHostInput() {
    const active = getDeepActiveElement();
    if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.isContentEditable)) {
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
      if (area > bestArea) { bestArea = area; best = el; }
    }
    return best;
  }

  function simulatePaste(el, text) {
    el.focus();

    // The most robust way to replace text in modern web apps (React, ProseMirror, etc)
    // is using execCommand, as it natively triggers all internal framework events.
    if (el.isContentEditable) {
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
    } else {
      el.select();
      const success = document.execCommand('insertText', false, text);
      
      // Fallback for extremely stubborn inputs if execCommand fails
      if (!success) {
        const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        const nativeTextareaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (el.tagName === 'INPUT' && nativeInputSetter) nativeInputSetter.call(el, text);
        else if (el.tagName === 'TEXTAREA' && nativeTextareaSetter) nativeTextareaSetter.call(el, text);
        else el.value = text;

        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }

  function setPromptText(hostInput, text) {
    hostInput.focus();
    simulatePaste(hostInput, text);
  }

  root.BanditInjector = { getHostInput, setPromptText };
})((typeof window !== 'undefined' ? window : globalThis));

// --- END: ui/injector.js ---

// --- START: ui/modals.js ---
(function(root) {
  // container: where to append the <dialog>. Pass the Shadow Root so the dialog
  // inherits the extension's CSS (injected into the shadow). Falls back to
  // document.body in demo / standalone mode where there is no shadow root.
  function createDialog(onClose, container) {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal';

    // In modern browsers, clicking the backdrop of a <dialog> fires the click event
    // on the dialog itself. If the click coordinates are outside the dialog's rect,
    // we consider it a backdrop click and close it.
    dialog.addEventListener('click', (e) => {
      const rect = dialog.getBoundingClientRect();
      const inDialog = (
        rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX && e.clientX <= rect.left + rect.width
      );
      if (!inDialog) {
        dialog.close();
      }
    });

    let closed = false;
    dialog.addEventListener('close', () => {
      if (closed) return;
      closed = true;
      dialog.remove();
      if (onClose) onClose();
    });

    // Append inside the shadow root so the dialog inherits the extension's
    // injected CSS. Fall back to document.body for the standalone demo page.
    const host = container || document.body;
    host.appendChild(dialog);
    return {
      modal: dialog,
      show: () => dialog.showModal(),
      close: () => dialog.close()
    };
  }

  root.BanditModals = { createDialog };
})((typeof window !== 'undefined' ? window : globalThis));

// --- END: ui/modals.js ---

// --- START: ui/popup.js ---
(function(root) {
  root.BanditPopup = {
    showHistoryModal: function({
      copyHistory, openRockyModal, timeAgo, copyToClipboard, showToast, persist, onClear
    }) {
      const { modal, close } = openRockyModal();

      const h = document.createElement('h3');
      h.textContent = '📜 History';
      modal.appendChild(h);

      if (!copyHistory.length) {
        const empty = document.createElement('div');
        empty.style.cssText = 'font-size:12px;color:#8a95a5;line-height:1.6';
        empty.textContent = 'Nothing here yet — enhance a prompt or summarize a chat, and it lands here for re-copying.';
        modal.appendChild(empty);
      } else {
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'secondary';
        clearBtn.style.cssText = 'font-size:11px;opacity:.7;margin-top:4px';
        clearBtn.textContent = '🗑 Clear history';
        clearBtn.addEventListener('click', () => {
          if (onClear) onClear();
          persist({ history: [] });
          close();
          showToast('history cleared');
        });
        modal.appendChild(clearBtn);
      }

      copyHistory.forEach(item => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'secondary';
        row.style.cssText = 'text-align:left;white-space:normal;line-height:1.5;display:block;width:100%';
        const icon = item.type === 'summary' ? '📋' : '✨';
        const preview = item.text.length > 90 ? item.text.slice(0, 90) + '…' : item.text;
        const meta = document.createElement('div');
        meta.style.cssText = 'font-size:10px;opacity:.6;margin-bottom:3px';
        meta.textContent = `${icon} ${item.type} · ${timeAgo(item.at)} · click to copy`;
        const body = document.createElement('div');
        body.textContent = preview;
        row.appendChild(meta);
        row.appendChild(body);
        row.addEventListener('click', () => {
          copyToClipboard(item.text)
            .then(() => { showToast('copied 📋'); close(); })
            .catch(() => { showToast("couldn't copy 😖"); });
        });
        modal.appendChild(row);
      });

      const done = document.createElement('button');
      done.type = 'button';
      done.textContent = 'Close';
      done.addEventListener('click', close);
      modal.appendChild(done);
    }
  };
})((typeof window !== 'undefined' ? window : globalThis));

// --- END: ui/popup.js ---

// --- START: ui/settings.js ---
BanditEnv.initSettings = function() {
  settingsModal = doc.getElementById('settingsModal');
  settingName = doc.getElementById('settingName');
  settingSize = doc.getElementById('settingSize');
  sizeValue = doc.getElementById('sizeValue');
  settingProvider = doc.getElementById('settingProvider');
  settingApiKey = doc.getElementById('settingApiKey');
  settingModel = doc.getElementById('settingModel');
  settingStyle = doc.getElementById('settingStyle');
  settingTone = doc.getElementById('settingTone');
  settingAskPlaceholders = doc.getElementById('settingAskPlaceholders');
  testApiKeyBtn = doc.getElementById('testApiKey');
  testApiKeyStatus = doc.getElementById('testApiKeyStatus');
  exportBtn = doc.getElementById('exportSettings');
  importBtn = doc.getElementById('importSettings');
  backupStatus = doc.getElementById('backupStatus');

  getApiKeyLink = doc.getElementById('getApiKeyLink');

  API_LINKS = {
    anthropic: 'https://console.anthropic.com/settings/keys',
    openai: 'https://platform.openai.com/api-keys',
    gemini: 'https://aistudio.google.com/app/apikey',
    groq: 'https://console.groq.com/keys',
    nvidia: 'https://build.nvidia.com/explore/discover'
  };

  function updateApiKeyLink(provider) {
    if (!getApiKeyLink) return;
    if (provider === 'builtin') {
      getApiKeyLink.style.display = 'none';
    } else {
      getApiKeyLink.style.display = 'inline';
      getApiKeyLink.href = API_LINKS[provider] || '#';
    }
  }

  menuSettings = doc.getElementById('menuSettings');
  if (menuSettings) menuSettings.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    wrap.classList.remove('show-menu');
    if (settingProvider) {
      settingProvider.value = aiSettings.provider || 'builtin';
      updateApiKeyLink(settingProvider.value);
    }
    // Hydrate the key field from the per-provider map first, falling back to legacy flat field
    if (settingApiKey) settingApiKey.value = (aiSettings.apiKeys && aiSettings.apiKeys[aiSettings.provider]) || aiSettings.apiKey || '';
    if (settingModel) settingModel.value = aiSettings.model || '';
    if (settingStyle) settingStyle.value = enhanceStyle;
    if (settingTone) settingTone.value = enhanceTone;
    if (settingAskPlaceholders) settingAskPlaceholders.checked = askPlaceholders;
    if (testApiKeyStatus) { testApiKeyStatus.textContent = ''; testApiKeyStatus.className = 'test-key-status'; }
    if (settingsModal) settingsModal.classList.add('show');
  });

  if (settingApiKey) settingApiKey.addEventListener('input', () => {
    const detected = BanditEnv.detectProviderFromKey(settingApiKey.value);
    if (detected && settingProvider) settingProvider.value = detected;
  });

  // Switching provider swaps the key field to that provider's saved key,
  // so users can stash one key per provider (fuels the failover chain).
  currentSettingsProvider = aiSettings.provider || 'builtin';
  if (settingProvider) {
    currentSettingsProvider = settingProvider.value;
    settingProvider.addEventListener('change', () => {
      updateApiKeyLink(settingProvider.value);
      // load the specific key if present
      if (settingApiKey) settingApiKey.value = aiSettings.apiKeys[settingProvider.value] || '';
      // Save the typed key to the OLD provider before swapping to the new one
      if (currentSettingsProvider !== 'builtin') {
        aiSettings.apiKeys[currentSettingsProvider] = settingApiKey ? settingApiKey.value.trim() : '';
      }
      currentSettingsProvider = settingProvider.value;
      if (settingApiKey) settingApiKey.value = aiSettings.apiKeys[currentSettingsProvider] || '';
    });
  }

  resetDisabledSites = doc.getElementById('resetDisabledSites');
  resetDisabledStatus = doc.getElementById('resetDisabledStatus');
  if (resetDisabledSites) {
    resetDisabledSites.addEventListener('click', () => {
      persist({ disabledSites: [] }, { immediate: true });
      if (resetDisabledStatus) {
        resetDisabledStatus.textContent = 'Cleared!';
        setTimeout(() => { resetDisabledStatus.textContent = ''; }, 2000);
      }
    });
  }

  function saveSettings() {
    petName = (settingName ? settingName.value.trim() : petName) || 'Bandit';
    updateXPDisplay();

    const chosenProvider = settingProvider ? (settingProvider.value || 'builtin') : aiSettings.provider;
    const enteredKey = settingApiKey ? settingApiKey.value.trim() : aiSettings.apiKey;
    const newApiKeys = { ...aiSettings.apiKeys };
    if (chosenProvider !== 'builtin') newApiKeys[chosenProvider] = enteredKey; // '' clears that slot
    aiSettings = {
      provider: chosenProvider,
      apiKey: enteredKey,
      model: settingModel ? settingModel.value.trim() : aiSettings.model,
      apiKeys: newApiKeys,
    };
    if (settingStyle) enhanceStyle = settingStyle.value || 'structured';
    if (settingTone) enhanceTone = settingTone.value || 'professional';
    if (settingAskPlaceholders) askPlaceholders = settingAskPlaceholders.checked;
    persist({ petName, provider: aiSettings.provider, apiKey: aiSettings.apiKey, model: aiSettings.model, apiKeys: newApiKeys, enhanceStyle, enhanceTone, askPlaceholders });
  }

  if (settingName) settingName.addEventListener('input', saveSettings);
  if (settingApiKey) settingApiKey.addEventListener('input', saveSettings);
  if (settingProvider) settingProvider.addEventListener('change', saveSettings);
  if (settingModel) settingModel.addEventListener('input', saveSettings);
  if (settingStyle) settingStyle.addEventListener('change', saveSettings);
  if (settingTone) settingTone.addEventListener('change', saveSettings);
  if (settingAskPlaceholders) settingAskPlaceholders.addEventListener('change', saveSettings);

  closeSettings = doc.getElementById('closeSettings');
  if (closeSettings) closeSettings.addEventListener('click', () => {
    if (settingsModal) settingsModal.classList.remove('show');
    saveSettings();
  });

  // --- EXPORT / IMPORT BACKUP ---
  if (exportBtn) exportBtn.addEventListener('click', () => {
    try {
      const state = {
        petName, xp, level, enhanceStyle, enhanceTone, askPlaceholders,
        provider: aiSettings.provider, apiKeys: aiSettings.apiKeys,
        model: aiSettings.model, history: copyHistory,
        _banditBackup: true, _exportedAt: new Date().toISOString(),
      };
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bandit-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      if (backupStatus) { backupStatus.textContent = 'Backup exported! ✅'; setTimeout(() => { backupStatus.textContent = ''; }, 3000); }
    } catch (err) {
      if (backupStatus) { backupStatus.textContent = 'Export failed ❌'; backupStatus.style.color = '#f44'; setTimeout(() => { backupStatus.textContent = ''; backupStatus.style.color = ''; }, 3000); }
    }
  });

  if (importBtn) importBtn.addEventListener('click', () => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!data._banditBackup) throw new Error('Not a Bandit backup file');
          // Restore state
          if (data.petName) { petName = data.petName; if (settingName) settingName.value = petName; }
          if (typeof data.xp === 'number') { xp = data.xp; }
          if (typeof data.level === 'number') { level = data.level; }
          if (data.enhanceStyle) { enhanceStyle = data.enhanceStyle; if (settingStyle) settingStyle.value = enhanceStyle; }
          if (data.enhanceTone) { enhanceTone = data.enhanceTone; if (settingTone) settingTone.value = enhanceTone; }
          if (typeof data.askPlaceholders === 'boolean') { askPlaceholders = data.askPlaceholders; if (settingAskPlaceholders) settingAskPlaceholders.checked = askPlaceholders; }
          if (data.provider) { aiSettings.provider = data.provider; if (settingProvider) settingProvider.value = data.provider; }
          if (data.apiKeys && typeof data.apiKeys === 'object') { aiSettings.apiKeys = data.apiKeys; if (settingApiKey) settingApiKey.value = data.apiKeys[data.provider] || ''; }
          if (data.model) { aiSettings.model = data.model; if (settingModel) settingModel.value = data.model; }
          if (Array.isArray(data.history)) { copyHistory = data.history; }
          updateXPDisplay();
          persist({ petName, xp, level, enhanceStyle, enhanceTone, askPlaceholders, provider: aiSettings.provider, apiKey: aiSettings.apiKey, model: aiSettings.model, apiKeys: aiSettings.apiKeys, history: copyHistory }, { immediate: true });
          if (backupStatus) { backupStatus.textContent = 'Backup restored! 🎉'; setTimeout(() => { backupStatus.textContent = ''; }, 3000); }
        } catch (err) {
          if (backupStatus) { backupStatus.textContent = 'Invalid backup file ❌'; backupStatus.style.color = '#f44'; setTimeout(() => { backupStatus.textContent = ''; backupStatus.style.color = ''; }, 3000); }
        }
      };
      reader.readAsText(file);
    });
    fileInput.click();
  });

  if (settingSize) settingSize.addEventListener('input', e => {
    const s = e.target.value;
    if (sizeValue) sizeValue.textContent = Math.round(s * 100) + '%';
    wrap.style.setProperty('--pet-scale', s);
    persist({ settings: { size: parseFloat(s) } });
  });

  if (testApiKeyBtn) testApiKeyBtn.addEventListener('click', () => {
    const provider = settingProvider ? settingProvider.value : 'builtin';
    if (provider === 'builtin') {
      if (testApiKeyStatus) { testApiKeyStatus.textContent = 'built-in AI needs no key ✓'; testApiKeyStatus.className = 'test-key-status ok'; }
      return;
    }
    const testSettings = {
      provider,
      apiKey: settingApiKey ? settingApiKey.value.trim() : '',
      model: settingModel ? settingModel.value.trim() : '',
    };
    if (!testSettings.apiKey) {
      if (testApiKeyStatus) { testApiKeyStatus.textContent = 'paste a key first'; testApiKeyStatus.className = 'test-key-status fail'; }
      return;
    }
    if (testApiKeyStatus) { testApiKeyStatus.textContent = 'testing…'; testApiKeyStatus.className = 'test-key-status'; }
    testApiKeyBtn.disabled = true;

    testAIKey(testSettings)
      .then(res => {
        if (testApiKeyStatus) { testApiKeyStatus.textContent = `✓ ${res.provider} key works`; testApiKeyStatus.className = 'test-key-status ok'; }
      })
      .catch(err => {
        if (testApiKeyStatus) { testApiKeyStatus.textContent = `✗ ${friendlyError(err)}`; testApiKeyStatus.className = 'test-key-status fail'; }
      })
      .finally(() => {
        testApiKeyBtn.disabled = false;
      });
  });
};

// --- END: ui/settings.js ---

// --- START: ui/history.js ---
BanditEnv.initHistory = function() {
  function timeAgo(t) {
    const s = Math.max(1, Math.round((Date.now() - t) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }

  menuHistory = doc.getElementById('menuHistory');
  if (menuHistory) {
    menuHistory.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      wrap.classList.remove('show-menu');
      pokeActivity();
      if (window.BanditPopup) {
        window.BanditPopup.showHistoryModal({
          copyHistory,
          openRockyModal,
          timeAgo,
          copyToClipboard,
          showToast,
          persist,
          onClear: () => { copyHistory = []; }
        });
      }
    });
  }
};

// --- END: ui/history.js ---

// --- START: pet/shared.js ---
// Shared variables across all Bandit modules
var doc, docBody, abortController, signal, cleanupTasks, shadowHost;
var rockyDefaults, hydrated, persist, rockyApi, testAIKey, detectProviderFromKey, escapeHTML, friendlyError, copyToClipboard;
var NS, group, setSafeSvg, frontSvg, fTailG, fBodyG, fEarsG, fBodyRectsG, fEyesG, fAccG, overlay, eyesOpen, eyesClosed, eyesHappy, applyAccessories;
var wrap, root, pet, bubble, input, box, hint, xpFill, xpLabel, toast, messages;
var state, xp, level, petName, lastFedAt, aiSettings, enhanceStyle, enhanceTone, askPlaceholders, lastEnhance, copyHistory;
var currentVersion, lastSeenVersion, updateMessageCount, FEED_COOLDOWN_MS, LEVELS, lastActivity, alertShown, runAnim, isHovering;
var setState, say, showToast, sayThinking, stopThinking, blinkTimer, isFetching, fetchTimer, pokeActivity, sleepInterval;
var startRun, runInterval, stopRun, idleLines, chatterInterval, PLACEHOLDER_SUGGESTIONS, suggestionsFor, extractPlaceholders;
var openRockyModal, askPlaceholderValues, enhancePrompt, updateXPDisplay, gainXP, getClosest, clampToViewport, reclampToViewport;
var drag, spinTimer, lastTap, petDistance, lastHeartTime, spawnHeart, lastEyeMove, eyesFollowCursor, lastPointerCheck;
var timeAgo, runSummarize, eatApple, SNACKS, spawnFeedTreat, showFeedCooldown, feedRocky, initialRaf;
var settingsModal, settingName, settingSize, sizeValue, settingProvider, settingApiKey, settingModel, settingStyle, settingTone, settingAskPlaceholders;
var testApiKeyBtn, testApiKeyStatus, exportBtn, importBtn, backupStatus, getApiKeyLink, API_LINKS, updateApiKeyLink, currentSettingsProvider, applyRemoteState;

BanditEnv.initRocky = function(savedState) {
    if (BanditEnv.initBanditState) BanditEnv.initBanditState(savedState);
    if (BanditEnv.initBanditAnimations) BanditEnv.initBanditAnimations();
    if (BanditEnv.initBanditDrag) BanditEnv.initBanditDrag();
    if (BanditEnv.initBanditUI) BanditEnv.initBanditUI();
};

// --- END: pet/shared.js ---

// --- START: pet/state.js ---
BanditEnv.initBanditState = function(savedState) {
  doc = (typeof window.rockyShadowRoot !== 'undefined') ? window.rockyShadowRoot : document;
  docBody = (typeof window.rockyShadowRoot !== 'undefined') ? window.rockyShadowRoot : document.body;

  abortController = typeof AbortController !== 'undefined' ? new AbortController() : { signal: undefined, abort: () => { } };
  signal = abortController.signal;
  cleanupTasks = [];
  shadowHost = (typeof window.rockyShadowRoot !== 'undefined') ? window.rockyShadowRoot.host : null;
  if (shadowHost) {
    shadowHost.addEventListener('bandit-cleanup', () => {
      abortController.abort();
      cleanupTasks.forEach(fn => fn());
    });
  }

  // Fields missing from an older saved version fall back to these.
  rockyDefaults = (window.RockyStorage && window.RockyStorage.DEFAULTS) || {
    xp: 0, level: 1, petName: 'Bandit', position: { x: null, y: null }, onboarded: false, settings: { size: 1 },
    lastFedAt: 0, provider: 'builtin', apiKey: '', model: '', apiKeys: {}, enhanceStyle: 'structured', askPlaceholders: false, history: []
  };
  hydrated = savedState || rockyDefaults;

  persist = function(partial, opts) {
    try {
      if (window.RockyStorage) window.RockyStorage.saveState(partial, opts);
    } catch (err) {
      console.warn('Bandit: failed to persist state', err);
    }
  }

  // Firefox uses browser.*, Chrome uses chrome.* — used only by the settings
  // modal's "Test key" button, which talks to background.js directly (Enhance
  // and Summarize instead go through window.rockyAIPipeline, see ai/pipeline.js).
  rockyApi = globalThis.browser ?? globalThis.chrome;

  testAIKey = function(testSettings) {
    return new Promise((resolve, reject) => {
      try {
        if (!rockyApi || !rockyApi.runtime || !rockyApi.runtime.sendMessage) {
          reject(new Error('extension messaging unavailable here (demo page only)'));
          return;
        }
        rockyApi.runtime.sendMessage({ type: 'ROCKY_AI_TEST_KEY', testSettings }, (response) => {
          const lastErr = rockyApi.runtime.lastError;
          if (lastErr) { reject(new Error(lastErr.message)); return; }
          if (!response) { reject(new Error("no response from Bandit's background worker")); return; }
          if (!response.ok) { reject(new Error(response.error || 'test failed')); return; }
          resolve(response);
        });
      } catch (err) {
        reject(err);
      }
    });
  }



  // Provider/page-derived error text goes into bubble innerHTML — escape it so
  // a malicious error string can never inject markup into Rocky's shadow DOM.
  escapeHTML = function(s) {
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  friendlyError = function(err) {
    const msg = (err && err.message) ? err.message : String(err || 'unknown error');
    if (/slow down/i.test(msg)) return 'one thing at a time — try again in a sec';
    if (/No API key/i.test(msg)) return 'no API key set';
    if (/built-in.*unavailable|on-device AI is unavailable/i.test(msg)) return "on-device AI isn't available — set up an API key in settings";
    if (/No cloud provider|pick a cloud provider|pick one in settings/i.test(msg)) return 'no provider selected';
    if (/messaging unavailable/i.test(msg)) return "this only works in the real extension, not the demo page";
    if (/timed out/i.test(msg)) return 'took too long, try again';
    if (/network|fetch|Failed to fetch/i.test(msg)) return 'network hiccup, try again';
    return msg.length > 160 ? msg.slice(0, 160) + '…' : msg;
  }

  copyToClipboard = function(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
    }
    return legacyCopy(text);
  }

  function legacyCopy(text) {
    return new Promise((resolve, reject) => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        // MUST append to the real document body, not the shadow DOM.
        // document.execCommand('copy') silently fails if the target is inside a shadow root.
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        if (ok) resolve(); else reject(new Error('copy failed'));
      } catch (err) {
        reject(err);
      }
    });
  }
};

// --- END: pet/state.js ---

// --- START: pet/drag.js ---
BanditEnv.initBanditDrag = function(savedState) {
  updateXPDisplay = function() {
    const base = LEVELS[level - 1] || 0, next = LEVELS[level] ?? xp;
    const range = next - base; const pct = range > 0 ? Math.min(100, ((xp - base) / range) * 100) : 100;
    if (xpFill) xpFill.style.width = pct + '%';
    const name = (petName || 'Bandit').toUpperCase();
    if (xpLabel) xpLabel.replaceChildren(...new DOMParser().parseFromString(`${escapeHTML(name)} · <b>LVL ${level}</b> · ${xp}/${LEVELS[level] ?? 'MAX'} XP`, 'text/html').body.childNodes);
  }

  gainXP = function(n, silent = false) {
    xp += n;
    let leveledUp = false;
    while (level < LEVELS.length - 1 && xp >= LEVELS[level]) {
      level++;
      leveledUp = true;
    }
    if (leveledUp) {
      wrap.classList.add('levelup');
      setTimeout(() => wrap.classList.remove('levelup'), 1500);
      applyAccessories(level);
      const LEVEL_TOASTS = {
        2: `🦝 LEVEL 2 — ${petName} found sunglasses in the trash`,
        3: `🧣 LEVEL 3 — ${petName} found a cozy scarf!`,
        4: `👑 LEVEL 4 — ALL HAIL THE TRASH KING`,
      };
      showToast(LEVEL_TOASTS[level] || `🦝 LEVEL ${level}!`);
    }
    updateXPDisplay();
    persist({ xp, level });

    if (!silent) {
      wrap.classList.add('show-xp');
      clearTimeout(gainXP._t);
      gainXP._t = setTimeout(() => wrap.classList.remove('show-xp'), 3000);
    }
  }

  getClosest = function(e, sel) {
    const path = e.composedPath();
    const t = path && path[0];
    if (!t) return null;
    const el = t.nodeType === 3 ? t.parentElement : t;
    return el && typeof el.closest === 'function' ? el.closest(sel) : null;
  }

  // Viewport-space clamp (uses clientX/clientY-equivalent bounds, never page
  // coordinates) so Rocky can never end up stranded off-screen — used during
  // drag, on resize/orientationchange, and when hydrating a saved position that
  // may have come from a bigger screen.
  clampToViewport = function(left, top) {
    const rect = root.getBoundingClientRect();
    const w = rect.width > 0 ? rect.width : 150;
    const h = rect.height > 0 ? rect.height : 180;
    const margin = 4;
    const maxLeft = Math.max(margin, innerWidth - w - margin);
    const maxTop = Math.max(margin, innerHeight - h - margin);
    return {
      x: Math.max(margin, Math.min(maxLeft, left)),
      y: Math.max(margin, Math.min(maxTop, top)),
    };
  }

  /* click vs drag */
  drag = null;
  spinTimer = null;
  cleanupTasks.push(() => clearTimeout(spinTimer));
  lastTap = 0;

  wrap.addEventListener('contextmenu', e => {
    e.preventDefault();
    const rect = root.getBoundingClientRect();
    if (rect.right + 200 > window.innerWidth) wrap.classList.add('menu-left');
    else wrap.classList.remove('menu-left');

    const menuExtra = doc.getElementById('menuExtra');
    const menuMore = doc.getElementById('menuMore');
    if (menuExtra) menuExtra.style.display = 'none';
    if (menuMore) menuMore.style.display = 'block';

    wrap.classList.add('show-menu');
  });
  window.addEventListener('pointerdown', e => {
    if (!getClosest(e, '.pet-menu') && !getClosest(e, '#petWrap')) {
      wrap.classList.remove('show-menu');
    }
  }, { signal });

  wrap.addEventListener('pointerdown', e => {
    if (getClosest(e, '.pet-menu')) return;
    if (e.button === 2) return; // ignore right click for drag
    if (drag) return; // a drag is already in progress from another pointer — don't steal it
    stopRun();

    if (isFetching) {
      isFetching = false;
      root.style.transition = '';
      const a = doc.querySelector('.fetch-apple');
      if (a) a.remove();
    }

    const rect = root.getBoundingClientRect();
    drag = {
      pointerId: e.pointerId,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      moved: false,
      longPressed: false
    };
    // Hold Rocky still for 600ms (no drag) → he does a spin trick.
    clearTimeout(spinTimer);
    spinTimer = setTimeout(() => {
      if (!drag || drag.moved) return;
      drag.longPressed = true;
      wrap.classList.add('spinning');
      say('wheee! 🌀', 1600);
      if (Math.random() < 0.3) gainXP(2, true);
      setTimeout(() => wrap.classList.remove('spinning'), 750);
    }, 600);
    // Capture guarantees subsequent pointer events for this pointerId are
    // dispatched to wrap regardless of what's under the cursor — this fixes
    // dragging across an iframe (which would otherwise steal the events into
    // its own document) and any element that swallows pointerdown with
    // preventDefault. It does NOT bypass document/window-level listeners that
    // call stopPropagation on the bubble phase — a host page could still do
    // that upstream of us. Gemini specifically needs empirical testing.
    try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* capture unsupported for this pointer type */ }
  });
  petDistance = 0;
  lastHeartTime = 0;
  spawnHeart = function() {
    const h = document.createElement('div');
    h.className = 'heart';
    h.replaceChildren(...new DOMParser().parseFromString('<div style="width:4px;height:4px;background:transparent;box-shadow:4px 0 #ff4b4b,12px 0 #ff4b4b,0 4px #ff4b4b,4px 4px #ff4b4b,8px 4px #ff4b4b,12px 4px #ff4b4b,16px 4px #ff4b4b,4px 8px #ff4b4b,8px 8px #ff4b4b,12px 8px #ff4b4b,8px 12px #ff4b4b"></div>', 'text/html').body.childNodes);
    const rect = pet.getBoundingClientRect();
    h.style.position = 'fixed';
    h.style.left = (rect.left + rect.width / 2 - 10 + (Math.random() * 40 - 20)) + 'px';
    h.style.top = (rect.top - 10) + 'px';
    docBody.appendChild(h);
    setTimeout(() => h.remove(), 1200);
  }
  window.addEventListener('pointerout', () => petDistance = 0, { signal });

  // Rocky's pupils drift toward the cursor — tiny effect, big "he's alive" feel.
  // Throttled to ~10Hz; skipped while sleeping (eyes closed) or above level 1
  // (shades cover the eyes anyway).
  lastEyeMove = 0;
  eyesFollowCursor = function(e) {
    const now = Date.now();
    if (now - lastEyeMove < 100) return;
    lastEyeMove = now;
    if (state === 'sleeping' || level >= 2) { fEyesG.removeAttribute('transform'); return; }
    const r = pet.getBoundingClientRect();
    if (!r.width) return;
    const cx = r.left + r.width / 2, cy = r.top + r.height * 0.38; // eye line
    const dx = Math.max(-1, Math.min(1, (e.clientX - cx) / 160));
    const dy = Math.max(-1, Math.min(1, (e.clientY - cy) / 160));
    fEyesG.setAttribute('transform', `translate(${(dx * 0.7).toFixed(2)}, ${(dy * 0.5).toFixed(2)})`);
  }

  lastPointerCheck = 0;
  window.addEventListener('pointermove', e => {
    if (!drag) {
      eyesFollowCursor(e);
      if (state === 'sleeping') return;

      const now = Date.now();
      if (now - lastPointerCheck < 50) return;
      lastPointerCheck = now;

      if (!getClosest(e, '#pet')) return;

      petDistance += Math.hypot(e.movementX, e.movementY) * 5; // scaled up since we drop frames
      if (petDistance > 200) {
        petDistance = 0;
        const now = Date.now();
        if (now - lastHeartTime > 500) {
          lastHeartTime = now;
          spawnHeart();
          if (state !== 'happy' && state !== 'working') {
            eyesHappy();
            setTimeout(() => { if (state !== 'happy' && state !== 'working') eyesOpen(); }, 600);
            gainXP(1, true);
          }
        }
      }
      return;
    }
    if (e.pointerId !== drag.pointerId) return; // a second simultaneous pointer — not our drag

    if (!drag.moved) {
      const probe = clampToViewport(e.clientX - drag.offsetX, e.clientY - drag.offsetY);
      if (Math.abs(probe.x - root.offsetLeft) > 5 || Math.abs(probe.y - root.offsetTop) > 5) {
        drag.moved = true;
        clearTimeout(spinTimer); // a real drag cancels the long-press spin
        drag.offsetX = 60; // Snap to center
        drag.offsetY = 30; // Snap to scruff/neck
        wrap.classList.add('dragging');
        root.style.transition = 'none'; // zero-lag 1:1 cursor tracking, no easing
        lastActivity = Date.now(); // dragging counts as activity — no sleep mid-drag
        if (state === 'sleeping' || state === 'startled') setState('idle');
      }
    }

    if (drag.moved) {
      const pos = clampToViewport(e.clientX - drag.offsetX, e.clientY - drag.offsetY);
      root.style.left = pos.x + 'px';
      root.style.top = pos.y + 'px';
      root.style.right = 'auto';
      root.style.bottom = 'auto';
      wrap.classList.remove('show-menu');
    }
  }, { signal });
  window.addEventListener('pointerup', e => {
    if (drag && e.pointerId !== drag.pointerId) return; // a different pointer lifted, not ours
    clearTimeout(spinTimer);
    wrap.classList.remove('dragging');
    root.style.transition = '';
    if (drag) { try { wrap.releasePointerCapture(drag.pointerId); } catch (err) { /* noop */ } }
    lastActivity = Date.now(); // restart the idle-to-sleep countdown from release, not from grab
    const wasClick = drag && !drag.moved && !drag.longPressed; // a spin isn't a click
    const wasDrag = drag && drag.moved;
    drag = null;
    if (wasDrag) {
      persist({ position: { x: root.offsetLeft, y: root.offsetTop } }, { immediate: true });
    }
    if (wasClick && !getClosest(e, '.pet-menu')) {
      if (state === 'sleeping') { pokeActivity(); return; }
      const now = Date.now();
      if (now - lastTap < 350) {
        enhancePrompt();
        lastTap = 0;
      } else {
        lastTap = now;
        pokeActivity();
        wrap.classList.toggle('show-menu');
      }
    }
  }, { signal });
};

// --- END: pet/drag.js ---

// --- START: pet/sprites.js ---
const BANDIT_SPRITES = {
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

// --- END: pet/sprites.js ---

// --- START: pet/animations.js ---
BanditEnv.initBanditAnimations = function(savedState) {

  /* =========================================================
     CONVERSATION SCRAPING — per-site adapters + generic fallback.
     Every stage is try/caught: a broken selector never crashes the host page,
     it just falls through to the next, less-specific strategy.
     ========================================================= */


  /* =========================================================
     SHARED PALETTE + HELPERS
     ========================================================= */
  NS = 'http://www.w3.org/2000/svg';
  group = function(cls, parentSvg) {
    const g = document.createElementNS(NS, 'g');
    if (cls) g.setAttribute('class', cls);
    parentSvg.appendChild(g); return g;
  }

  setSafeSvg = function(g, svgString) {
    if (!g) return;
    while (g.firstChild) g.removeChild(g.firstChild);
    if (!svgString) return;
    const parser = new DOMParser();
    const parsed = parser.parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${svgString}</svg>`, 'image/svg+xml');
    const fragment = document.createDocumentFragment();
    while (parsed.documentElement.firstChild) {
      fragment.appendChild(parsed.documentElement.firstChild);
    }
    g.appendChild(fragment);
  };

  frontSvg = doc.getElementById('frontSvg');
  if (!frontSvg) { console.error('Bandit: #frontSvg missing — aborting init'); return; }
  
  fTailG = group('tail', frontSvg);
  setSafeSvg(fTailG, BANDIT_SPRITES.tail);
  
  fBodyG = group('body-group', frontSvg);
  fEarsG = document.createElementNS(NS, 'g'); fEarsG.setAttribute('class', 'ears'); fBodyG.appendChild(fEarsG);
  setSafeSvg(fEarsG, BANDIT_SPRITES.ears);
  
  fBodyRectsG = document.createElementNS(NS, 'g'); fBodyG.appendChild(fBodyRectsG);
  setSafeSvg(fBodyRectsG, BANDIT_SPRITES.body);
  
  fEyesG = document.createElementNS(NS, 'g'); fBodyG.appendChild(fEyesG);
  fAccG = document.createElementNS(NS, 'g'); fBodyG.appendChild(fAccG);
  
  overlay = function(g, html) { setSafeSvg(g, html); }
  eyesOpen = function() { overlay(fEyesG, BANDIT_SPRITES.eyesOpen); }
  eyesClosed = function() { overlay(fEyesG, BANDIT_SPRITES.eyesClosed); }
  eyesHappy = function() { overlay(fEyesG, BANDIT_SPRITES.eyesHappy); }
  
  applyAccessories = function(lvl) {
    let accHtml = '';
    if (lvl >= 2) accHtml += BANDIT_SPRITES.shades;
    if (lvl >= 3) accHtml += BANDIT_SPRITES.scarf;
    if (lvl >= 4) accHtml += BANDIT_SPRITES.crown;
    overlay(fAccG, accHtml);
  }
  eyesOpen();

  /* =========================================================
     STATE + BEHAVIOR
     ========================================================= */
  wrap = doc.getElementById('petWrap');
  root = doc.getElementById('rocky-root');
  pet = doc.getElementById('pet');
  bubble = doc.getElementById('bubble');
  input = doc.getElementById('promptInput');
  box = doc.getElementById('composerBox');
  hint = doc.getElementById('composerHint');
  xpFill = doc.getElementById('xpFill');
  xpLabel = doc.getElementById('xpLabel');
  toast = doc.getElementById('toast');
  messages = doc.getElementById('messages');

  if (!wrap || !root || !pet || !bubble) { console.error('Bandit: critical DOM elements missing — aborting init'); return; }

  state = 'idle';
  xp = hydrated.xp, level = hydrated.level;
  petName = hydrated.petName;
  lastFedAt = hydrated.lastFedAt || 0;
  aiSettings = { provider: hydrated.provider || 'builtin', apiKey: hydrated.apiKey || '', model: hydrated.model || '', apiKeys: hydrated.apiKeys || {} };
  enhanceStyle = hydrated.enhanceStyle || 'structured';
  enhanceTone = hydrated.enhanceTone || 'professional';
  askPlaceholders = hydrated.askPlaceholders === true; // default OFF — enable in settings
  lastEnhance = null; // { inputRef, original } — lets the Undo menu restore pre-enhance text
  // Named copyHistory (not `history`) to avoid shadowing window.history.
  copyHistory = Array.isArray(hydrated.history) ? hydrated.history : [];

  function recordHistory(type, text) {
    copyHistory = [{ type, text, at: Date.now() }, ...copyHistory].slice(0, 10);
    persist({ history: copyHistory });
  }
  currentVersion = (rockyApi && rockyApi.runtime && rockyApi.runtime.getManifest) ? rockyApi.runtime.getManifest().version : '2.4';
  lastSeenVersion = hydrated.lastSeenVersion || '';
  updateMessageCount = hydrated.updateMessageCount || 0;

  if (lastSeenVersion && lastSeenVersion !== currentVersion) {
    lastSeenVersion = currentVersion;
    updateMessageCount = 0;
    persist({ lastSeenVersion, updateMessageCount });
  } else if (!lastSeenVersion) {
    lastSeenVersion = currentVersion;
    updateMessageCount = 5; // Don't show on very first install
    persist({ lastSeenVersion, updateMessageCount });
  }

  FEED_COOLDOWN_MS = 60000;
  LEVELS = [0, 20, 50, 100]; // level 1..4 thresholds; Level 4 is max, so no 200 cap.
  lastActivity = Date.now();
  alertShown = false;
  runAnim = null;
  isHovering = false;
  wrap.addEventListener('pointerenter', () => isHovering = true);
  wrap.addEventListener('pointerleave', () => isHovering = false);

  setState = function(s) {
    wrap.classList.remove('alert', 'working', 'happy', 'sleeping', 'levelup', 'running', 'scooting', 'hopping');
    if (s !== 'idle') wrap.classList.add(s);
    if (s !== 'sleeping' && state === 'sleeping') {
      const oldHouse = doc.querySelector('.bandit-house');
      if (oldHouse) oldHouse.remove();
    }
    state = s;
    if (s === 'sleeping') eyesClosed();
    else if (level < 2) eyesOpen();
  }

  say = function(html, ms = 2600) {
    if (!bubble) return;
    bubble.replaceChildren(...new DOMParser().parseFromString(html, 'text/html').body.childNodes); bubble.classList.add('show');
    clearTimeout(say._t);
    if (ms > 0) say._t = setTimeout(() => bubble.classList.remove('show'), ms);
  }
  showToast = function(msg) {
    if (!toast) return;
    toast.textContent = msg; toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  // Animated "thinking…" bubble — cycling dots make waiting on the AI feel
  // alive instead of frozen. Always pair sayThinking() with stopThinking().
  thinkingTimer = null;
  sayThinking = function(base) {
    clearInterval(thinkingTimer);
    let n = 0;
    const step = () => { n = (n % 3) + 1; say(base + '.'.repeat(n), 0); };
    step();
    thinkingTimer = setInterval(step, 450);
    cleanupTasks.push(() => clearInterval(thinkingTimer));
  }
  stopThinking = function() {
    clearInterval(thinkingTimer);
    thinkingTimer = null;
  }

  /* blinking (front sprite) */
  blinkTimer;
  (function scheduleBlink() {
    blinkTimer = setTimeout(() => {
      if (!document.hidden && state !== 'sleeping' && state !== 'running' && level < 2) {
        eyesClosed(); setTimeout(() => { if (state !== 'sleeping') eyesOpen(); }, 140);
      }
      scheduleBlink();
    }, 2200 + Math.random() * 2600);
  })();
  cleanupTasks.push(() => clearTimeout(blinkTimer));

  isFetching = false;
  fetchTimer = null;
  cleanupTasks.push(() => clearTimeout(fetchTimer));

  pokeActivity = function() {
    lastActivity = Date.now();
    if (state === 'sleeping') {
      setState('startled');
      eyesOpen();
      const emote = doc.getElementById('startleEmote');
      if (emote) {
        emote.style.display = 'block';
        setTimeout(() => { emote.style.display = 'none'; if (state === 'startled') setState('idle'); }, 1000);
      }
      return;
    }
    if (state !== 'working' && state !== 'startled' && !isFetching) setState('idle');
  }
  sleepInterval = setInterval(() => {
    if (document.hidden) return;
    if (state === 'idle' && !drag && Date.now() - lastActivity > 20000) setState('sleeping');
  }, 1000);
  cleanupTasks.push(() => clearInterval(sleepInterval));

  /* =========================================================
     RUNNING — swaps to the 4-leg side sprite mid-dash
     ========================================================= */
  startRun = function() {
    if (state === 'sleeping' || state === 'working' || drag || wrap.matches(':hover') || isFetching || state === 'startled') return;
    const r = root.getBoundingClientRect();
    root.style.left = r.left + 'px'; root.style.top = r.top + 'px';
    root.style.right = 'auto'; root.style.bottom = 'auto';

    const dir = Math.random() < .5 ? -1 : 1;
    const dist = 140 + Math.random() * 300;
    let targetX = r.left + dir * dist;
    targetX = Math.max(8, Math.min(innerWidth - 150, targetX));
    if (Math.abs(targetX - r.left) < 60) {
      targetX = r.left + (targetX > r.left ? -1 : 1) * 160;
      targetX = Math.max(8, Math.min(innerWidth - 150, targetX));
    }

    pet.classList.toggle('face-left', targetX < r.left);
    const styles = ['running', 'scooting', 'hopping'];
    const runStyle = styles[Math.floor(Math.random() * styles.length)];
    setState(runStyle);
    wrap.classList.add(runStyle);

    let speed = 150;
    if (runStyle === 'scooting') speed = 240;
    if (runStyle === 'hopping') speed = 110;

    let last = performance.now(), x = r.left;
    const step = (now) => {
      if (document.hidden) { setState('idle'); runAnim = null; return; }
      if (state !== 'running' && state !== 'scooting' && state !== 'hopping') { runAnim = null; return; }
      const dt = (now - last) / 1000; last = now;
      const d = targetX - x;
      const move = Math.sign(d) * Math.min(Math.abs(d), speed * dt);
      x += move; root.style.left = x + 'px';
      if (Math.abs(targetX - x) < 2) {
        setState('idle'); runAnim = null;
        persist({ position: { x: Math.round(x), y: root.offsetTop } });
        return;
      }
      runAnim = requestAnimationFrame(step);
    };
    runAnim = requestAnimationFrame(step);
  }
  runInterval = setInterval(() => {
    if (document.hidden) return;
    if (state === 'idle' && !isHovering && Date.now() - lastActivity > 5000 && Math.random() < .4) startRun();
  }, 8000);
  cleanupTasks.push(() => clearInterval(runInterval));
  stopRun = function() {
    if (runAnim) cancelAnimationFrame(runAnim);
    runAnim = null;
    if (state === 'running' || state === 'scooting' || state === 'hopping') setState('idle');
  }

  /* idle chatter */
  idleLines = [
    'psst… got a trash prompt for me? 🗑️',
    'feed me prompts. trash → treasure ✨',
    'zoomies incoming 🐾',
    'double-click me to enhance ✨',
    'right-click me for snacks 🍪',
    'I summarize chats too, y\'know 📋',
    '*sniffs around for bugs* 🐛',
    'ship it. ship it now 🚀',
    'Ctrl+Shift+E → instant enhance ⚡',
    '*rummages through your code* 🦝',
  ];
  chatterInterval = setInterval(() => {
    if (document.hidden) return;
    if (state === 'idle' && Date.now() - lastActivity > 6000 && Date.now() - lastActivity < 18000) {
      if (updateMessageCount < 5) {
        say(`I've been updated to v${currentVersion}! ✨<br>Check out my new menu features!`, 4000);
        updateMessageCount++;
        persist({ updateMessageCount });
      } else {
        say(idleLines[Math.floor(Math.random() * idleLines.length)], 2400);
      }
    }
  }, 11000);
  cleanupTasks.push(() => clearInterval(chatterInterval));

  /* typing → alert */
  if (input) input.addEventListener('input', () => {
    pokeActivity();
    const val = input.value.trim();
    if (val.length > 7 && (state === 'idle' || state === 'running') && !alertShown) {
      alertShown = true; stopRun();
      setState('alert');
      if (box) box.classList.add('rocky-glow');
      say('Ooh! I can clean that up.<br><b>Click me</b> or <b>Ctrl+Shift+E</b> 🦝✨', 4000);
      setTimeout(() => { if (state === 'alert') setState('idle'); }, 4200);
    }
    if (val.length === 0) { alertShown = false; if (box) box.classList.remove('rocky-glow'); }
  });

  /* enhance flow */

  /* =========================================================
     PLACEHOLDER Q&A — when the enhanced prompt contains
     [bracketed placeholders], Rocky asks the user to fill each one
     (with clickable suggestions) before inserting the final text.
     ========================================================= */
  PLACEHOLDER_SUGGESTIONS = [
    // Each entry: regex tested against the FULL placeholder text, options shown.
    // Patterns use word boundaries and multi-word anchors to avoid false matches
    // (e.g. "storage" alone shouldn't suggest databases — "data storage" should).
    // General / Writing / Design
    {
      re: /\b(target\s+audience|audience|readers)\b/i,
      opts: ['Beginners', 'Experts / Professionals', 'General Public', 'Children']
    },
    {
      re: /\b(tone|style|voice)\b/i,
      opts: ['Professional & Formal', 'Casual & Friendly', 'Humorous', 'Academic / Objective']
    },
    {
      re: /\b(visual\s+style|art\s+style|aesthetic)\b/i,
      opts: ['Photorealistic', 'Vector Illustration', 'Anime / Manga', '3D Render']
    },
    {
      re: /\b(format|medium)\b/i,
      opts: ['Blog Post', 'Email Newsletter', 'Social Media Post', 'Academic Essay']
    },
    // Coding / Tech
    {
      re: /\b(tech\s*stack|framework|your\s+stack|front\s*end\s+stack)\b/i,
      opts: ['React + Node.js', 'Next.js', 'Vue + Express', 'Plain HTML/CSS/JS']
    },
    {
      re: /\b(database|data\s*base|db\s+engine|data\s+storage|your\s+db)\b/i,
      opts: ['PostgreSQL', 'MongoDB', 'SQLite', 'Supabase']
    },
    {
      re: /\b(backend|back\s*end|server\s*(framework|stack)?|api\s+framework)\b/i,
      opts: ['Node.js + Express', 'Supabase', 'Firebase', 'Python FastAPI']
    },
    {
      re: /\b(auth(entication)?|login\s+method|sign[\s-]*in)\b/i,
      opts: ['Email + password', 'Google OAuth', 'Magic link']
    },
    {
      re: /\b(config(uration)?(\s+method)?|env(ironment)?\s*(setup|file)?)\b/i,
      opts: ['.env file', 'JSON config file']
    },
    {
      re: /\b(color\s*(scheme|palette)?|brand(ing)?|theme|design\s+style|ui\s+style)\b/i,
      opts: ['Minimal light', 'Dark mode', 'Colorful / playful']
    },
    {
      re: /\b(host(ing)?|deploy(ment)?|platform)\b/i,
      opts: ['Vercel', 'Netlify', 'AWS', 'Railway']
    },
    {
      re: /\b(test(ing)?(\s+framework)?|test\s+runner)\b/i,
      opts: ['Jest', 'Vitest', 'Playwright', 'None for now']
    },
    {
      re: /\b(language|programming\s+lang(uage)?)\b/i,
      opts: ['TypeScript', 'JavaScript', 'Python', 'Go']
    },
    {
      re: /\b(css\s*(framework|library)?|styling)\b/i,
      opts: ['Tailwind CSS', 'Vanilla CSS', 'CSS Modules', 'Styled Components']
    },
    {
      re: /\b(state\s*(management|library))\b/i,
      opts: ['React Context', 'Zustand', 'Redux', 'None']
    },
    {
      re: /\b(package\s+manager)\b/i,
      opts: ['npm', 'pnpm', 'yarn', 'bun']
    },
  ];
  suggestionsFor = function(ph) {
    for (const s of PLACEHOLDER_SUGGESTIONS) if (s.re.test(ph)) return s.opts;
    return []; // No match = no suggestions. User types their own — safer than guessing wrong.
  }
  extractPlaceholders = function(text) {
    const found = new Set();
    const re = /(?:^|[^a-zA-Z0-9_])\[([a-zA-Z][a-zA-Z0-9\s_/\-\.,']{1,48})\](?!\()/g;
    let m;
    while ((m = re.exec(text))) found.add(m[1]);
    return [...found];
  }

  // Shared builder for Rocky's dynamic mini-modals (placeholder Q&A, history).
  // Overlay click dismisses; onClose fires exactly once however it closes.
  openRockyModal = function(onClose) {
    const dialog = BanditModals.createDialog(onClose);
    dialog.show();
    return { modal: dialog.modal, close: dialog.close };
  }

  // Asks one question per placeholder in a mini-modal (reuses settings-modal
  // styling). Skipped/dismissed placeholders stay bracketed in the output.
  askPlaceholderValues = function(text, placeholders, done) {
    let i = 0;
    let out = text;
    let answering = false; // separate flag — can't set properties on a string primitive

    let cancelled = true;

    // Dismissing at any point delivers null (aborted), unless finished completely.
    const { modal, close: finish } = openRockyModal(() => {
      if (cancelled) done(null);
      else done(out);
    });

    const answer = (val) => {
      if (answering) return; // prevent rapid double-clicks from skipping questions
      answering = true;
      if (val) out = out.split('[' + placeholders[i] + ']').join(val);
      i++;
      if (i < placeholders.length) {
        answering = false;
        renderQuestion();
      } else {
        cancelled = false;
        answering = false;
        finish();
      }
    };

    const renderQuestion = () => {
      const ph = placeholders[i];
      modal.replaceChildren();

      const h = document.createElement('h3');
      h.textContent = `🦝 quick question ${i + 1}/${placeholders.length}`;
      modal.appendChild(h);

      const q = document.createElement('div');
      q.style.cssText = 'font-size:12px;line-height:1.6;color:#8a95a5';
      q.append('What should I use for ');
      const b = document.createElement('b');
      b.style.color = '#f5a524';
      b.textContent = '[' + ph + ']';
      q.appendChild(b);
      q.append('?');
      modal.appendChild(q);

      suggestionsFor(ph).forEach((opt) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'secondary';
        btn.textContent = opt;
        btn.addEventListener('click', () => answer(opt));
        modal.appendChild(btn);
      });

      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'or type your own…';
      input.addEventListener('keydown', (e) => {
        e.stopPropagation(); // keep keystrokes away from host-page shortcuts
        if (e.key === 'Enter') {
          e.preventDefault();
          const val = input.value.trim();
          answer(val ? val : null);
        }
        if (e.key === 'Escape') finish();
      });
      modal.appendChild(input);

      const row = document.createElement('div');
      row.className = 'settings-row';
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.textContent = 'Use this';
      ok.style.flex = '1';
      ok.addEventListener('click', () => {
        const val = input.value.trim();
        answer(val ? val : null);
      });
      const skip = document.createElement('button');
      skip.type = 'button';
      skip.className = 'secondary';
      skip.textContent = 'Skip';
      skip.addEventListener('click', () => answer(null));
      row.appendChild(ok);
      row.appendChild(skip);
      modal.appendChild(row);

      setTimeout(() => input.focus(), 60);
    };

    renderQuestion();
  }

  enhancePrompt = function(overrideInput, overrideText) {
    wrap.classList.remove('show-menu');
    const hostInput = overrideInput || BanditInjector.getHostInput();

    if (!hostInput) {
      say("I can't find a text box to enhance! 🔍", 3000);
      return;
    }

    let val = overrideText || '';
    if (!val) {
      if (hostInput.isContentEditable) {
        val = hostInput.innerText || hostInput.textContent;
      } else {
        val = hostInput.value;
      }
    }

    const trimmedVal = val.trim();
    if (!trimmedVal) {
      say("You have to type something first! 🥺", 3000);
      return;
    }

    // --- MULTI-LAYER INPUT VALIDATION ---
    // Reject inputs that aren't real prompts. Users get a specific, helpful
    // message so they know WHAT to type, not just "too short".
    const wordCount = trimmedVal.split(/\s+/).length;
    const lower = trimmedVal.toLowerCase().replace(/[^a-z\s]/g, '').trim();

    // Layer 1: Single words are never real prompts
    if (wordCount === 1) {
      say("One word isn't enough to enhance! 🐾<br><span style='opacity:.7'>Try: \"build a login page\" or \"write a blog about space\"</span>", 4500);
      return;
    }

    // Layer 2: Greetings, farewells, reactions, filler — expanded list
    const FLUFF_PATTERNS = [
      // Greetings (with typo variants)
      /^(h[ei]y+|hi+|hello+|helo+|hola|howdy|sup|wh?at'?s? ?up|yo+)\b/,
      // Farewells
      /^(bye+|good ?bye|see ?ya|later|cya|peace|adios)\b/,
      // Gratitude / politeness
      /^(thanks?|thank ?you|thx|ty|please|pls|welcome|np|no ?prob)\b/,
      // Affirmatives / negatives
      /^(ye[sp]?|yeah|yep|yup|nope?|nah|ok+|okay|sure|fine|alright|k+|kk+)$/,
      // Reactions / filler
      /^(lo+l+|lmao+|rof+l|hah+a*|heh+e*|hmm+|wow+|oh+|ah+|ugh+|meh|bruh|bro|dude|man|nice|cool|great|awesome|damn|dang|omg|wtf|idk|idc)$/,
      // Profanity catch-all (common ones)
      /\b(fuck|shit|ass|bitch|dick|crap|hell|damn)\b/,
      // Nonsense / keyboard mashing (3+ repeated chars or random consonant strings)
      /^([a-z])\1{3,}/,
      /^[^aeiou\s]{5,}$/,
    ];

    if (FLUFF_PATTERNS.some(re => re.test(lower))) {
      say("That's not something I can enhance! 🦝<br><span style='opacity:.7'>Give me a real request, like:<br>\"create a landing page\" or \"explain React hooks\"</span>", 5000);
      return;
    }

    // Layer 3: Very short inputs (under 12 chars AND ≤2 words) — not enough substance
    if (trimmedVal.length < 12 && wordCount <= 2) {
      say("That's too short for me to work with! 🐾<br><span style='opacity:.7'>Add more detail — what do you want built/written/explained?</span>", 4500);
      return;
    }

    // Layer 4: Pure conversational fluff (slightly longer but still not a prompt)
    const CONVERSATIONAL = /^(how are you|what are you|who are you|are you|do you|can you|will you|i am|i'm|my name|what's your|tell me a joke|sing|dance)[.!?\s]*$/i;
    if (CONVERSATIONAL.test(trimmedVal)) {
      say("Hah, I'm flattered but I enhance prompts, not answer questions! 🦝<br><span style='opacity:.7'>Try: \"write a Python script that…\"</span>", 4500);
      return;
    }

    if (state === 'working') return;

    pokeActivity(); stopRun();
    setState('working');
    sayThinking('rummaging through your prompt 🔍');

    const buildSys = window.RockyPrompts && window.RockyPrompts.buildSystemPrompt;
    const ENHANCE_SYSTEM = buildSys
      ? buildSys(enhanceStyle, enhanceTone)
      : ((window.RockyPrompts && window.RockyPrompts.ENHANCE_SYSTEMS || {})[enhanceStyle] || (window.RockyPrompts ? window.RockyPrompts.ENHANCE_SYSTEM : ''));

    const inputWordCount = val.trim().split(/\s+/).length;

    window.rockyAIPipeline(ENHANCE_SYSTEM, val.trim(), {
      actionKey: 'enhance',
      onProgress: (frac) => { stopThinking(); say(`downloading on-device AI… ${Math.round(frac * 100)}% 📥`, 0); },
    }).then(result => {
      stopThinking();

      if (result.trim() === 'ERROR_GIBBERISH') {
        setState('idle');
        say('Hmm, that doesn\'t look like a real prompt. Can you be more specific? 🤔', 4000);
        return;
      }

      // Reject suspiciously short AI outputs — a good enhanced prompt is never
      // just a few words. This catches models returning "OK" or echoing the input.
      const resultWords = result.trim().split(/\s+/).length;
      if (resultWords < 8) {
        setState('idle');
        say('The AI gave a weird response — try again or rephrase your prompt 🤔', 4000);
        return;
      }

      lastEnhance = { inputRef: typeof WeakRef !== 'undefined' ? new WeakRef(hostInput) : hostInput, original: val };

      const insertFinal = (text) => {
        const finalStr = text.trim();
        recordHistory('enhance', finalStr);
        gainXP(10);
        setState('happy');

        if (hostInput.isContextMenu) {
          copyToClipboard(finalStr)
            .then(() => say('copied enhanced prompt to clipboard! 📋✨', 4000))
            .catch(() => say('copy blocked by browser 😖 (check history 📜)', 4000));
        } else {
          BanditInjector.setPromptText(hostInput, finalStr);
          const outputWordCount = finalStr.split(/\s+/).length;
          say(`trash → treasure! <span class="xp-pop">+10 XP</span> ✨<br><span style="opacity:.7">${inputWordCount} → ${outputWordCount} words · menu → ↩️ Undo</span>`, 4200);
        }
        setTimeout(() => { if (state === 'happy') setState('idle'); }, 1150);
      };

      const placeholders = extractPlaceholders(result);
      if (askPlaceholders && placeholders.length) {
        setState('alert');
        say('almost! fill in a couple of blanks for me ✍️', 3000);
        askPlaceholderValues(result, placeholders, (finalText) => {
          // If the user cancelled/dismissed, abort the injection and restore state.
          if (finalText === null) {
            setState('idle');
            return;
          }
          try { insertFinal(finalText); } catch (err) {
            console.warn('Bandit: insertFinal threw after placeholder Q&A', err && err.message);
            setState('idle');
          }
        });
      } else {
        insertFinal(result);
      }
    }).catch(err => {
      stopThinking();
      const errMsg = err && err.message ? err.message : String(err);
      console.warn('Bandit: enhance failed', errMsg);
      setState('idle');
      say(`couldn't enhance that — ${escapeHTML(friendlyError(err))}<br><b>Set up key in settings 🔧</b>`, 4200);

      // Auto-open settings if it's an API key or missing provider issue
      if (errMsg.toLowerCase().includes('api key') || errMsg.toLowerCase().includes('cloud provider')) {
        setTimeout(() => {
          const btn = doc.getElementById('menuSettings');
          if (btn) btn.click();
        }, 1200);
      }
    });
  }
};

// --- END: pet/animations.js ---

// --- START: pet/ui.js ---
BanditEnv.initBanditUI = function(savedState) {
  // Mobile/trackpad gestures can be cancelled by the browser mid-drag (palm
  // rejection, OS gesture takeover, multi-touch). Treat it exactly like a
  // pointerup for cleanup purposes — but never as a click, so it can't enhance.
  window.addEventListener('pointercancel', e => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    clearTimeout(spinTimer);
    wrap.classList.remove('dragging');
    root.style.transition = '';
    try { wrap.releasePointerCapture(drag.pointerId); } catch (err) { /* noop */ }
    lastActivity = Date.now(); // restart the idle-to-sleep countdown from release, not from grab
    const wasDrag = drag.moved;
    drag = null;
    if (wasDrag) {
      persist({ position: { x: root.offsetLeft, y: root.offsetTop } }, { immediate: true });
    }
  }, { signal });

  // A shrinking viewport (resize, devtools panel, orientation flip) must never
  // leave Rocky stranded past the new edge. Never fights an active drag.
  function reclampToViewport() {
    if (drag) return;
    const clamped = clampToViewport(root.offsetLeft, root.offsetTop);
    if (clamped.x !== root.offsetLeft || clamped.y !== root.offsetTop) {
      root.style.left = clamped.x + 'px';
      root.style.top = clamped.y + 'px';
      root.style.right = 'auto';
      root.style.bottom = 'auto';
      persist({ position: { x: clamped.x, y: clamped.y } });
    }
  }
  window.addEventListener('resize', reclampToViewport, { signal });
  window.addEventListener('orientationchange', reclampToViewport, { signal });

  menuEnhance = doc.getElementById('menuEnhance');
  if (menuEnhance) menuEnhance.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    wrap.classList.remove('show-menu');
    enhancePrompt();
  });

  menuUndo = doc.getElementById('menuUndo');
  if (menuUndo) menuUndo.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    wrap.classList.remove('show-menu');
    pokeActivity();
    const inputEl = lastEnhance ? (lastEnhance.inputRef && typeof lastEnhance.inputRef.deref === 'function' ? lastEnhance.inputRef.deref() : lastEnhance.inputRef) : null;
    if (!inputEl || !inputEl.isConnected) {
      say('nothing to undo 🤷', 2400);
      return;
    }
    try {
      BanditInjector.setPromptText(inputEl, lastEnhance.original);
      lastEnhance = null;
      say('back to your original ↩️', 2400);
    } catch (err) {
      console.warn('Bandit: undo failed', err && err.message);
      say("couldn't undo that one 😖", 2400);
    }
  });

  menuMore = doc.getElementById('menuMore');
  menuExtra = doc.getElementById('menuExtra');
  if (menuMore && menuExtra) {
    menuMore.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      menuMore.style.display = 'none';
      menuExtra.style.display = 'flex';
    });
  }

  /* =========================================================
     HISTORY
     ========================================================= */
  if (BanditEnv.initHistory) BanditEnv.initHistory();

  menuDisable = doc.getElementById('menuDisable');
  if (menuDisable) menuDisable.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    wrap.classList.remove('show-menu');
    const hostname = window.location.hostname;
    if (!hostname) {
      say('I cannot be disabled on local files! 🐾', 3000);
      return;
    }
    (async () => {
      const currentState = window.RockyStorage ? await window.RockyStorage.loadState() : {};
      const currentList = currentState.disabledSites || [];
      if (!currentList.includes(hostname)) {
        persist({ disabledSites: [...currentList, hostname] }, { immediate: true });
      }
      say('ZZZ... (disabled on this site)');
      setTimeout(() => {
        if (shadowHost) {
          shadowHost.dispatchEvent(new CustomEvent('bandit-cleanup'));
          shadowHost.remove();
        } else {
          const root = document.getElementById('rocky-root');
          if (root) root.remove();
        }
      }, 1500);
    })().catch(err => console.warn('Bandit: disable failed', err));
  });

  menuHome = doc.getElementById('menuHome');
  if (menuHome) menuHome.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    wrap.classList.remove('show-menu');
    stopRun();
    setState('running');
    isFetching = true;

    const startX = root.offsetLeft;
    const startY = root.offsetTop;

    // Go to the bottom right corner (leave a small margin)
    const landing = clampToViewport(window.innerWidth - 120, window.innerHeight - 150);

    const dx = landing.x - startX;
    const dy = landing.y - startY;
    pet.className = `pet ${dx < 0 ? 'face-left' : 'face-right'}`;

    const dist = Math.hypot(dx, dy);
    const duration = dist * 4; // 4ms per pixel speed

    root.style.transition = `left ${duration}ms linear, top ${duration}ms linear`;
    root.style.right = 'auto';
    root.style.bottom = 'auto';
    root.style.left = landing.x + 'px';
    root.style.top = landing.y + 'px';

    if (fetchTimer) clearTimeout(fetchTimer);
    fetchTimer = setTimeout(() => {
      isFetching = false;
      root.style.transition = '';
      persist({ position: { x: root.offsetLeft, y: root.offsetTop } });
      // Force sleep — override last activity so the sleep interval doesn't wake him
      setState('sleeping');
      lastActivity = Date.now() + 999999; // prevent sleepInterval from waking him

      const oldHouse = doc.querySelector('.bandit-house');
      if (oldHouse) oldHouse.remove();

      const house = document.createElement('div');
      house.innerText = '🏕️';
      house.style.position = 'fixed';
      house.style.fontSize = '32px';
      house.style.left = (landing.x + 10) + 'px';
      house.style.top = (landing.y - 10) + 'px';
      house.style.zIndex = '90';
      house.className = 'bandit-house';
      docBody.appendChild(house);
    }, duration);
  });

  function runSummarize() {
    if (state === 'working') return;
    pokeActivity(); stopRun();

    let transcript = '';
    try {
      transcript = BanditScraper.scrapeConversation();
    } catch (err) {
      console.warn('Bandit: scrapeConversation threw', err);
    }

    if (!transcript || !transcript.trim()) {
      say("couldn't find a conversation to summarize here 🤔", 3000);
      return;
    }

    setState('working');
    sayThinking('reading through the chat 🔍');

    const SUMMARIZE_SYSTEM = window.RockyPrompts ? window.RockyPrompts.SUMMARIZE_SYSTEM : '';

    window.rockyAIPipeline(SUMMARIZE_SYSTEM, transcript, {
      actionKey: 'summarize',
      onProgress: (frac) => { stopThinking(); say(`downloading on-device AI… ${Math.round(frac * 100)}% 📥`, 0); },
    }).then(brief => {
      stopThinking();
      if (!brief || !brief.trim()) {
        setState('idle');
        say("the AI returned nothing — try again 🤔", 3000);
        return;
      }
      recordHistory('summary', brief);
      return copyToClipboard(brief).then(() => {
        setState('happy');
        say('context brief copied 📋 — paste it into your next chat', 3400);
        gainXP(15);
        setTimeout(() => { if (state === 'happy') setState('idle'); }, 2600);
      }).catch(() => {
        // Copy failed but we still got the summary — show it anyway
        setState('happy');
        say('summary ready but copy failed — check History 📜', 3400);
        gainXP(15);
        setTimeout(() => { if (state === 'happy') setState('idle'); }, 2600);
      });
    }).catch(err => {
      stopThinking();
      const errMsg = err && err.message ? err.message : String(err);
      console.warn('Bandit: summarize failed', errMsg);
      setState('idle');
      say(`couldn't get that summary — ${escapeHTML(friendlyError(err))}<br><b>Set up key in settings 🔧</b>`, 4200);

      if (errMsg.toLowerCase().includes('api key') || errMsg.toLowerCase().includes('cloud provider')) {
        setTimeout(() => {
          const btn = doc.getElementById('menuSettings');
          if (btn) btn.click();
        }, 1200);
      }
    });
  }

  menuSummarize = doc.getElementById('menuSummarize');
  if (menuSummarize) menuSummarize.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    wrap.classList.remove('show-menu');
    runSummarize();
  });

  function eatApple(xpAmount) {
    stopRun();
    setState('idle');

    const apple = document.createElement('div');
    apple.innerText = '🍎';
    apple.style.position = 'absolute';
    apple.style.fontSize = '24px';
    apple.style.zIndex = '100';
    const isLeft = pet.classList.contains('face-left');
    apple.style.top = '50px';
    apple.style.left = isLeft ? '10px' : '80px';
    apple.style.transition = 'all 0.3s cubic-bezier(0.3, 1.4, 0.5, 1)';
    apple.style.transform = 'scale(0)';
    pet.appendChild(apple);

    setTimeout(() => apple.style.transform = 'scale(1)', 50);

    setTimeout(() => {
      eyesHappy();
      apple.style.transform = 'scale(0) translateY(10px)';
    }, 400);

    setTimeout(() => {
      apple.remove();
      eyesOpen();
      setState('happy');
      say(`nom nom nom 🍎 <span class="xp-pop">+${xpAmount} XP</span>`, 2500);
      gainXP(xpAmount);
      setTimeout(() => { if (state === 'happy') setState('idle') }, 2500);
    }, 700);
  }

  SNACKS = ['🍪', '🍎', '🍩', '🍕', '🌮', '🧁'];
  function spawnFeedTreat() {
    stopRun();
    setState('idle');

    const snack = SNACKS[Math.floor(Math.random() * SNACKS.length)];
    const treat = document.createElement('div');
    treat.innerText = snack;
    treat.style.position = 'absolute';
    treat.style.fontSize = '22px';
    treat.style.zIndex = '100';
    const isLeft = pet.classList.contains('face-left');
    treat.style.top = '-16px';
    treat.style.left = isLeft ? '10px' : '80px';
    treat.style.transition = 'all 0.35s cubic-bezier(0.3, 1.4, 0.5, 1)';
    treat.style.transform = 'scale(0) translateY(0)';
    pet.appendChild(treat);

    setTimeout(() => { treat.style.transform = 'scale(1) translateY(66px)'; }, 50);

    setTimeout(() => {
      eyesHappy();
      treat.style.transform = 'scale(0) translateY(76px)';
      spawnHeart();
    }, 420);

    setTimeout(() => { spawnHeart(); }, 600);
    setTimeout(() => { spawnHeart(); }, 780);

    setTimeout(() => {
      treat.remove();
      eyesOpen();
      setState('happy');
      say(`nom nom nom ${snack} <span class="xp-pop">+5 XP</span>`, 2500);
      gainXP(5);
      setTimeout(() => { if (state === 'happy') setState('idle') }, 2500);
    }, 700);
  }

  feedCountdownTimer = null;
  function showFeedCooldown(remainingMs) {
    clearInterval(feedCountdownTimer);
    let secs = Math.ceil(remainingMs / 1000);
    say(`I'm full… try again in ${secs}s 🦝`, 0);
    feedCountdownTimer = setInterval(() => {
      secs--;
      if (secs <= 0) {
        clearInterval(feedCountdownTimer);
        bubble.classList.remove('show');
        return;
      }
      say(`I'm full… try again in ${secs}s 🦝`, 0);
    }, 1000);
    cleanupTasks.push(() => clearInterval(feedCountdownTimer));
  }

  function feedRocky() {
    pokeActivity();
    const remaining = FEED_COOLDOWN_MS - (Date.now() - lastFedAt);
    if (remaining > 0) {
      showFeedCooldown(remaining);
      return;
    }
    lastFedAt = Date.now();
    persist({ lastFedAt }, { immediate: true });
    spawnFeedTreat();
  }

  menuFeed = doc.getElementById('menuFeed');
  if (menuFeed) menuFeed.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    wrap.classList.remove('show-menu');
    feedRocky();
  });
  /* =========================================================
     SETTINGS
     ========================================================= */
  if (BanditEnv.initSettings) BanditEnv.initSettings();


  /* Keyboard shortcut: Ctrl+Shift+E (or Cmd+Shift+E on Mac) → Enhance */
  window.addEventListener('keydown', e => {
    pokeActivity();
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      e.stopPropagation();
      enhancePrompt();
    }
  }, { signal });



  window.addEventListener('pointerdown', e => {
    if (!getClosest(e, '#rocky-root')) pokeActivity();
  }, { signal });

  /* =========================================================
     HYDRATE FROM SAVED STATE, THEN REVEAL
     ========================================================= */
  // Apply size BEFORE position: clampToViewport() measures Rocky's actual
  // rendered box, which the --pet-scale zoom affects.
  hydratedSize = (hydrated.settings && hydrated.settings.size) || 1;
  wrap.style.setProperty('--pet-scale', hydratedSize);
  if (settingSize) settingSize.value = hydratedSize;

  // The saved spot may have come from a bigger screen — clamp it back on-screen.
  if (hydrated.position && typeof hydrated.position.x === 'number' && typeof hydrated.position.y === 'number') {
    const clampedStart = clampToViewport(hydrated.position.x, hydrated.position.y);
    root.style.left = clampedStart.x + 'px';
    root.style.top = clampedStart.y + 'px';
    root.style.right = 'auto';
    root.style.bottom = 'auto';
    if (clampedStart.x !== hydrated.position.x || clampedStart.y !== hydrated.position.y) {
      persist({ position: { x: clampedStart.x, y: clampedStart.y } });
    }
  }
  if (sizeValue) sizeValue.textContent = Math.round(hydratedSize * 100) + '%';
  if (settingName) settingName.value = petName;

  applyAccessories(level);
  updateXPDisplay();

  // If Rocky levels up (or gets renamed) in another tab, mirror it here live —
  // but don't touch position, so the two tabs' independent wandering doesn't fight.
  function applyRemoteState(remote) {
    if (!remote) return;
    let changed = false;
    if (remote.petName && remote.petName !== petName) {
      petName = remote.petName;
      if (settingName) settingName.value = petName;
      changed = true;
    }
    if (typeof remote.xp === 'number' && remote.xp !== xp) { xp = remote.xp; changed = true; }
    if (typeof remote.level === 'number' && remote.level !== level) {
      level = remote.level;
      applyAccessories(level);
      changed = true;
    }
    if (typeof remote.provider === 'string' || typeof remote.apiKey === 'string' || typeof remote.model === 'string' || remote.apiKeys) {
      aiSettings = {
        provider: typeof remote.provider === 'string' ? remote.provider : aiSettings.provider,
        apiKey: typeof remote.apiKey === 'string' ? remote.apiKey : aiSettings.apiKey,
        model: typeof remote.model === 'string' ? remote.model : aiSettings.model,
        apiKeys: remote.apiKeys && typeof remote.apiKeys === 'object' ? remote.apiKeys : aiSettings.apiKeys,
      };
    }
    if (typeof remote.lastFedAt === 'number') lastFedAt = remote.lastFedAt;
    if (typeof remote.enhanceStyle === 'string') enhanceStyle = remote.enhanceStyle;
    if (typeof remote.askPlaceholders === 'boolean') askPlaceholders = remote.askPlaceholders;
    if (Array.isArray(remote.history)) copyHistory = remote.history;
    if (changed) updateXPDisplay();
  }
  if (window.RockyStorage) window.RockyStorage.onStateChanged(applyRemoteState);

  // Catch any pending debounced write before the page (and this script) is torn down.
  window.addEventListener('beforeunload', () => {
    if (window.RockyStorage) window.RockyStorage.flush();
  }, { signal });

  cleanupTasks.push(() => {
    clearTimeout(gainXP._t);
    clearTimeout(say._t);
    stopRun();
    lastEnhance = null;
  });

  root.style.visibility = '';

  // The stylesheet may not have finished applying when hydration first
  // measured Rocky's box above (clampToViewport's 150x180 fallback covers that
  // gap). Re-clamp once layout has definitely settled, using the real
  // measurement — rAF for the common case, 'load' as a belt-and-suspenders for
  // slow-loading pages where even a rAF fires before styles are in.
  initialRaf = requestAnimationFrame(reclampToViewport);
  cleanupTasks.push(() => cancelAnimationFrame(initialRaf));
  window.addEventListener('load', reclampToViewport, { signal });

  // Daily streak: first visit each local day counts; consecutive days earn +5 XP.
  (function checkDailyStreak() {
    const fmt = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    const today = fmt(Date.now());
    if (hydrated.lastVisitDay === today) return;
    const newStreak = hydrated.lastVisitDay === fmt(Date.now() - 86400000) ? (hydrated.streak || 0) + 1 : 1;
    persist({ lastVisitDay: today, streak: newStreak });
    if (newStreak >= 2) {
      setTimeout(() => {
        gainXP(5, true);
        say(`🔥 day ${newStreak} streak! <span class="xp-pop">+5 XP</span>`, 3200);
      }, 2200);
    }
  })();

  if (!hydrated.onboarded) {
    // Multi-step onboarding for new users — teaches them what Bandit does
    setTimeout(() => {
      say(`hi, I'm <b>${escapeHTML(petName)}</b> 🦝<br>I make your AI prompts way better!`, 4500);
    }, 700);
    setTimeout(() => {
      say('Type a rough idea in any text box,<br>then press <b>Ctrl+Shift+E</b> ⚡<br>I\'ll turn it into a pro prompt!', 6000);
    }, 5500);
    setTimeout(() => {
      say('<b>Click on me</b> for the full menu!<br>Or select text and <b>Right-Click</b> to enhance.', 5000);
      persist({ onboarded: true });
    }, 12000);
  } else if (Math.random() < 0.35) {
    // Returning user: occasional time-of-day hello, kept rare so it never nags.
    setTimeout(() => {
      if (state !== 'idle') return;
      const h = new Date().getHours();
      const g = h < 6 ? 'up late hacking? me too 🌙' : h < 12 ? 'morning! ☀️ let\'s build something' : h < 18 ? 'afternoon grind 🔨 let\'s go' : 'evening vibes 🌆 still at it?';
      say(g, 2600);
    }, 1400);
  }
  setTimeout(() => { if (state === 'idle') startRun(); }, 4200);
  // Listen for context menu requests
  if (rockyApi && rockyApi.runtime && rockyApi.runtime.onMessage) {
    rockyApi.runtime.onMessage.addListener((msg) => {
      if (msg.type === "ROCKY_TRIGGER_ENHANCE" && msg.text) {
        if (state !== 'idle') return;
        const dummyInput = {
          value: msg.text,
          tagName: 'TEXTAREA',
          isContentEditable: false,
          isConnected: false,
          focus: () => { },
          setAttribute: () => { },
          removeAttribute: () => { },
          isContextMenu: true
        };
        // We simulate a host input so enhancePrompt can run exactly as usual
        enhancePrompt(dummyInput, msg.text);
      }
    });
  }

}

// Auto-run if we are not in the Chrome Extension environment
if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
  window.addEventListener('DOMContentLoaded', () => {
    const demoRoot = document.getElementById('rocky-root');
    if (demoRoot) demoRoot.style.visibility = 'hidden';
    const loadPromise = window.RockyStorage ? window.RockyStorage.loadState() : Promise.resolve(null);
    loadPromise
      .catch(err => { console.warn('Bandit: state load failed, using defaults', err); return null; })
      .then(state => {
        const hostname = window.location.hostname;
        if (state && state.disabledSites && hostname && state.disabledSites.includes(hostname)) {
          if (demoRoot) demoRoot.remove();
          return;
        }
        initRocky(state);
      });
  });
};

// --- END: pet/ui.js ---

// --- START: pet/core.js ---
// pet/core.js - Bootloader
BanditEnv.initRocky = function(savedState) {
    if (BanditEnv.initBanditState) BanditEnv.initBanditState(savedState);
    if (BanditEnv.initBanditAnimations) BanditEnv.initBanditAnimations(savedState);
    if (BanditEnv.initBanditDrag) BanditEnv.initBanditDrag(savedState);
    if (BanditEnv.initBanditUI) BanditEnv.initBanditUI(savedState);
    if (BanditEnv.initHistory) BanditEnv.initHistory();
    if (BanditEnv.initSettings) BanditEnv.initSettings();
};

if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
  window.addEventListener('DOMContentLoaded', () => {
    const demoRoot = document.getElementById('rocky-root');
    if (demoRoot) demoRoot.style.visibility = 'hidden';
    const loadPromise = (typeof BanditEnv !== "undefined" ? BanditEnv.RockyStorage : window.RockyStorage) ? (typeof BanditEnv !== "undefined" ? BanditEnv.RockyStorage : window.RockyStorage).loadState() : Promise.resolve(null);
    loadPromise
      .catch(err => { console.warn('Bandit: state load failed, using defaults', err); return null; })
      .then(state => {
        const hostname = window.location.hostname;
        if (state && state.disabledSites && hostname && state.disabledSites.includes(hostname)) {
          if (demoRoot) demoRoot.remove();
          return;
        }
        BanditEnv.initRocky(state);
      });
  });
}

// --- END: pet/core.js ---

// --- START: content.js ---
// Avoid multiple injections
if (!window.rockyInjected) {
  window.rockyInjected = true;
  
  // Prevent injecting the extension over the native test page
  if (document.getElementById('rocky-root')) {
    console.log("Bandit is natively present on this page. Aborting extension injection to prevent duplicates.");
  } else {
  
  // Destroy any old clones left behind if the extension was reloaded without refreshing the page
  const oldHosts = document.querySelectorAll('#bandit-extension-host, #rocky-extension-host');
  oldHosts.forEach(h => {
    h.dispatchEvent(new CustomEvent('bandit-cleanup'));
    h.remove();
  });

  // Firefox uses browser.*, Chrome uses chrome.* — fall back between them.
  const api = globalThis.browser ?? globalThis.chrome;

  // Fetch cache busting state and load saved state in parallel.
  const statePromise = ((typeof BanditEnv !== "undefined" ? BanditEnv.RockyStorage : window.RockyStorage) ? (typeof BanditEnv !== "undefined" ? BanditEnv.RockyStorage : window.RockyStorage).loadState() : Promise.resolve(null))
    .catch(err => { console.warn('Bandit: state load failed, using defaults', err); return null; });

  statePromise
    .then((state) => {
      // If the user disabled Bandit for this site, abort and clean up
      if (state && state.disabledSites && state.disabledSites.includes(window.location.hostname)) {
        return;
      }

      // 1. Create the host element for the Shadow DOM
      const host = document.createElement('div');
      host.id = 'bandit-extension-host';
      host.style.position = 'fixed';
      host.style.zIndex = '2147483647'; 
      host.style.pointerEvents = 'none'; // let clicks pass through
      host.style.top = '0';
      host.style.left = '0';
      host.style.width = '100vw';
      host.style.height = '100vh';
      (document.body || document.documentElement).appendChild(host);

      // 2. Attach Shadow DOM
      const shadow = host.attachShadow({ mode: 'closed' });
      window.rockyShadowRoot = shadow;

      // 3. Inject HTML safely via template element
      const html = BanditEnv.BanditTemplate ? BanditEnv.BanditTemplate.html : '';
      const css = BanditEnv.BanditTemplate ? BanditEnv.BanditTemplate.css : '';

      const parser = new DOMParser();
      const parsedDoc = parser.parseFromString(html, 'text/html');
      const fragment = document.createDocumentFragment();
      while (parsedDoc.body.firstChild) {
        fragment.appendChild(parsedDoc.body.firstChild);
      }

      // Extract ONLY the pet and its settings
      const rockyRoot = fragment.querySelector('#rocky-root');
      const settingsModal = fragment.querySelector('#settingsModal');
      const toast = fragment.querySelector('#toast');

      // Stay invisible until BanditEnv.initRocky finishes hydrating from saved state.
      if (rockyRoot) rockyRoot.style.visibility = 'hidden';

      if (rockyRoot) shadow.appendChild(rockyRoot);
      if (settingsModal) shadow.appendChild(settingsModal);
      if (toast) shadow.appendChild(toast);

      // Allow pointer events ONLY on the specific interactive elements to prevent blocking the host page
      if (rockyRoot) {
        rockyRoot.style.pointerEvents = 'none';
        const petWrap = rockyRoot.querySelector('#petWrap');
        if (petWrap) petWrap.style.pointerEvents = 'none';

        const pet = rockyRoot.querySelector('#pet');
        if (pet) pet.style.pointerEvents = 'auto';

        const petMenu = rockyRoot.querySelector('#petMenu');
        if (petMenu) petMenu.style.pointerEvents = 'auto';
      }
      // (Removed settingsModal pointerEvents auto, as CSS handles it via .show)

      // 5. Inject CSS as a <style> tag to bypass strict CSP style-src rules
      // that block <link> tags on some host pages.
      const style = document.createElement('style');
      style.textContent = css;
      shadow.appendChild(style);

      // 6. Initialize Rocky logic (reveals itself once hydrated)
      if (typeof BanditEnv.initRocky === 'function') {
        BanditEnv.initRocky(state);
      } else {
        throw new Error('pet/core.js did not define initRocky (it may have failed to load)');
      }
    })
    .catch(err => {
      console.error("Bandit load error:", err);
      // Visible fallback so a failure is obvious without opening devtools.
      // The banner lives inside the shadow DOM, not on document.body,
      // so host-page scripts can't detect or read it.
      try {
        const banner = document.createElement('div');
        banner.textContent = 'Bandit failed to load: ' + ((err && err.message) || String(err));
        banner.style.cssText = 'position:fixed;bottom:8px;right:8px;z-index:2147483647;background:#c0392b;color:#fff;font:12px monospace;padding:8px 12px;border-radius:8px;max-width:320px;box-shadow:0 4px 12px rgba(0,0,0,.4);pointer-events:auto;';
        shadow.appendChild(banner);
        setTimeout(() => banner.remove(), 20000);
      } catch (bannerErr) { /* nothing more we can do */ }
    });
  }
}

// --- END: content.js ---

})();
