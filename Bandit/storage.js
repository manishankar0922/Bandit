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
