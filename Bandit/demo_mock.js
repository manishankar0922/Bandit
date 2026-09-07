// Mock chrome.runtime for local testing without the extension background worker
if (!window.chrome) window.chrome = {};
if (!window.chrome.runtime) {
  // Seed fake state so it doesn't try to use Nano (which fails in some local contexts)
  const mockState = { provider: 'openai', apiKeys: { openai: 'test_key' } };

  window.chrome.storage = {
    local: {
      get: (key) => Promise.resolve({ [key]: mockState }),
      set: (obj) => { Object.assign(mockState, Object.values(obj)[0]); return Promise.resolve(); }
    },
    onChanged: { addListener: () => {}, removeListener: () => {} }
  };

  window.chrome.runtime = {
    sendMessage: function(msg, callback) {
      if (msg.type === 'ROCKY_AI_CALL') {
        setTimeout(() => {
          callback({ ok: true, text: "This is a mocked AI response! ✨ Your prompt was: " + msg.userText, provider: 'mock' });
        }, 1500);
      } else if (msg.type === 'ROCKY_AI_TEST_KEY') {
        setTimeout(() => callback({ ok: true }), 500);
      }
    },
    onMessage: { addListener: () => {}, removeListener: () => {} }
  };
}
