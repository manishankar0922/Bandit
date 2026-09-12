// Mock chrome.runtime for local testing without the extension background worker
if (!window.chrome) window.chrome = {};
if (!window.chrome.runtime) {
  // Seed fake state so it doesn't try to use Nano (which fails in some local contexts)
  const mockState = { provider: 'openai', apiKeys: { openai: 'test_key' } };

  window.chrome.storage = {
    local: {
      get: (keys, callback) => {
        const keyList = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
        const result = {};
        for (const k of keyList) {
          result[k] = mockState;
        }
        if (callback) callback(result);
        return Promise.resolve(result);
      },
      set: (obj, callback) => {
        if (obj && typeof obj === 'object') {
          const val = Object.values(obj)[0];
          if (val && typeof val === 'object') Object.assign(mockState, val);
        }
        if (callback) callback();
        return Promise.resolve();
      }
    },
    onChanged: { addListener: () => {}, removeListener: () => {} }
  };

  const listeners = [];

  window.chrome.runtime = {
    sendMessage: function(msg, callback) {
      if (msg.type === 'ROCKY_AI_CALL') {
        if (msg.requestId) {
          setTimeout(() => {
            listeners.forEach(fn => {
              try { fn({ type: 'ROCKY_STREAM_CHUNK', requestId: msg.requestId, text: 'This is a mocked AI response! ✨' }); } catch (_) {}
            });
          }, 400);
        }
        setTimeout(() => {
          if (callback) callback({ ok: true, text: "This is a mocked AI response! ✨ Your prompt was: " + msg.userText, provider: 'mock' });
        }, 800);
      } else if (msg.type === 'ROCKY_AI_TEST_KEY') {
        setTimeout(() => { if (callback) callback({ ok: true }); }, 300);
      }
    },
    onMessage: {
      addListener: (fn) => { if (!listeners.includes(fn)) listeners.push(fn); },
      removeListener: (fn) => {
        const idx = listeners.indexOf(fn);
        if (idx !== -1) listeners.splice(idx, 1);
      }
    }
  };
}

if (!window.browser) window.browser = window.chrome;
