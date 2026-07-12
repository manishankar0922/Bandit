// rockyAIPipeline(systemPrompt, userText, opts) — the ONLY entry point for
// Rocky's AI features (Enhance + Summarize both call this, nothing else).
//
// Order:
//   1. Chrome's on-device Prompt API (Gemini Nano) — free, on-device, no key.
//      Runs right here in the content script. Any failure/unavailability
//      falls through silently to step 2.
//   2. The background service worker, which holds the user's BYOK provider
//      + key in chrome.storage.local and calls their chosen provider.
//
// Each action (Enhance, Summarize) is rate-limited to once per 3s
// independently. Prompt text and API keys are never logged, even in debug
// mode — debug mode (localStorage.rocky_debug === "1", set per-site in
// DevTools) only logs which provider handled a call and how long it took.
(function (root) {
  const RATE_LIMIT_MS = 3000;
  const NANO_TIMEOUT_MS = 30000;

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

  function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  // Tries the on-device model. Returns the generated string, or null if Nano
  // isn't available/usable here — callers fall back to BYOK on null.
  async function tryNano(systemPrompt, userText, onProgress) {
    if (typeof LanguageModel === 'undefined') {
      debugLog('LanguageModel global not present in this browser');
      return null;
    }

    let availability;
    try {
      availability = await LanguageModel.availability();
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
      session = await withTimeout(
        LanguageModel.create({
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
        }),
        NANO_TIMEOUT_MS,
        'on-device model setup'
      );

      const result = await withTimeout(session.prompt(userText), NANO_TIMEOUT_MS, 'on-device generation');
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

  async function isBuiltInOnly() {
    try {
      if (!root.RockyStorage) return false;
      const state = await root.RockyStorage.loadState();
      return state.provider === 'builtin';
    } catch (err) {
      return false;
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

    let nanoResult = null;
    try {
      nanoResult = await tryNano(systemPrompt, userText, opts.onProgress);
    } catch (err) {
      debugLog('tryNano threw unexpectedly', err && err.message);
      nanoResult = null;
    }
    if (nanoResult) {
      if (debug) console.log('[Rocky AI]', 'action=' + actionKey, 'provider=nano', (Date.now() - startedAt) + 'ms');
      return nanoResult;
    }

    if (await isBuiltInOnly()) {
      throw new Error('on-device AI is unavailable right now, and "built-in only" is selected');
    }

    const response = await callBackgroundWorker(systemPrompt, userText, debug);
    if (debug) console.log('[Rocky AI]', 'action=' + actionKey, 'provider=' + response.provider, (Date.now() - startedAt) + 'ms');
    return response.text;
  }

  root.rockyAIPipeline = rockyAIPipeline;
})(typeof window !== 'undefined' ? window : globalThis);
