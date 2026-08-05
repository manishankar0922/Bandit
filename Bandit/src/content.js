import { loadState, saveState, onStateChanged, flush } from './storage.js';
import { aiPipeline } from './ai/pipeline.js';
import { buildSystemPrompt, SUMMARIZE_SYSTEM } from './ai/prompts.js';
import { getHostInput, setPromptText } from './ui/injector.js';
import { initSettings } from './ui/settings.js';
import { createDialog } from './ui/modals.js';
import { bindMenuHandlers } from './ui/menu.js';
import { initPet } from './pet/engine.js';
import { scrapeConversation } from './scraper.js';

// Injected by esbuild at compile time
const TEMPLATE_HTML = `__TEMPLATE_HTML__`;
const TEMPLATE_CSS = `__TEMPLATE_CSS__`;

const api = globalThis.browser ?? globalThis.chrome;
let state = null;
let petEngine = null;
let shadowRoot = null;
let container = null;
let settingsView = null;
let lastInputText = '';

async function boot() {
  if (document.getElementById('rocky-extension-host') || document.getElementById('bandit-extension-host')) return; // already injected
  
  state = await loadState();
  const hostname = window.location.hostname;
  if (state.disabledSites && state.disabledSites.includes(hostname)) {
    console.log(`[Bandit] disabled on ${hostname}`);
    return;
  }

  // Inject DOM
  container = document.createElement('div');
  container.id = 'bandit-extension-host';
  container.style.position = 'fixed';
  container.style.zIndex = '2147483647';
  container.style.pointerEvents = 'none';
  container.style.top = '0';
  container.style.left = '0';
  container.style.width = '100vw';
  container.style.height = '100vh';
  
  shadowRoot = container.attachShadow({ mode: 'closed' });
  window.banditShadowRoot = shadowRoot; // Expose for Puppeteer tests

  // Prevent host site (like ChatGPT) from stealing focus when typing in Bandit's UI
  shadowRoot.addEventListener('keydown', (e) => e.stopPropagation());
  shadowRoot.addEventListener('keyup', (e) => e.stopPropagation());
  shadowRoot.addEventListener('keypress', (e) => e.stopPropagation());
  
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(TEMPLATE_CSS);
    shadowRoot.adoptedStyleSheets = [sheet];
  } catch (err) {
    // Fallback for older browsers (though Firefox 109+ supports it)
    const style = document.createElement('style');
    style.textContent = TEMPLATE_CSS;
    shadowRoot.appendChild(style);
  }
  
  const parser = new DOMParser();
  const doc = parser.parseFromString(TEMPLATE_HTML, 'text/html');
  
  const rockyRoot = doc.querySelector('#rocky-root');
  const toast = doc.querySelector('#toast');
  const settingsModal = doc.querySelector('#settingsModal');
  
  if (rockyRoot) shadowRoot.appendChild(rockyRoot.cloneNode(true));
  if (toast) shadowRoot.appendChild(toast.cloneNode(true));
  if (settingsModal) shadowRoot.appendChild(settingsModal.cloneNode(true));
  
  (document.body || document.documentElement).appendChild(container);

  // Set up pointer events
  const rootEl = shadowRoot.getElementById('rocky-root');
  if (rootEl) rootEl.style.pointerEvents = 'none';
  
  const wrap = shadowRoot.getElementById('petWrap');
  if (!wrap) {
    console.error('[Bandit] failed to find petWrap in template');
    return;
  }
  wrap.style.pointerEvents = 'none';
  
  const petEl = shadowRoot.getElementById('pet');
  if (petEl) petEl.style.pointerEvents = 'auto';
  
  const petMenuEl = shadowRoot.getElementById('petMenu');
  if (petMenuEl) petMenuEl.style.pointerEvents = 'auto';
  
  // Provide callbacks to engine
  const callbacks = {
    persist: (partial, opts) => {
      saveState(partial, opts);
      // update local cache immediately
      Object.assign(state, partial); 
    }
  };
  
  petEngine = initPet(shadowRoot, state, callbacks);
  
  // Map settings state correctly
  const settingsState = {
    petName: state.petName,
    xp: state.xp,
    level: state.level,
    enhanceStyle: state.enhanceStyle,
    enhanceTone: state.enhanceTone,
    askPlaceholders: state.askPlaceholders,
    aiSettings: {
      provider: state.provider,
      apiKey: state.apiKey,
      apiKeys: state.apiKeys,
      model: state.model,
      customModel: state.customModel,
      customInstructions: state.customInstructions
    },
    settingsSize: state.settings?.size
    // History is fetched dynamically via getter now
  };
  
  const settingsCb = {
    persist: callbacks.persist,
    updateXPDisplay: () => {
      // Sync names back
      state.petName = settingsState.petName;
      petEngine.updateState({ petName: settingsState.petName });
    },
    testAIKey: async (cfg) => {
      if (!api || !api.runtime) throw new Error('No extension runtime');
      return new Promise((resolve, reject) => {
        api.runtime.sendMessage({ type: 'ROCKY_AI_TEST_KEY', ...cfg }, res => {
          if (!res) reject(new Error('No response'));
          else if (!res.ok) reject(new Error(res.error));
          else resolve(res);
        });
      });
    },
    friendlyError: (err) => err.message || String(err),
    applyAccessories: (lv) => petEngine.updateState({ level: lv })
  };
  
  settingsView = initSettings(shadowRoot, settingsState, settingsCb);
  
  // Menu callbacks
  const menuCb = {
    enhancePrompt: runEnhance,
    undoEnhance: runUndo,
    runSummarize: runSummarize,
    pokeActivity: petEngine.pokeActivity,
    disableOnSite: (host) => {
      const disabled = state.disabledSites || [];
      if (!disabled.includes(host)) {
        disabled.push(host);
        callbacks.persist({ disabledSites: disabled }, { immediate: true });
        container.remove();
      }
    },
    goHome: petEngine.goHome,
    feedRocky: petEngine.feed,
    say: petEngine.say,
    showToast: petEngine.showToast,
    openRockyModal: () => createDialog(null, shadowRoot),
    timeAgo: (iso) => {
      const ms = Date.now() - new Date(iso).getTime();
      const m = Math.floor(ms/60000);
      if (m < 1) return 'just now';
      if (m < 60) return m + 'm ago';
      const h = Math.floor(m/60);
      if (h < 24) return h + 'h ago';
      return Math.floor(h/24) + 'd ago';
    },
    copyToClipboard: (text) => navigator.clipboard.writeText(text),
    persist: callbacks.persist,
    showSettings: settingsView.show,
    getHistory: () => state.history || []
  };
  
  bindMenuHandlers(shadowRoot, wrap, settingsState, menuCb);

  // Message listener (for context menu)
  if (api && api.runtime) {
    api.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'ROCKY_CTX_ENHANCE') runEnhance();
      else if (msg.type === 'ROCKY_CTX_SUMMARIZE') runSummarize();
      else if (msg.type === 'ROCKY_TOGGLE') {
        if (msg.disabled) container.remove();
      }
    });
  }
  
  // Watch for state changes from other tabs
  onStateChanged((newState) => {
    state = newState;
    petEngine.updateState({ xp: state.xp, level: state.level });
  });

  // Welcome back logic (once per day)
  const today = new Date().toISOString().split('T')[0];
  if (state.lastVisitDay !== today) {
    callbacks.persist({ lastVisitDay: today, streak: (state.streak || 0) + 1 });
    setTimeout(() => {
      petEngine.say(`Welcome back! 🐾<br>Streak: ${state.streak + 1} days`, 4000);
      petEngine.playAnimation('happy', 1500);
    }, 1000);
  }
}

