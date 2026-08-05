import { loadState } from '../storage.js';

const RATE_LIMIT_MS = 3000;
const NANO_TIMEOUT_MS = 15000;

function isDebugEnabled() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('rocky_debug') === '1';
  } catch (err) {
    return false;
  }
}

function debugLog(...args) {
  if (isDebugEnabled()) console.log('[Bandit AI]', ...args);
}

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
    try { if (session && typeof session.destroy === 'function') session.destroy(); } catch (err) { }
  }
}

function callBackgroundWorker(systemPrompt, userText, debug, onChunk) {
  const api = globalThis.browser ?? globalThis.chrome;
  return new Promise((resolve, reject) => {
    try {
      if (!api || !api.runtime || !api.runtime.sendMessage) {
        reject(new Error('extension messaging unavailable here'));
        return;
      }
      
      const requestId = Math.random().toString(36).substring(2);
      
      let chunkListener = null;
      if (onChunk) {
        chunkListener = (msg) => {
          if (msg.type === 'ROCKY_STREAM_CHUNK' && msg.requestId === requestId) {
            onChunk(msg.text);
          }
        };
        api.runtime.onMessage.addListener(chunkListener);
      }

      api.runtime.sendMessage(
        { type: 'ROCKY_AI_CALL', systemPrompt, userText, debug, requestId },
        (response) => {
          if (chunkListener) api.runtime.onMessage.removeListener(chunkListener);
          
          const lastErr = api.runtime.lastError;
          if (lastErr) { reject(new Error(lastErr.message)); return; }
          if (!response) { reject(new Error("no response from Bandit's background worker")); return; }
          if (!response.ok) { reject(new Error(response.error || 'AI call failed')); return; }
          resolve(response); // { ok, text, provider }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

async function getUserAIConfig() {
  try {
    const state = await loadState();
    const provider = state.provider || 'builtin';
    const hasBYOK = (state.apiKey && state.apiKey.trim()) ||
      (state.apiKeys && Object.values(state.apiKeys).some(k => k && k.trim()));
    return { provider, hasBYOK: !!hasBYOK };
  } catch (err) {
    return { provider: 'builtin', hasBYOK: false };
  }
}

const lastCallAtByAction = Object.create(null);

export async function aiPipeline(systemPrompt, userText, opts = {}) {
  const actionKey = opts.actionKey || 'default';
  const debug = isDebugEnabled();
  const startedAt = Date.now();

  const now = Date.now();
  if (now - (lastCallAtByAction[actionKey] || 0) < RATE_LIMIT_MS) {
    throw new Error('slow down — try again in a moment');
  }
  lastCallAtByAction[actionKey] = now;

  const config = await getUserAIConfig();

  // Speed optimization: Only try Nano if the user has NO cloud keys.
  if (!config.hasBYOK) {
    let nanoResult = null;
    try {
      nanoResult = await tryNano(systemPrompt, userText, opts.onProgress);
    } catch (err) {
      debugLog('tryNano threw unexpectedly', err && err.message);
    }
    if (nanoResult) {
      if (debug) console.log('[Bandit AI]', 'action=' + actionKey, 'provider=nano', (Date.now() - startedAt) + 'ms');
      return nanoResult;
    }

    if (config.provider === 'builtin') {
      throw new Error('on-device AI is unavailable right now, and "built-in only" is selected');
    }
  }

  const response = await callBackgroundWorker(systemPrompt, userText, debug, opts.onChunk);
  if (debug) console.log('[Bandit AI]', 'action=' + actionKey, 'provider=' + response.provider, (Date.now() - startedAt) + 'ms');
  return response.text;
}
