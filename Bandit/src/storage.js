// State persistence layer.
// Works in both extension (chrome.storage.local) and demo page (in-memory).

const STORAGE_KEY = 'rockyState';
const DEBOUNCE_MS = 300;

export const DEFAULTS = {
  xp: 0,
  level: 1,
  petName: 'Bandit',
  position: { x: null, y: null },
  onboarded: false,
  settings: { size: 1 },
  lastFedAt: 0,
  provider: 'builtin',
  apiKey: '',
  apiKeys: {},
  model: '',
  customModel: '',
  customInstructions: '',
  enhanceStyle: 'structured',
  enhanceTone: 'professional',
  askPlaceholders: false,
  streak: 0,
  lastVisitDay: '',
  history: [],
  disabledSites: [],
  lastSeenVersion: '',
  updateMessageCount: 0,
};

const KNOWN_PROVIDERS = ['builtin', 'anthropic', 'openai', 'gemini', 'groq', 'nvidia'];
const KNOWN_STYLES = ['structured', 'concise', 'detailed'];
const KNOWN_TONES = ['professional', 'casual', 'academic', 'creative'];

const api = globalThis.browser ?? globalThis.chrome;
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

export async function loadState() {
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

export function flush() {
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

export function saveState(partial, opts = {}) {
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

export function onStateChanged(callback) {
  if (!storageAvailable || !api.storage.onChanged) return () => {};
  try {
    const listener = (changes, areaName) => {
      if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
      memoryState = mergeDefaults(changes[STORAGE_KEY].newValue);
      callback(structuredClone(memoryState));
    };
    api.storage.onChanged.addListener(listener);
    return () => {
      try { api.storage.onChanged.removeListener(listener); } catch (err) {}
    };
  } catch (err) {
    console.warn('Bandit: onStateChanged listener failed to attach', err);
    return () => {};
  }
}

if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('beforeunload', () => {
    if (pending) flush();
  });
}