// Actions
async function runEnhance(followUpText = null) {
  petEngine.pokeActivity();
  const input = getHostInput();
  if (!input) {
    petEngine.say("I don't see any active text box to enhance! Click inside a chat box first.", 4000);
    return;
  }
  
  const text = input.value || input.innerText;
  if (!text || text.trim().length < 2) {
    petEngine.say("Type a little more first! I need something to work with.", 3000);
    return;
  }
  
  if (!followUpText) lastInputText = text;
  
  petEngine.say(followUpText ? "Refining... ✨" : "Enhancing... ✨", 0);
  petEngine.playAnimation('working', 99999); // loop until done
  
  try {
    let sys = buildSystemPrompt(state.enhanceStyle, state.enhanceTone, state.customInstructions);
    if (followUpText) {
      sys += `\n\nThe user wants you to refine the prompt further with this instruction: "${followUpText}". Output ONLY the newly refined prompt.`;
    }
    
    const result = await aiPipeline(sys, text, { 
      actionKey: 'enhance',
      onChunk: (currentText) => {
        setPromptText(input, currentText);
      }
    });
    
    if (result.includes('ERROR_GIBBERISH')) {
      petEngine.say("That looks like gibberish to me! Try writing a real sentence.", 4000);
    } else {
      setPromptText(input, result);
      petEngine.addXP(2);
      saveHistory(followUpText ? 'refine' : 'enhance', result);
      
      // Enter the Continuous Feature Loop
      petEngine.askForRefinement("Done! ✨<br>Need tweaks?", (refinement) => {
        runEnhance(refinement);
      });
    }
  } catch (err) {
    petEngine.say("Oops, hit a snag 😖<br>" + (err.message || String(err)), 5000);
  } finally {
    const wrap = shadowRoot.getElementById('petWrap');
    if (wrap) wrap.classList.remove('working');
  }
}

