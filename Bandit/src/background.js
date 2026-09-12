import { loadState, saveState, onStateChanged, DEFAULTS } from './storage.js';
import { buildRequest, parseResponse, parseStreamChunk } from './ai/providers.js';

const api = globalThis.browser ?? globalThis.chrome;

// Basic cache for context menu state
let lastSeenProvider = 'builtin';
let isEnabled = true;

// Context menus creation
function setupContextMenus() {
  if (!api || !api.contextMenus) return;
  try {
    api.contextMenus.removeAll(() => {
      if (api.runtime.lastError) { /* ignore */ }
      api.contextMenus.create({
        id: 'rocky-enhance',
        title: '✨ Enhance Prompt with Bandit',
        contexts: ['editable', 'selection']
      });
      api.contextMenus.create({
        id: 'rocky-templates',
        title: '🧩 Prompt Templates Library',
        contexts: ['editable', 'page']
      });
      api.contextMenus.create({
        id: 'rocky-summarize',
        title: '📋 Summarize Chat',
        contexts: ['page', 'selection']
      });
    });
  } catch (_) {}
}

// In MV3, listeners must be registered synchronously on top level
if (api && api.contextMenus && api.contextMenus.onClicked) {
  api.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab || !tab.id) return;
    if (info.menuItemId === 'rocky-enhance') {
      api.tabs.sendMessage(tab.id, { type: 'ROCKY_CTX_ENHANCE' }).catch(() => {});
    } else if (info.menuItemId === 'rocky-templates') {
      api.tabs.sendMessage(tab.id, { type: 'ROCKY_CTX_TEMPLATES' }).catch(() => {});
    } else if (info.menuItemId === 'rocky-summarize') {
      api.tabs.sendMessage(tab.id, { type: 'ROCKY_CTX_SUMMARIZE' }).catch(() => {});
    }
  });
}

if (api && api.runtime && api.runtime.onInstalled) {
  api.runtime.onInstalled.addListener(() => {
    setupContextMenus();
  });
}
if (api && api.runtime && api.runtime.onStartup) {
  api.runtime.onStartup.addListener(() => {
    setupContextMenus();
  });
}
setupContextMenus();

// Message routing
if (api && api.runtime) {
  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'ROCKY_AI_CALL') {
      handleAICall(msg, sender).then(sendResponse);
      return true; // async response
    }
    if (msg.type === 'ROCKY_AI_TEST_KEY') {
      handleTestKey(msg).then(sendResponse);
      return true;
    }
  });
}

async function handleAICall(msg, sender) {
  try {
    const state = await loadState();
    const provider = state.provider || 'builtin';
    
    if (provider === 'builtin') {
      // If we got here, Nano failed in the content script, and the user has no keys.
      throw new Error('On-device AI failed, and no API keys are set. Open settings (⚙️) to add one.');
    }
    
    const apiKeys = state.apiKeys || {};
    const apiKey = apiKeys[provider] || state.apiKey;
    
    if (!apiKey) {
      throw new Error(`No API key saved for ${provider}. Open settings (⚙️) to add one.`);
    }

    const req = buildRequest(provider, {
      apiKey,
      model: state.customModel || state.model,
      systemPrompt: msg.systemPrompt,
      userText: msg.userText,
      maxTokens: 500
    });

    if (msg.debug) console.log(`[Bandit BG] fetching ${provider} via ${req.url}`);

    const res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body)
    });

    if (!res.ok) {
      let errText = `HTTP ${res.status}`;
      try {
        const data = await res.json();
        errText = (data.error && data.error.message) || errText;
      } catch (e) {}
      throw new Error(errText);
    }
    
    if (!res.body) throw new Error("No response body from API");

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let fullText = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line in buffer
      
      let chunkText = '';
      for (const line of lines) {
        if (line.trim() === '') continue;
        const text = parseStreamChunk(provider, line);
        if (text) chunkText += text;
      }
      
      if (chunkText) {
        fullText += chunkText;
        if (msg.requestId && sender && sender.tab && sender.tab.id) {
          api.tabs.sendMessage(sender.tab.id, {
            type: 'ROCKY_STREAM_CHUNK',
            requestId: msg.requestId,
            text: fullText
          }).catch(() => {});
        }
      }
    }
    
    if (buffer.trim() !== '') {
      const text = parseStreamChunk(provider, buffer);
      if (text) fullText += text;
    }

    return { ok: true, text: fullText.trim(), provider };
    const trimmed = fullText.trim();
    if (!trimmed) {
      throw new Error(`The model returned an empty response. Please check your prompt or API key.`);
    }

    return { ok: true, text: trimmed, provider };
    
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

async function handleTestKey(msg) {
  try {
    const provider = msg.provider;
    if (provider === 'builtin') return { ok: true, provider };
    
    const req = buildRequest(provider, {
      apiKey: msg.apiKey,
      model: msg.model,
      systemPrompt: 'You are a test script. Reply with "OK".',
      userText: 'Hello.',
      maxTokens: 10,
      stream: false
    });

    const res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body)
    });
    
    let data;
    try {
      data = await res.json();
    } catch (parseErr) {
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Failed to reach API`);
      }
      throw new Error('API returned unparseable response');
    }

    if (!res.ok) {
      throw new Error((data.error && data.error.message) || `HTTP ${res.status}`);
      const errDetail = (data && data.error && (data.error.message || data.error)) || `HTTP ${res.status}`;
      throw new Error(errDetail);
    }
    
    // Validate response structure
    parseResponse(provider, data);
    return { ok: true, provider };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}
