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