function runUndo() {
  if (!lastInputText) {
    petEngine.say("I don't remember what was there before! 😖", 3000);
    return;
  }
  const input = getHostInput();
  if (!input) {
    petEngine.say("Click the text box first so I know where to undo!", 3000);
    return;
  }
  setPromptText(input, lastInputText);
  petEngine.say("Undid that! ↩️", 2000);
}

async function runSummarize() {
  petEngine.pokeActivity();
  const text = scrapeConversation();
  if (!text || text.length < 50) {
    petEngine.say("I can't find a conversation here to summarize! Make sure you are on a chat page.", 4000);
    return;
  }
  
  petEngine.say("Summarizing... 📋", 0);
  const wrap = shadowRoot.getElementById('petWrap');
  if (wrap) wrap.classList.add('working');
  
  try {
    const result = await aiPipeline(SUMMARIZE_SYSTEM, "Chat history:\n\n" + text.slice(-30000), { 
      actionKey: 'summarize',
      onChunk: (currentText) => {
        // If we want to show a preview while summarizing, we can toast it or update the clipboard preview
        // For now, streaming straight to the final clipboard text is enough.
      }
    });
    
    saveHistory('summary', result);
    
    try {
      await navigator.clipboard.writeText(result);
      petEngine.say("Summary copied to clipboard! 📋✨", 4000);
      petEngine.addXP(5);
    } catch (err) {
      // Show manual copy dialog if clipboard fails
      const { modal, close } = createDialog(null, shadowRoot);
      modal.innerHTML = `
        <h3 style="margin-bottom:8px">📋 Chat Summary</h3>
        <p style="font-size:12px;margin-bottom:12px">Copy this to continue the context in a new chat:</p>
        <textarea readonly style="width:100%;min-height:120px;font-family:monospace;font-size:11px;background:var(--bg);color:var(--text);padding:8px;border:1px solid var(--line);border-radius:6px;margin-bottom:12px">${result}</textarea>
        <button id="sm-close">Done</button>
      `;
      modal.querySelector('#sm-close').addEventListener('click', close);
      modal.querySelector('textarea').select();
      petEngine.say("Here is your summary! 📋", 3000);
      petEngine.addXP(5);
    }
  } catch (err) {
    petEngine.say("Failed to summarize 😖<br>" + (err.message || String(err)), 5000);
  } finally {
    if (wrap) wrap.classList.remove('working');
  }
}

function saveHistory(type, text) {
  const history = state.history || [];
  history.unshift({ type, text, at: new Date().toISOString() });
  if (history.length > 20) history.pop();
  state.history = history;
  saveState({ history }, { immediate: true });
}

// Hotkey
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'E' || e.key === 'e')) {
    e.preventDefault();
    runEnhance();
  }
});

// Boot it up when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
