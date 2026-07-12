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
    petName: 'Rocky',
    position: { x: null, y: null },
    onboarded: false,
    settings: { size: 1 },
    lastFedAt: 0,
    provider: 'builtin', // 'builtin' | 'anthropic' | 'openai' | 'gemini' | 'groq'
    apiKey: '',
    model: '', // optional override; empty = provider's default model
    enhanceStyle: 'structured', // 'structured' | 'concise' | 'detailed'
    askPlaceholders: true, // after enhance, ask the user to fill [placeholders]
    streak: 0, // consecutive days Rocky has been visited
    lastVisitDay: '', // 'YYYY-MM-DD' of the last counted visit
  };

  const KNOWN_PROVIDERS = ['builtin', 'anthropic', 'openai', 'gemini', 'groq'];
  const KNOWN_STYLES = ['structured', 'concise', 'detailed'];

  const storageApiPresent = !!(api && api.storage && api.storage.local);

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // Missing/older-version fields fall back to defaults instead of crashing.
  // Also does a one-time migration from the older nested `ai: {provider, apiKey, model}`
  // shape into the current flat provider/apiKey fields (openai, previously supported,
  // has no home here anymore — falls back to 'builtin').
  function mergeDefaults(stored) {
    const s = stored || {};
    const legacyAI = s.ai && typeof s.ai === 'object' ? s.ai : null;
    const migratedProvider = legacyAI && KNOWN_PROVIDERS.includes(legacyAI.provider) ? legacyAI.provider : null;
    const migratedApiKey = legacyAI && typeof legacyAI.apiKey === 'string' ? legacyAI.apiKey : null;

    return {
      xp: typeof s.xp === 'number' ? s.xp : DEFAULTS.xp,
      level: typeof s.level === 'number' ? s.level : DEFAULTS.level,
      petName: typeof s.petName === 'string' && s.petName.trim() ? s.petName : DEFAULTS.petName,
      position: {
        x: typeof s.position?.x === 'number' ? s.position.x : DEFAULTS.position.x,
        y: typeof s.position?.y === 'number' ? s.position.y : DEFAULTS.position.y,
      },
      onboarded: typeof s.onboarded === 'boolean' ? s.onboarded : DEFAULTS.onboarded,
      settings: {
        ...DEFAULTS.settings,
        ...(s.settings && typeof s.settings === 'object' ? s.settings : {}),
      },
      lastFedAt: typeof s.lastFedAt === 'number' ? s.lastFedAt : DEFAULTS.lastFedAt,
      provider: typeof s.provider === 'string' && KNOWN_PROVIDERS.includes(s.provider)
        ? s.provider
        : (migratedProvider || DEFAULTS.provider),
      apiKey: typeof s.apiKey === 'string' ? s.apiKey : (migratedApiKey || DEFAULTS.apiKey),
      model: typeof s.model === 'string' ? s.model : (legacyAI && typeof legacyAI.model === 'string' ? legacyAI.model : DEFAULTS.model),
      enhanceStyle: KNOWN_STYLES.includes(s.enhanceStyle) ? s.enhanceStyle : DEFAULTS.enhanceStyle,
      askPlaceholders: typeof s.askPlaceholders === 'boolean' ? s.askPlaceholders : DEFAULTS.askPlaceholders,
      streak: typeof s.streak === 'number' ? s.streak : DEFAULTS.streak,
      lastVisitDay: typeof s.lastVisitDay === 'string' ? s.lastVisitDay : DEFAULTS.lastVisitDay,
    };
  }

  let memoryState = clone(DEFAULTS);
  let storageAvailable = storageApiPresent;
  let debounceTimer = null;
  let pending = null;

  async function loadState() {
    if (!storageAvailable) return clone(memoryState);
    try {
      const result = await api.storage.local.get(STORAGE_KEY);
      memoryState = mergeDefaults(result ? result[STORAGE_KEY] : null);
      return clone(memoryState);
    } catch (err) {
      console.warn('Rocky: storage.local.get failed, falling back to in-memory state', err);
      storageAvailable = false;
      return clone(memoryState);
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
      console.warn('Rocky: storage.local.set failed, falling back to in-memory state', err);
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
      });
      pending = memoryState;

      clearTimeout(debounceTimer);
      if (opts.immediate) {
        flush();
      } else {
        debounceTimer = setTimeout(flush, DEBOUNCE_MS);
      }
    } catch (err) {
      console.warn('Rocky: saveState failed, state kept in-memory only', err);
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
        callback(clone(memoryState));
      };
      api.storage.onChanged.addListener(listener);
      return () => {
        try { api.storage.onChanged.removeListener(listener); } catch (err) { /* noop */ }
      };
    } catch (err) {
      console.warn('Rocky: onStateChanged listener failed to attach', err);
      return () => {};
    }
  }

  root.RockyStorage = { loadState, saveState, onStateChanged, flush, DEFAULTS };
})(typeof window !== 'undefined' ? window : globalThis);
