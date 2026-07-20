function initRocky(savedState) {
  const doc = (typeof window.rockyShadowRoot !== 'undefined') ? window.rockyShadowRoot : document;
  const docBody = (typeof window.rockyShadowRoot !== 'undefined') ? window.rockyShadowRoot : document.body;

  const abortController = typeof AbortController !== 'undefined' ? new AbortController() : { signal: undefined, abort: () => { } };
  const { signal } = abortController;
  const cleanupTasks = [];
  const shadowHost = (typeof window.rockyShadowRoot !== 'undefined') ? window.rockyShadowRoot.host : null;
  if (shadowHost) {
    shadowHost.addEventListener('bandit-cleanup', () => {
      abortController.abort();
      cleanupTasks.forEach(fn => fn());
    });
  }

  // Fields missing from an older saved version fall back to these.
  const rockyDefaults = (window.RockyStorage && window.RockyStorage.DEFAULTS) || {
    xp: 0, level: 1, petName: 'Bandit', position: { x: null, y: null }, onboarded: false, settings: { size: 1 },
    lastFedAt: 0, provider: 'builtin', apiKey: '', model: '', apiKeys: {}, enhanceStyle: 'structured', askPlaceholders: false, history: []
  };
  const hydrated = savedState || rockyDefaults;

  function persist(partial, opts) {
    try {
      if (window.RockyStorage) window.RockyStorage.saveState(partial, opts);
    } catch (err) {
      console.warn('Bandit: failed to persist state', err);
    }
  }

  // Firefox uses browser.*, Chrome uses chrome.* — used only by the settings
  // modal's "Test key" button, which talks to background.js directly (Enhance
  // and Summarize instead go through window.rockyAIPipeline, see ai/pipeline.js).
  const rockyApi = globalThis.browser ?? globalThis.chrome;

  function testAIKey(testSettings) {
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

  // Mirrors ai/providers.js's detectProvider() for the settings-modal UI —
  // that file only loads in the background worker, so this small duplicate
  // keeps the "auto-pick a provider when you paste a key" UX in the content
  // script without adding providers.js to the content-script surface.
  function detectProviderFromKey(apiKey) {
    const key = (apiKey || '').trim();
    if (!key) return null;
    if (key.startsWith('sk-ant-')) return 'anthropic';
    if (key.startsWith('gsk_')) return 'groq';
    if (key.startsWith('sk-proj-') || key.startsWith('sk-')) return 'openai';
    return 'gemini';
  }

  // Provider/page-derived error text goes into bubble innerHTML — escape it so
  // a malicious error string can never inject markup into Rocky's shadow DOM.
  function escapeHTML(s) {
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  function friendlyError(err) {
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

  function copyToClipboard(text) {
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

  /* =========================================================
     CONVERSATION SCRAPING — per-site adapters + generic fallback.
     Every stage is try/caught: a broken selector never crashes the host page,
     it just falls through to the next, less-specific strategy.
     ========================================================= */
  function scrapeClaudeAI() {
    // data-testid="user-message" is the one stable hook Anthropic's web UI
    // exposes for user turns; assistant turns don't have an equivalent, so we
    // key off the message bubble class Claude uses and merge both in DOM order.
    const userNodes = Array.from(document.querySelectorAll('[data-testid="user-message"]'));
    const assistantNodes = Array.from(document.querySelectorAll('.font-claude-message'));
    if (!userNodes.length && !assistantNodes.length) return null;

    const tagged = [
      ...userNodes.map(el => ({ el, role: 'user' })),
      ...assistantNodes.map(el => ({ el, role: 'assistant' })),
    ].sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);

    const out = [];
    for (const { el, role } of tagged) {
      const text = (el.innerText || el.textContent || '').trim();
      if (text) out.push({ role, text });
    }
    return out.length ? out : null;
  }

  function scrapeGemini() {
    // Gemini's web UI wraps turns in <user-query> / <model-response> custom elements.
    const nodes = Array.from(document.querySelectorAll('user-query, model-response'));
    if (!nodes.length) return null;

    const out = [];
    for (const el of nodes) {
      const role = el.tagName.toLowerCase() === 'user-query' ? 'user' : 'assistant';
      const text = (el.innerText || el.textContent || '').trim();
      if (text) out.push({ role, text });
    }
    return out.length ? out : null;
  }

  function scrapeChatGPT() {
    // ChatGPT wraps each turn in [data-message-author-role] attributes.
    const nodes = Array.from(document.querySelectorAll('[data-message-author-role]'));
    if (!nodes.length) return null;

    const out = [];
    for (const el of nodes) {
      const role = el.getAttribute('data-message-author-role') === 'user' ? 'user' : 'assistant';
      const text = (el.innerText || el.textContent || '').trim();
      if (text) out.push({ role, text });
    }
    return out.length ? out : null;
  }

  function scrapeGenericFallback() {
    const main = document.querySelector('main') || document.body;
    const text = (main.innerText || main.textContent || '').trim();
    // We want the MOST RECENT context, which is at the bottom of the page/chat.
    // slice(-8000) grabs the end, whereas slice(0, 8000) grabbed the oldest text.
    return text ? text.slice(-8000) : '';
  }

  function scrapeConversation() {
    try {
      const host = location.hostname || '';
      let turns = null;
      if (host.includes('claude.ai')) turns = scrapeClaudeAI();
      else if (host.includes('gemini.google.com')) turns = scrapeGemini();
      else if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) turns = scrapeChatGPT();

      if (turns && turns.length) {
        // Join all turns, then grab the LAST 8000 characters. 
        // This ensures we feed the AI the most recent context, not the beginning of a massive chat.
        const joined = turns.map(t => `${t.role.toUpperCase()}: ${t.text}`).join('\n\n');
        return joined.slice(-8000);
      }
    } catch (err) {
      console.warn('Bandit: site-specific scrape failed, falling back to generic', err);
    }

    try {
      return scrapeGenericFallback();
    } catch (err) {
      console.warn('Bandit: generic scrape failed', err);
      return '';
    }
  }

  /* =========================================================
     SHARED PALETTE + HELPERS
     ========================================================= */
  const C = {
    K: '#1c1f26', G: '#9aa3ae', D: '#5b6470', W: '#efe7d6',
    P: '#2b2f38', E: '#ffffff', A: '#f5a524',
  };
  const NS = 'http://www.w3.org/2000/svg';
  function rect(x, y, w, h, fill, parent) {
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', x); r.setAttribute('y', y);
    r.setAttribute('width', w); r.setAttribute('height', h);
    r.setAttribute('fill', fill); parent.appendChild(r); return r;
  }
  function group(cls, parentSvg) {
    const g = document.createElementNS(NS, 'g');
    if (cls) g.setAttribute('class', cls);
    parentSvg.appendChild(g); return g;
  }

  /* =========================================================
     SPRITE 1 — THE CLASSIC (front-facing, your favorite)
     ========================================================= */
  const FRONT_BODY = [
    "................................",
    "................................",
    "....KK..............KK.........",
    "...KGGK............KGGK........",
    "...KGDGK..........KGDGK........",
    "...KGGGKKKKKKKKKKKKGGGK........",
    "..KGGGGGGGGGGGGGGGGGGGGK.......",
    "..KGGGGGGGGGGGGGGGGGGGGK.......",
    ".KGGGGGGGGGGGGGGGGGGGGGGK......",
    ".KGPPPPPGGGGGGGGGGPPPPPGK......",
    ".KPPPPPPPGGGGGGGGPPPPPPPK......",
    ".KPPEEPPPGGGGGGGGPPPEEPPK......",
    ".KPPEEPPPGGGGGGGGPPPEEPPK......",
    ".KGPPPPPGGWWWWWWGGPPPPPGK......",
    ".KGGGGGGWWWWWWWWWWGGGGGGK......",
    ".KGGGGGWWWWKKKKWWWWGGGGGK......",
    "..KGGGGWWWWKKKKWWWWGGGGK.......",
    "..KGGGGGWWWWWWWWWWGGGGGK.......",
    "...KGGGGGWWWWWWWWGGGGGK........",
    "...KGGGGGGGGGGGGGGGGGGK........",
    "..KGGGGGGGGGGGGGGGGGGGGK.......",
    "..KGGGGDGGGGGGGGGGDGGGGK.......",
    ".KGGGGGDGGGGGGGGGGDGGGGGK......",
    ".KGGGGGDGGGGGGGGGGDGGGGGK......",
    ".KGGGGGGGGGGGGGGGGGGGGGGK......",
    ".KGDDGGGGGGGGGGGGGGGGDDGK......",
    "..KDDDGGGGGGGGGGGGGGDDDK.......",
    "...KKKDDDKKKKKKKKDDDKKK........",
    "......KKK........KKK...........",
    "................................",
    "................................",
    "................................",
  ];
  const FRONT_TAIL = [
    [24, 18, 4, 3, 'G'], [27, 16, 4, 3, 'K'], [29, 13, 4, 3, 'G'],
    [30, 10, 4, 3, 'K'], [30, 7, 4, 3, 'G'], [29, 4, 4, 3, 'K'],
  ];
  const F_EYES_OPEN = [[4, 11, 2, 2, 'E'], [20, 11, 2, 2, 'E']];
  const F_EYES_CLOSED = [[3, 12, 4, 1, 'K'], [19, 12, 4, 1, 'K']];
  const F_EYES_HAPPY = [[4, 11, 2, 1, 'E'], [20, 11, 2, 1, 'E'], [2, 13, 2, 1, '#ff7b7b'], [22, 13, 2, 1, '#ff7b7b']];
  const F_SHADES = [[2, 10, 8, 3, 'K'], [18, 10, 8, 3, 'K'], [10, 11, 8, 1, 'K'], [4, 11, 2, 1, '#69d2ff'], [20, 11, 2, 1, '#69d2ff']];
  // Level 3: cozy red scarf around the neck, one dangling end.
  const F_SCARF = [[3, 19, 20, 2, '#d64545'], [4, 21, 3, 1, '#b23737'], [4, 22, 2, 2, '#d64545']];
  // Level 4: little gold crown perched between the ears.
  const F_CROWN = [[10, 3, 1, 3, '#f5c542'], [13, 2, 1, 4, '#f5c542'], [16, 3, 1, 3, '#f5c542'], [9, 5, 9, 1, '#e0a92e'], [13, 1, 1, 1, '#fff1b8']];

  const frontSvg = doc.getElementById('frontSvg');
  if (!frontSvg) { console.error('Bandit: #frontSvg missing — aborting init'); return; }
  const fTailG = group('tail', frontSvg);
  FRONT_TAIL.forEach(([x, y, w, h, c]) => rect(x, y, w, h, C[c], fTailG));
  const fBodyG = group('body-group', frontSvg);
  const fEarsG = document.createElementNS(NS, 'g'); fEarsG.setAttribute('class', 'ears'); fBodyG.appendChild(fEarsG);
  FRONT_BODY.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]; if (ch === '.') continue;
      rect(x, y, 1, 1, C[ch], y <= 5 ? fEarsG : fBodyG);
    }
  });
  const fEyesG = document.createElementNS(NS, 'g'); fBodyG.appendChild(fEyesG);
  const fAccG = document.createElementNS(NS, 'g'); fBodyG.appendChild(fAccG);/* eye/accessory control */
  function overlay(g, s) { if (!g) return; g.replaceChildren(); s.forEach(([x, y, w, h, c]) => rect(x, y, w, h, C[c] || c, g)); }
  function eyesOpen() { overlay(fEyesG, F_EYES_OPEN); }
  function eyesClosed() { overlay(fEyesG, F_EYES_CLOSED); }
  function eyesHappy() { overlay(fEyesG, F_EYES_HAPPY); }
  // Accessories stack up as Bandit levels: 2=shades, 3=+scarf, 4=+crown.
  function applyAccessories(lvl) {
    overlay(fAccG, [
      ...(lvl >= 2 ? F_SHADES : []),
      ...(lvl >= 3 ? F_SCARF : []),
      ...(lvl >= 4 ? F_CROWN : []),
    ]);
  }
  eyesOpen();

  /* =========================================================
     STATE + BEHAVIOR
     ========================================================= */
  const wrap = doc.getElementById('petWrap');
  const root = doc.getElementById('rocky-root');
  const pet = doc.getElementById('pet');
  const bubble = doc.getElementById('bubble');
  const input = doc.getElementById('promptInput');
  const box = doc.getElementById('composerBox');
  const hint = doc.getElementById('composerHint');
  const xpFill = doc.getElementById('xpFill');
  const xpLabel = doc.getElementById('xpLabel');
  const toast = doc.getElementById('toast');
  const messages = doc.getElementById('messages');

  if (!wrap || !root || !pet || !bubble) { console.error('Bandit: critical DOM elements missing — aborting init'); return; }

  let state = 'idle';
  let xp = hydrated.xp, level = hydrated.level;
  let petName = hydrated.petName;
  let lastFedAt = hydrated.lastFedAt || 0;
  let aiSettings = { provider: hydrated.provider || 'builtin', apiKey: hydrated.apiKey || '', model: hydrated.model || '', apiKeys: hydrated.apiKeys || {} };
  let enhanceStyle = hydrated.enhanceStyle || 'structured';
  let askPlaceholders = hydrated.askPlaceholders === true; // default OFF — enable in settings
  let lastEnhance = null; // { inputRef, original } — lets the Undo menu restore pre-enhance text
  // Named copyHistory (not `history`) to avoid shadowing window.history.
  let copyHistory = Array.isArray(hydrated.history) ? hydrated.history : [];

  function recordHistory(type, text) {
    copyHistory = [{ type, text, at: Date.now() }, ...copyHistory].slice(0, 10);
    persist({ history: copyHistory });
  }
  const currentVersion = (rockyApi && rockyApi.runtime && rockyApi.runtime.getManifest) ? rockyApi.runtime.getManifest().version : '2.1';
  let lastSeenVersion = hydrated.lastSeenVersion || '';
  let updateMessageCount = hydrated.updateMessageCount || 0;

  if (lastSeenVersion && lastSeenVersion !== currentVersion) {
    lastSeenVersion = currentVersion;
    updateMessageCount = 0;
    persist({ lastSeenVersion, updateMessageCount });
  } else if (!lastSeenVersion) {
    lastSeenVersion = currentVersion;
    updateMessageCount = 5; // Don't show on very first install
    persist({ lastSeenVersion, updateMessageCount });
  }

  const FEED_COOLDOWN_MS = 60000;
  const LEVELS = [0, 20, 50, 100]; // level 1..4 thresholds; Level 4 is max, so no 200 cap.
  let lastActivity = Date.now();
  let alertShown = false;
  let runAnim = null;
  let isHovering = false;
  wrap.addEventListener('pointerenter', () => isHovering = true);
  wrap.addEventListener('pointerleave', () => isHovering = false);

  function setState(s) {
    wrap.classList.remove('alert', 'working', 'happy', 'sleeping', 'levelup', 'running', 'scooting', 'hopping');
    if (s !== 'idle') wrap.classList.add(s);
    if (s !== 'sleeping' && state === 'sleeping') {
      const oldHouse = doc.querySelector('.bandit-house');
      if (oldHouse) oldHouse.remove();
    }
    state = s;
    if (s === 'sleeping') eyesClosed();
    else if (level < 2) eyesOpen();
  }

  function say(html, ms = 2600) {
    if (!bubble) return;
    bubble.replaceChildren(...new DOMParser().parseFromString(html, 'text/html').body.childNodes); bubble.classList.add('show');
    clearTimeout(say._t);
    if (ms > 0) say._t = setTimeout(() => bubble.classList.remove('show'), ms);
  }
  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg; toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  // Animated "thinking…" bubble — cycling dots make waiting on the AI feel
  // alive instead of frozen. Always pair sayThinking() with stopThinking().
  let thinkingTimer = null;
  function sayThinking(base) {
    clearInterval(thinkingTimer);
    let n = 0;
    const step = () => { n = (n % 3) + 1; say(base + '.'.repeat(n), 0); };
    step();
    thinkingTimer = setInterval(step, 450);
  }
  function stopThinking() {
    clearInterval(thinkingTimer);
    thinkingTimer = null;
  }

  /* blinking (front sprite) */
  let blinkTimer;
  (function scheduleBlink() {
    blinkTimer = setTimeout(() => {
      if (state !== 'sleeping' && state !== 'running' && level < 2) {
        eyesClosed(); setTimeout(() => { if (state !== 'sleeping') eyesOpen(); }, 140);
      }
      scheduleBlink();
    }, 2200 + Math.random() * 2600);
  })();
  cleanupTasks.push(() => clearTimeout(blinkTimer));

  let isFetching = false;
  let fetchTimer = null;
  cleanupTasks.push(() => clearTimeout(fetchTimer));

  function pokeActivity() {
    lastActivity = Date.now();
    if (state === 'sleeping') {
      setState('startled');
      eyesOpen();
      const emote = doc.getElementById('startleEmote');
      if (emote) {
        emote.style.display = 'block';
        setTimeout(() => { emote.style.display = 'none'; if (state === 'startled') setState('idle'); }, 1000);
      }
      return;
    }
    if (state !== 'working' && state !== 'startled' && !isFetching) setState('idle');
  }
  const sleepInterval = setInterval(() => {
    if (state === 'idle' && !drag && Date.now() - lastActivity > 20000) setState('sleeping');
  }, 1000);
  cleanupTasks.push(() => clearInterval(sleepInterval));

  /* =========================================================
     RUNNING — swaps to the 4-leg side sprite mid-dash
     ========================================================= */
  function startRun() {
    if (state === 'sleeping' || state === 'working' || drag || wrap.matches(':hover') || isFetching || state === 'startled') return;
    const r = root.getBoundingClientRect();
    root.style.left = r.left + 'px'; root.style.top = r.top + 'px';
    root.style.right = 'auto'; root.style.bottom = 'auto';

    const dir = Math.random() < .5 ? -1 : 1;
    const dist = 140 + Math.random() * 300;
    let targetX = r.left + dir * dist;
    targetX = Math.max(8, Math.min(innerWidth - 150, targetX));
    if (Math.abs(targetX - r.left) < 60) {
      targetX = r.left + (targetX > r.left ? -1 : 1) * 160;
      targetX = Math.max(8, Math.min(innerWidth - 150, targetX));
    }

    pet.classList.toggle('face-left', targetX < r.left);
    const styles = ['running', 'scooting', 'hopping'];
    const runStyle = styles[Math.floor(Math.random() * styles.length)];
    setState(runStyle);
    wrap.classList.add(runStyle);

    let speed = 150;
    if (runStyle === 'scooting') speed = 240;
    if (runStyle === 'hopping') speed = 110;

    let last = performance.now(), x = r.left;
    const step = (now) => {
      if (state !== 'running' && state !== 'scooting' && state !== 'hopping') { runAnim = null; return; }
      const dt = (now - last) / 1000; last = now;
      const d = targetX - x;
      const move = Math.sign(d) * Math.min(Math.abs(d), speed * dt);
      x += move; root.style.left = x + 'px';
      if (Math.abs(targetX - x) < 2) {
        setState('idle'); runAnim = null;
        persist({ position: { x: Math.round(x), y: root.offsetTop } });
        return;
      }
      runAnim = requestAnimationFrame(step);
    };
    runAnim = requestAnimationFrame(step);
  }
  const runInterval = setInterval(() => {
    if (state === 'idle' && !isHovering && Date.now() - lastActivity > 5000 && Math.random() < .4) startRun();
  }, 8000);
  cleanupTasks.push(() => clearInterval(runInterval));
  function stopRun() {
    if (runAnim) cancelAnimationFrame(runAnim);
    runAnim = null;
    if (state === 'running' || state === 'scooting' || state === 'hopping') setState('idle');
  }

  /* idle chatter */
  const idleLines = [
    'psst… got a trash prompt for me? 🗑️',
    'feed me prompts. trash → treasure ✨',
    'zoomies incoming 🐾',
    'double-click me to enhance ✨',
    'right-click me for snacks 🍪',
    'I summarize chats too, y\'know 📋',
    '*sniffs around for bugs* 🐛',
    'ship it. ship it now 🚀',
    'Ctrl+Shift+E → instant enhance ⚡',
    '*rummages through your code* 🦝',
  ];
  const chatterInterval = setInterval(() => {
    if (state === 'idle' && Date.now() - lastActivity > 6000 && Date.now() - lastActivity < 18000) {
      if (updateMessageCount < 5) {
        say(`I've been updated to v${currentVersion}! ✨<br>Check out my new menu features!`, 4000);
        updateMessageCount++;
        persist({ updateMessageCount });
      } else {
        say(idleLines[Math.floor(Math.random() * idleLines.length)], 2400);
      }
    }
  }, 11000);
  cleanupTasks.push(() => clearInterval(chatterInterval));

  /* typing → alert */
  if (input) input.addEventListener('input', () => {
    pokeActivity();
    const val = input.value.trim();
    if (val.length > 7 && (state === 'idle' || state === 'running') && !alertShown) {
      alertShown = true; stopRun();
      setState('alert');
      if (box) box.classList.add('rocky-glow');
      say('Ooh! I can clean that up.<br><b>Click me</b> or <b>Ctrl+Shift+E</b> 🦝✨', 4000);
      setTimeout(() => { if (state === 'alert') setState('idle'); }, 4200);
    }
    if (val.length === 0) { alertShown = false; if (box) box.classList.remove('rocky-glow'); }
  });

  /* enhance flow */
  function getDeepActiveElement() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) {
      el = el.shadowRoot.activeElement;
    }
    return el;
  }

  function getHostInput() {
    const active = getDeepActiveElement();
    if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.isContentEditable)) {
      if (active.disabled || active.readOnly) return null; // Cannot inject into disabled/readonly
      const r = active.getBoundingClientRect();
      // A focused-but-invisible element is worse than falling through to search.
      if (r.width > 0 && r.height > 0) return active;
    }

    // Fall back to the largest VISIBLE candidate on the page. Many AI tool UIs
    // have several textarea/contenteditable elements (hidden fields, decoys,
    // secondary boxes) — the biggest one on screen is almost always the real
    // prompt composer, regardless of DOM order.
    const candidates = document.querySelectorAll(
      'textarea, input[type="text"], input:not([type]), div[contenteditable="true"], [contenteditable="plaintext-only"]'
    );
    let best = null, bestArea = 0;
    for (const el of candidates) {
      if (el.disabled || el.readOnly) continue;
      if (el.offsetParent === null) continue; // display:none / detached
      const r = el.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) { bestArea = area; best = el; }
    }
    return best;
  }

  // The ONLY safe way to inject text into complex React/ProseMirror editors is
  // execCommand — setting innerText/value directly corrupts their internal DOM
  // state and can cause crash loops. Replaces the box's whole contents.
  function setPromptText(hostInput, text) {
    hostInput.focus();
    if (hostInput.tagName === 'TEXTAREA' || hostInput.tagName === 'INPUT') {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      if (hostInput.tagName === 'INPUT' && nativeInputValueSetter) {
        nativeInputValueSetter.call(hostInput, text);
      } else if (hostInput.tagName === 'TEXTAREA' && nativeTextAreaValueSetter) {
        nativeTextAreaValueSetter.call(hostInput, text);
      } else {
        hostInput.value = text;
      }
      hostInput.dispatchEvent(new Event('input', { bubbles: true }));
      hostInput.dispatchEvent(new Event('change', { bubbles: true }));
      hostInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));
    } else {
      // contenteditable (Claude, Gemini, etc) — select everything, then replace
      const selection = window.getSelection();
      if (selection) selection.selectAllChildren(hostInput);
      try {
        if (!document.execCommand('insertText', false, text)) {
          throw new Error('execCommand failed');
        }
      } catch (err) {
        // Fallback if execCommand is blocked (strict CSP, deprecated, or framework-blocked).
        // Riskier for React internals, but guarantees the text gets inserted.
        hostInput.textContent = text;
        hostInput.dispatchEvent(new Event('input', { bubbles: true }));
        hostInput.dispatchEvent(new Event('change', { bubbles: true }));
        hostInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));
      }
    }
  }

  /* =========================================================
     PLACEHOLDER Q&A — when the enhanced prompt contains
     [bracketed placeholders], Rocky asks the user to fill each one
     (with clickable suggestions) before inserting the final text.
     ========================================================= */
  const PLACEHOLDER_SUGGESTIONS = [
    // Each entry: regex tested against the FULL placeholder text, options shown.
    // Patterns use word boundaries and multi-word anchors to avoid false matches
    // (e.g. "storage" alone shouldn't suggest databases — "data storage" should).
    // General / Writing / Design
    {
      re: /\b(target\s+audience|audience|readers)\b/i,
      opts: ['Beginners', 'Experts / Professionals', 'General Public', 'Children']
    },
    {
      re: /\b(tone|style|voice)\b/i,
      opts: ['Professional & Formal', 'Casual & Friendly', 'Humorous', 'Academic / Objective']
    },
    {
      re: /\b(visual\s+style|art\s+style|aesthetic)\b/i,
      opts: ['Photorealistic', 'Vector Illustration', 'Anime / Manga', '3D Render']
    },
    {
      re: /\b(format|medium)\b/i,
      opts: ['Blog Post', 'Email Newsletter', 'Social Media Post', 'Academic Essay']
    },
    // Coding / Tech
    {
      re: /\b(tech\s*stack|framework|your\s+stack|front\s*end\s+stack)\b/i,
      opts: ['React + Node.js', 'Next.js', 'Vue + Express', 'Plain HTML/CSS/JS']
    },
    {
      re: /\b(database|data\s*base|db\s+engine|data\s+storage|your\s+db)\b/i,
      opts: ['PostgreSQL', 'MongoDB', 'SQLite', 'Supabase']
    },
    {
      re: /\b(backend|back\s*end|server\s*(framework|stack)?|api\s+framework)\b/i,
      opts: ['Node.js + Express', 'Supabase', 'Firebase', 'Python FastAPI']
    },
    {
      re: /\b(auth(entication)?|login\s+method|sign[\s-]*in)\b/i,
      opts: ['Email + password', 'Google OAuth', 'Magic link']
    },
    {
      re: /\b(config(uration)?(\s+method)?|env(ironment)?\s*(setup|file)?)\b/i,
      opts: ['.env file', 'JSON config file']
    },
    {
      re: /\b(color\s*(scheme|palette)?|brand(ing)?|theme|design\s+style|ui\s+style)\b/i,
      opts: ['Minimal light', 'Dark mode', 'Colorful / playful']
    },
    {
      re: /\b(host(ing)?|deploy(ment)?|platform)\b/i,
      opts: ['Vercel', 'Netlify', 'AWS', 'Railway']
    },
    {
      re: /\b(test(ing)?(\s+framework)?|test\s+runner)\b/i,
      opts: ['Jest', 'Vitest', 'Playwright', 'None for now']
    },
    {
      re: /\b(language|programming\s+lang(uage)?)\b/i,
      opts: ['TypeScript', 'JavaScript', 'Python', 'Go']
    },
    {
      re: /\b(css\s*(framework|library)?|styling)\b/i,
      opts: ['Tailwind CSS', 'Vanilla CSS', 'CSS Modules', 'Styled Components']
    },
    {
      re: /\b(state\s*(management|library))\b/i,
      opts: ['React Context', 'Zustand', 'Redux', 'None']
    },
    {
      re: /\b(package\s+manager)\b/i,
      opts: ['npm', 'pnpm', 'yarn', 'bun']
    },
  ];
  function suggestionsFor(ph) {
    for (const s of PLACEHOLDER_SUGGESTIONS) if (s.re.test(ph)) return s.opts;
    return []; // No match = no suggestions. User types their own — safer than guessing wrong.
  }
  function extractPlaceholders(text) {
    const found = new Set();
    const re = /(?:^|[^a-zA-Z0-9_])\[([a-zA-Z][a-zA-Z0-9\s_/\-\.,']{1,48})\](?!\()/g;
    let m;
    while ((m = re.exec(text))) found.add(m[1]);
    return [...found];
  }

  // Shared builder for Rocky's dynamic mini-modals (placeholder Q&A, history).
  // Overlay click dismisses; onClose fires exactly once however it closes.
  function openRockyModal(onClose) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay show';
    const modal = document.createElement('div');
    modal.className = 'modal';
    overlay.appendChild(modal);
    docBody.appendChild(overlay);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      overlay.remove();
      if (onClose) onClose();
    };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    return { modal, close };
  }

  // Asks one question per placeholder in a mini-modal (reuses settings-modal
  // styling). Skipped/dismissed placeholders stay bracketed in the output.
  function askPlaceholderValues(text, placeholders, done) {
    let i = 0;
    let out = text;
    let answering = false; // separate flag — can't set properties on a string primitive

    let cancelled = true;

    // Dismissing at any point delivers null (aborted), unless finished completely.
    const { modal, close: finish } = openRockyModal(() => {
      if (cancelled) done(null);
      else done(out);
    });

    const answer = (val) => {
      if (answering) return; // prevent rapid double-clicks from skipping questions
      answering = true;
      if (val) out = out.split('[' + placeholders[i] + ']').join(val);
      i++;
      if (i < placeholders.length) {
        answering = false;
        renderQuestion();
      } else {
        cancelled = false;
        answering = false;
        finish();
      }
    };

    const renderQuestion = () => {
      const ph = placeholders[i];
      modal.replaceChildren();

      const h = document.createElement('h3');
      h.textContent = `🦝 quick question ${i + 1}/${placeholders.length}`;
      modal.appendChild(h);

      const q = document.createElement('div');
      q.style.cssText = 'font-size:12px;line-height:1.6;color:#8a95a5';
      q.append('What should I use for ');
      const b = document.createElement('b');
      b.style.color = '#f5a524';
      b.textContent = '[' + ph + ']';
      q.appendChild(b);
      q.append('?');
      modal.appendChild(q);

      suggestionsFor(ph).forEach((opt) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'secondary';
        btn.textContent = opt;
        btn.addEventListener('click', () => answer(opt));
        modal.appendChild(btn);
      });

      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'or type your own…';
      input.addEventListener('keydown', (e) => {
        e.stopPropagation(); // keep keystrokes away from host-page shortcuts
        if (e.key === 'Enter') {
          e.preventDefault();
          const val = input.value.trim();
          answer(val ? val : null);
        }
        if (e.key === 'Escape') finish();
      });
      modal.appendChild(input);

      const row = document.createElement('div');
      row.className = 'settings-row';
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.textContent = 'Use this';
      ok.style.flex = '1';
      ok.addEventListener('click', () => {
        const val = input.value.trim();
        answer(val ? val : null);
      });
      const skip = document.createElement('button');
      skip.type = 'button';
      skip.className = 'secondary';
      skip.textContent = 'Skip';
      skip.addEventListener('click', () => answer(null));
      row.appendChild(ok);
      row.appendChild(skip);
      modal.appendChild(row);

      setTimeout(() => input.focus(), 60);
    };

    renderQuestion();
  }

  function enhancePrompt(overrideInput, overrideText) {
    const hostInput = overrideInput || getHostInput();

    if (!hostInput) {
      say("I can't find a text box to enhance! 🔍", 3000);
      return;
    }

    let val = overrideText || '';
    if (!val) {
      if (hostInput.isContentEditable) {
        val = hostInput.innerText || hostInput.textContent;
      } else {
        val = hostInput.value;
      }
    }

    const trimmedVal = val.trim();
    if (!trimmedVal) {
      say("You have to type something first! 🥺", 3000);
      return;
    }

    // --- MULTI-LAYER INPUT VALIDATION ---
    // Reject inputs that aren't real prompts. Users get a specific, helpful
    // message so they know WHAT to type, not just "too short".
    const wordCount = trimmedVal.split(/\s+/).length;
    const lower = trimmedVal.toLowerCase().replace(/[^a-z\s]/g, '').trim();

    // Layer 1: Single words are never real prompts
    if (wordCount === 1) {
      say("One word isn't enough to enhance! 🐾<br><span style='opacity:.7'>Try: \"build a login page\" or \"write a blog about space\"</span>", 4500);
      return;
    }

    // Layer 2: Greetings, farewells, reactions, filler — expanded list
    const FLUFF_PATTERNS = [
      // Greetings (with typo variants)
      /^(h[ei]y+|hi+|hello+|helo+|hola|howdy|sup|wh?at'?s? ?up|yo+)\b/,
      // Farewells
      /^(bye+|good ?bye|see ?ya|later|cya|peace|adios)\b/,
      // Gratitude / politeness
      /^(thanks?|thank ?you|thx|ty|please|pls|welcome|np|no ?prob)\b/,
      // Affirmatives / negatives
      /^(ye[sp]?|yeah|yep|yup|nope?|nah|ok+|okay|sure|fine|alright|k+|kk+)$/,
      // Reactions / filler
      /^(lo+l+|lmao+|rof+l|hah+a*|heh+e*|hmm+|wow+|oh+|ah+|ugh+|meh|bruh|bro|dude|man|nice|cool|great|awesome|damn|dang|omg|wtf|idk|idc)$/,
      // Profanity catch-all (common ones)
      /\b(fuck|shit|ass|bitch|dick|crap|hell|damn)\b/,
      // Nonsense / keyboard mashing (3+ repeated chars or random consonant strings)
      /^([a-z])\1{3,}/,
      /^[^aeiou\s]{5,}$/,
    ];

    if (FLUFF_PATTERNS.some(re => re.test(lower))) {
      say("That's not something I can enhance! 🦝<br><span style='opacity:.7'>Give me a real request, like:<br>\"create a landing page\" or \"explain React hooks\"</span>", 5000);
      return;
    }

    // Layer 3: Very short inputs (under 12 chars AND ≤2 words) — not enough substance
    if (trimmedVal.length < 12 && wordCount <= 2) {
      say("That's too short for me to work with! 🐾<br><span style='opacity:.7'>Add more detail — what do you want built/written/explained?</span>", 4500);
      return;
    }

    // Layer 4: Pure conversational fluff (slightly longer but still not a prompt)
    const CONVERSATIONAL = /^(how are you|what are you|who are you|are you|do you|can you|will you|i am|i'm|my name|what's your|tell me a joke|sing|dance)[.!?\s]*$/i;
    if (CONVERSATIONAL.test(trimmedVal)) {
      say("Hah, I'm flattered but I enhance prompts, not answer questions! 🦝<br><span style='opacity:.7'>Try: \"write a Python script that…\"</span>", 4500);
      return;
    }

    if (state === 'working') return;

    pokeActivity(); stopRun();
    setState('working');
    sayThinking('rummaging through your prompt 🔍');

    const styles = (window.RockyPrompts && window.RockyPrompts.ENHANCE_SYSTEMS) || {};
    const ENHANCE_SYSTEM = styles[enhanceStyle] || (window.RockyPrompts ? window.RockyPrompts.ENHANCE_SYSTEM : '');

    window.rockyAIPipeline(ENHANCE_SYSTEM, val.trim(), {
      actionKey: 'enhance',
      onProgress: (frac) => { stopThinking(); say(`downloading on-device AI… ${Math.round(frac * 100)}% 📥`, 0); },
    }).then(result => {
      stopThinking();

      if (result.trim() === 'ERROR_GIBBERISH') {
        setState('idle');
        say('Hmm, that doesn\'t look like a real prompt. Can you be more specific? 🤔', 4000);
        return;
      }

      // Reject suspiciously short AI outputs — a good enhanced prompt is never
      // just a few words. This catches models returning "OK" or echoing the input.
      const resultWords = result.trim().split(/\s+/).length;
      if (resultWords < 8) {
        setState('idle');
        say('The AI gave a weird response — try again or rephrase your prompt 🤔', 4000);
        return;
      }

      lastEnhance = { inputRef: typeof WeakRef !== 'undefined' ? new WeakRef(hostInput) : hostInput, original: val };

      const insertFinal = (text) => {
        const finalStr = text.trim();
        recordHistory('enhance', finalStr);
        gainXP(10);
        setState('happy');

        if (hostInput.isContextMenu) {
          copyToClipboard(finalStr)
            .then(() => say('copied enhanced prompt to clipboard! 📋✨', 4000))
            .catch(() => say('copy blocked by browser 😖 (check history 📜)', 4000));
        } else {
          setPromptText(hostInput, finalStr);
          say('trash → treasure! <span class="xp-pop">+10 XP</span> ✨<br><span style="opacity:.7">menu → ↩️ Undo to revert</span>', 3600);
        }
        setTimeout(() => { if (state === 'happy') setState('idle'); }, 1150);
      };

      const placeholders = extractPlaceholders(result);
      if (askPlaceholders && placeholders.length) {
        setState('alert');
        say('almost! fill in a couple of blanks for me ✍️', 3000);
        askPlaceholderValues(result, placeholders, (finalText) => {
          // If the user cancelled/dismissed, abort the injection and restore state.
          if (finalText === null) {
            setState('idle');
            return;
          }
          try { insertFinal(finalText); } catch (err) {
            console.warn('Bandit: insertFinal threw after placeholder Q&A', err && err.message);
            setState('idle');
          }
        });
      } else {
        insertFinal(result);
      }
    }).catch(err => {
      stopThinking();
      const errMsg = err && err.message ? err.message : String(err);
      console.warn('Bandit: enhance failed', errMsg);
      setState('idle');
      say(`couldn't enhance that — ${escapeHTML(friendlyError(err))}<br><b>Set up key in settings 🔧</b>`, 4200);
      
      // Auto-open settings if it's an API key or missing provider issue
      if (errMsg.toLowerCase().includes('api key') || errMsg.toLowerCase().includes('cloud provider')) {
        setTimeout(() => {
          const btn = doc.getElementById('menuSettings');
          if (btn) btn.click();
        }, 1200);
      }
    });
  }

  function updateXPDisplay() {
    const base = LEVELS[level - 1] || 0, next = LEVELS[level] ?? xp;
    const range = next - base; const pct = range > 0 ? Math.min(100, ((xp - base) / range) * 100) : 100;
    if (xpFill) xpFill.style.width = pct + '%';
    const name = (petName || 'Bandit').toUpperCase();
    if (xpLabel) xpLabel.replaceChildren(...new DOMParser().parseFromString(`${escapeHTML(name)} · <b>LVL ${level}</b> · ${xp}/${LEVELS[level] ?? 'MAX'} XP`, 'text/html').body.childNodes);
  }

  function gainXP(n, silent = false) {
    xp += n;
    let leveledUp = false;
    while (level < LEVELS.length - 1 && xp >= LEVELS[level]) {
      level++;
      leveledUp = true;
    }
    if (leveledUp) {
      wrap.classList.add('levelup');
      setTimeout(() => wrap.classList.remove('levelup'), 1500);
      applyAccessories(level);
      const LEVEL_TOASTS = {
        2: `🦝 LEVEL 2 — ${petName} found sunglasses in the trash`,
        3: `🧣 LEVEL 3 — ${petName} found a cozy scarf!`,
        4: `👑 LEVEL 4 — ALL HAIL THE TRASH KING`,
      };
      showToast(LEVEL_TOASTS[level] || `🦝 LEVEL ${level}!`);
    }
    updateXPDisplay();
    persist({ xp, level });

    if (!silent) {
      wrap.classList.add('show-xp');
      clearTimeout(gainXP._t);
      gainXP._t = setTimeout(() => wrap.classList.remove('show-xp'), 3000);
    }
  }

  function getClosest(e, sel) {
    const path = e.composedPath();
    const t = path && path[0];
    if (!t) return null;
    const el = t.nodeType === 3 ? t.parentElement : t;
    return el && typeof el.closest === 'function' ? el.closest(sel) : null;
  }

  // Viewport-space clamp (uses clientX/clientY-equivalent bounds, never page
  // coordinates) so Rocky can never end up stranded off-screen — used during
  // drag, on resize/orientationchange, and when hydrating a saved position that
  // may have come from a bigger screen.
  function clampToViewport(left, top) {
    const rect = root.getBoundingClientRect();
    const w = rect.width > 0 ? rect.width : 150;
    const h = rect.height > 0 ? rect.height : 180;
    const margin = 4;
    const maxLeft = Math.max(margin, innerWidth - w - margin);
    const maxTop = Math.max(margin, innerHeight - h - margin);
    return {
      x: Math.max(margin, Math.min(maxLeft, left)),
      y: Math.max(margin, Math.min(maxTop, top)),
    };
  }

  /* click vs drag */
  let drag = null;
  let spinTimer = null;
  cleanupTasks.push(() => clearTimeout(spinTimer));
  let lastTap = 0;

  wrap.addEventListener('contextmenu', e => {
    e.preventDefault();
    const rect = root.getBoundingClientRect();
    if (rect.right + 200 > window.innerWidth) wrap.classList.add('menu-left');
    else wrap.classList.remove('menu-left');
    
    const menuExtra = doc.getElementById('menuExtra');
    const menuMore = doc.getElementById('menuMore');
    if (menuExtra) menuExtra.style.display = 'none';
    if (menuMore) menuMore.style.display = 'block';

    wrap.classList.add('show-menu');
  });
  window.addEventListener('pointerdown', e => {
    if (!getClosest(e, '.pet-menu') && !getClosest(e, '#petWrap')) {
      wrap.classList.remove('show-menu');
    }
  }, { signal });

  wrap.addEventListener('pointerdown', e => {
    if (getClosest(e, '.pet-menu')) return;
    if (e.button === 2) return; // ignore right click for drag
    if (drag) return; // a drag is already in progress from another pointer — don't steal it
    stopRun();

    if (isFetching) {
      isFetching = false;
      root.style.transition = '';
      const a = doc.querySelector('.fetch-apple');
      if (a) a.remove();
    }

    const rect = root.getBoundingClientRect();
    drag = {
      pointerId: e.pointerId,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      moved: false,
      longPressed: false
    };
    // Hold Rocky still for 600ms (no drag) → he does a spin trick.
    clearTimeout(spinTimer);
    spinTimer = setTimeout(() => {
      if (!drag || drag.moved) return;
      drag.longPressed = true;
      wrap.classList.add('spinning');
      say('wheee! 🌀', 1600);
      if (Math.random() < 0.3) gainXP(2, true);
      setTimeout(() => wrap.classList.remove('spinning'), 750);
    }, 600);
    // Capture guarantees subsequent pointer events for this pointerId are
    // dispatched to wrap regardless of what's under the cursor — this fixes
    // dragging across an iframe (which would otherwise steal the events into
    // its own document) and any element that swallows pointerdown with
    // preventDefault. It does NOT bypass document/window-level listeners that
    // call stopPropagation on the bubble phase — a host page could still do
    // that upstream of us. Gemini specifically needs empirical testing.
    try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* capture unsupported for this pointer type */ }
  });
  let petDistance = 0;
  let lastHeartTime = 0;
  function spawnHeart() {
    const h = document.createElement('div');
    h.className = 'heart';
    h.replaceChildren(...new DOMParser().parseFromString('<div style="width:4px;height:4px;background:transparent;box-shadow:4px 0 #ff4b4b,12px 0 #ff4b4b,0 4px #ff4b4b,4px 4px #ff4b4b,8px 4px #ff4b4b,12px 4px #ff4b4b,16px 4px #ff4b4b,4px 8px #ff4b4b,8px 8px #ff4b4b,12px 8px #ff4b4b,8px 12px #ff4b4b"></div>', 'text/html').body.childNodes);
    const rect = pet.getBoundingClientRect();
    h.style.position = 'fixed';
    h.style.left = (rect.left + rect.width / 2 - 10 + (Math.random() * 40 - 20)) + 'px';
    h.style.top = (rect.top - 10) + 'px';
    docBody.appendChild(h);
    setTimeout(() => h.remove(), 1200);
  }
  window.addEventListener('pointerout', () => petDistance = 0, { signal });

  // Rocky's pupils drift toward the cursor — tiny effect, big "he's alive" feel.
  // Throttled to ~10Hz; skipped while sleeping (eyes closed) or above level 1
  // (shades cover the eyes anyway).
  let lastEyeMove = 0;
  function eyesFollowCursor(e) {
    const now = Date.now();
    if (now - lastEyeMove < 100) return;
    lastEyeMove = now;
    if (state === 'sleeping' || level >= 2) { fEyesG.removeAttribute('transform'); return; }
    const r = pet.getBoundingClientRect();
    if (!r.width) return;
    const cx = r.left + r.width / 2, cy = r.top + r.height * 0.38; // eye line
    const dx = Math.max(-1, Math.min(1, (e.clientX - cx) / 160));
    const dy = Math.max(-1, Math.min(1, (e.clientY - cy) / 160));
    fEyesG.setAttribute('transform', `translate(${(dx * 0.7).toFixed(2)}, ${(dy * 0.5).toFixed(2)})`);
  }

  window.addEventListener('pointermove', e => {
    if (!drag) {
      eyesFollowCursor(e);
      if (state === 'sleeping') return;
      if (!getClosest(e, '#pet')) return;

      petDistance += Math.hypot(e.movementX, e.movementY);
      if (petDistance > 200) {
        petDistance = 0;
        const now = Date.now();
        if (now - lastHeartTime > 500) {
          lastHeartTime = now;
          spawnHeart();
          if (state !== 'happy' && state !== 'working') {
            eyesHappy();
            setTimeout(() => { if (state !== 'happy' && state !== 'working') eyesOpen(); }, 600);
            gainXP(1, true);
          }
        }
      }
      return;
    }
    if (e.pointerId !== drag.pointerId) return; // a second simultaneous pointer — not our drag

    if (!drag.moved) {
      const probe = clampToViewport(e.clientX - drag.offsetX, e.clientY - drag.offsetY);
      if (Math.abs(probe.x - root.offsetLeft) > 5 || Math.abs(probe.y - root.offsetTop) > 5) {
        drag.moved = true;
        clearTimeout(spinTimer); // a real drag cancels the long-press spin
        drag.offsetX = 60; // Snap to center
        drag.offsetY = 30; // Snap to scruff/neck
        wrap.classList.add('dragging');
        root.style.transition = 'none'; // zero-lag 1:1 cursor tracking, no easing
        lastActivity = Date.now(); // dragging counts as activity — no sleep mid-drag
        if (state === 'sleeping' || state === 'startled') setState('idle');
      }
    }

    if (drag.moved) {
      const pos = clampToViewport(e.clientX - drag.offsetX, e.clientY - drag.offsetY);
      root.style.left = pos.x + 'px';
      root.style.top = pos.y + 'px';
      root.style.right = 'auto';
      root.style.bottom = 'auto';
      wrap.classList.remove('show-menu');
    }
  }, { signal });
  window.addEventListener('pointerup', e => {
    if (drag && e.pointerId !== drag.pointerId) return; // a different pointer lifted, not ours
    clearTimeout(spinTimer);
    wrap.classList.remove('dragging');
    root.style.transition = '';
    if (drag) { try { wrap.releasePointerCapture(drag.pointerId); } catch (err) { /* noop */ } }
    lastActivity = Date.now(); // restart the idle-to-sleep countdown from release, not from grab
    const wasClick = drag && !drag.moved && !drag.longPressed; // a spin isn't a click
    const wasDrag = drag && drag.moved;
    drag = null;
    if (wasDrag) {
      persist({ position: { x: root.offsetLeft, y: root.offsetTop } }, { immediate: true });
    }
    if (wasClick && !getClosest(e, '.pet-menu')) {
      if (state === 'sleeping') { pokeActivity(); return; }
      const now = Date.now();
      if (now - lastTap < 350) {
        enhancePrompt();
        lastTap = 0;
      } else {
        lastTap = now;
        pokeActivity();
        wrap.classList.remove('show-menu');
      }
    }
  }, { signal });
  // Mobile/trackpad gestures can be cancelled by the browser mid-drag (palm
  // rejection, OS gesture takeover, multi-touch). Treat it exactly like a
  // pointerup for cleanup purposes — but never as a click, so it can't enhance.
  window.addEventListener('pointercancel', e => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    clearTimeout(spinTimer);
    wrap.classList.remove('dragging');
    root.style.transition = '';
    try { wrap.releasePointerCapture(drag.pointerId); } catch (err) { /* noop */ }
    lastActivity = Date.now(); // restart the idle-to-sleep countdown from release, not from grab
    const wasDrag = drag.moved;
    drag = null;
    if (wasDrag) {
      persist({ position: { x: root.offsetLeft, y: root.offsetTop } }, { immediate: true });
    }
  }, { signal });

  // A shrinking viewport (resize, devtools panel, orientation flip) must never
  // leave Rocky stranded past the new edge. Never fights an active drag.
  function reclampToViewport() {
    if (drag) return;
    const clamped = clampToViewport(root.offsetLeft, root.offsetTop);
    if (clamped.x !== root.offsetLeft || clamped.y !== root.offsetTop) {
      root.style.left = clamped.x + 'px';
      root.style.top = clamped.y + 'px';
      root.style.right = 'auto';
      root.style.bottom = 'auto';
      persist({ position: { x: clamped.x, y: clamped.y } });
    }
  }
  window.addEventListener('resize', reclampToViewport, { signal });
  window.addEventListener('orientationchange', reclampToViewport, { signal });

  const menuEnhance = doc.getElementById('menuEnhance');
  if (menuEnhance) menuEnhance.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    wrap.classList.remove('show-menu');
    enhancePrompt();
  });

  const menuUndo = doc.getElementById('menuUndo');
  if (menuUndo) menuUndo.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    wrap.classList.remove('show-menu');
    pokeActivity();
    const inputEl = lastEnhance ? (lastEnhance.inputRef && typeof lastEnhance.inputRef.deref === 'function' ? lastEnhance.inputRef.deref() : lastEnhance.inputRef) : null;
    if (!inputEl || !inputEl.isConnected) {
      say('nothing to undo 🤷', 2400);
      return;
    }
    try {
      setPromptText(inputEl, lastEnhance.original);
      lastEnhance = null;
      say('back to your original ↩️', 2400);
    } catch (err) {
      console.warn('Bandit: undo failed', err && err.message);
      say("couldn't undo that one 😖", 2400);
    }
  });

  const menuMore = doc.getElementById('menuMore');
  const menuExtra = doc.getElementById('menuExtra');
  if (menuMore && menuExtra) {
    menuMore.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      menuMore.style.display = 'none';
      menuExtra.style.display = 'flex';
    });
  }

  /* =========================================================
     HISTORY — last 10 Enhance/Summarize results, click to copy.
     ========================================================= */
  function timeAgo(t) {
    const s = Math.max(1, Math.round((Date.now() - t) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }

  function showHistoryModal() {
    const { modal, close } = openRockyModal();

    const h = document.createElement('h3');
    h.textContent = '📜 History';
    modal.appendChild(h);

    if (!copyHistory.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-size:12px;color:#8a95a5;line-height:1.6';
      empty.textContent = 'Nothing here yet — enhance a prompt or summarize a chat, and it lands here for re-copying.';
      modal.appendChild(empty);
    }

    if (copyHistory.length) {
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'secondary';
      clearBtn.style.cssText = 'font-size:11px;opacity:.7;margin-top:4px';
      clearBtn.textContent = '🗑 Clear history';
      clearBtn.addEventListener('click', () => {
        copyHistory = [];
        persist({ history: [] });
        close();
        showToast('history cleared');
      });
      modal.appendChild(clearBtn);
    }

    copyHistory.forEach(item => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'secondary';
      row.style.cssText = 'text-align:left;white-space:normal;line-height:1.5;display:block;width:100%';
      const icon = item.type === 'summary' ? '📋' : '✨';
      const preview = item.text.length > 90 ? item.text.slice(0, 90) + '…' : item.text;
      const meta = document.createElement('div');
      meta.style.cssText = 'font-size:10px;opacity:.6;margin-bottom:3px';
      meta.textContent = `${icon} ${item.type} · ${timeAgo(item.at)} · click to copy`;
      const body = document.createElement('div');
      body.textContent = preview;
      row.appendChild(meta);
      row.appendChild(body);
      row.addEventListener('click', () => {
        copyToClipboard(item.text)
          .then(() => { showToast('copied 📋'); close(); })
          .catch(() => { showToast("couldn't copy 😖"); });
      });
      modal.appendChild(row);
    });

    const done = document.createElement('button');
    done.type = 'button';
    done.textContent = 'Close';
    done.addEventListener('click', close);
    modal.appendChild(done);
  }

  const menuHistory = doc.getElementById('menuHistory');
  if (menuHistory) menuHistory.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    wrap.classList.remove('show-menu');
    pokeActivity();
    showHistoryModal();
  });

  const menuDisable = doc.getElementById('menuDisable');
  if (menuDisable) menuDisable.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    wrap.classList.remove('show-menu');
    const hostname = window.location.hostname;
    if (!hostname) return;
    (async () => {
      const currentState = window.RockyStorage ? await window.RockyStorage.loadState() : {};
      const currentList = currentState.disabledSites || [];
      if (!currentList.includes(hostname)) {
        persist({ disabledSites: [...currentList, hostname] }, { immediate: true });
        say('ZZZ... (disabled on this site)');
        setTimeout(() => {
          if (shadowHost) shadowHost.remove();
          else window.location.reload();
        }, 1500);
      }
    })().catch(err => console.warn('Bandit: disable failed', err));
  });

  const menuHome = doc.getElementById('menuHome');
  if (menuHome) menuHome.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    wrap.classList.remove('show-menu');
    stopRun();
    setState('running');
    isFetching = true;

    const startX = root.offsetLeft;
    const startY = root.offsetTop;

    // Go to the bottom right corner (leave a small margin)
    const landing = clampToViewport(window.innerWidth - 120, window.innerHeight - 150);

    const dx = landing.x - startX;
    const dy = landing.y - startY;
    pet.className = `pet ${dx < 0 ? 'face-left' : 'face-right'}`;

    const dist = Math.hypot(dx, dy);
    const duration = dist * 4; // 4ms per pixel speed

    root.style.transition = `left ${duration}ms linear, top ${duration}ms linear`;
    root.style.right = 'auto';
    root.style.bottom = 'auto';
    root.style.left = landing.x + 'px';
    root.style.top = landing.y + 'px';

    if (fetchTimer) clearTimeout(fetchTimer);
    fetchTimer = setTimeout(() => {
      isFetching = false;
      root.style.transition = '';
      persist({ position: { x: root.offsetLeft, y: root.offsetTop } });
      // Force sleep — override last activity so the sleep interval doesn't wake him
      setState('sleeping');
      lastActivity = Date.now() + 999999; // prevent sleepInterval from waking him
      
      const oldHouse = doc.querySelector('.bandit-house');
      if (oldHouse) oldHouse.remove();

      const house = document.createElement('div');
      house.innerText = '🏕️';
      house.style.position = 'fixed';
      house.style.fontSize = '32px';
      house.style.left = (landing.x + 10) + 'px';
      house.style.top = (landing.y - 10) + 'px';
      house.style.zIndex = '90';
      house.className = 'bandit-house';
      docBody.appendChild(house);
    }, duration);
  });

  function runSummarize() {
    if (state === 'working') return;
    pokeActivity(); stopRun();

    let transcript = '';
    try {
      transcript = scrapeConversation();
    } catch (err) {
      console.warn('Bandit: scrapeConversation threw', err);
    }

    if (!transcript || !transcript.trim()) {
      say("couldn't find a conversation to summarize here 🤔", 3000);
      return;
    }

    setState('working');
    sayThinking('reading through the chat 🔍');

    const SUMMARIZE_SYSTEM = window.RockyPrompts ? window.RockyPrompts.SUMMARIZE_SYSTEM : '';

    window.rockyAIPipeline(SUMMARIZE_SYSTEM, transcript, {
      actionKey: 'summarize',
      onProgress: (frac) => { stopThinking(); say(`downloading on-device AI… ${Math.round(frac * 100)}% 📥`, 0); },
    }).then(brief => {
      stopThinking();
      if (!brief || !brief.trim()) {
        setState('idle');
        say("the AI returned nothing — try again 🤔", 3000);
        return;
      }
      recordHistory('summary', brief);
      return copyToClipboard(brief).then(() => {
        setState('happy');
        say('context brief copied 📋 — paste it into your next chat', 3400);
        gainXP(15);
        setTimeout(() => { if (state === 'happy') setState('idle'); }, 2600);
      }).catch(() => {
        // Copy failed but we still got the summary — show it anyway
        setState('happy');
        say('summary ready but copy failed — check History 📜', 3400);
        gainXP(15);
        setTimeout(() => { if (state === 'happy') setState('idle'); }, 2600);
      });
    }).catch(err => {
      stopThinking();
      const errMsg = err && err.message ? err.message : String(err);
      console.warn('Bandit: summarize failed', errMsg);
      setState('idle');
      say(`couldn't get that summary — ${escapeHTML(friendlyError(err))}<br><b>Set up key in settings 🔧</b>`, 4200);
      
      if (errMsg.toLowerCase().includes('api key') || errMsg.toLowerCase().includes('cloud provider')) {
        setTimeout(() => {
          const btn = doc.getElementById('menuSettings');
          if (btn) btn.click();
        }, 1200);
      }
    });
  }

  const menuSummarize = doc.getElementById('menuSummarize');
  if (menuSummarize) menuSummarize.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    wrap.classList.remove('show-menu');
    runSummarize();
  });

  function eatApple(xpAmount) {
    stopRun();
    setState('idle');

    const apple = document.createElement('div');
    apple.innerText = '🍎';
    apple.style.position = 'absolute';
    apple.style.fontSize = '24px';
    apple.style.zIndex = '100';
    const isLeft = pet.classList.contains('face-left');
    apple.style.top = '50px';
    apple.style.left = isLeft ? '10px' : '80px';
    apple.style.transition = 'all 0.3s cubic-bezier(0.3, 1.4, 0.5, 1)';
    apple.style.transform = 'scale(0)';
    pet.appendChild(apple);

    setTimeout(() => apple.style.transform = 'scale(1)', 50);

    setTimeout(() => {
      eyesHappy();
      apple.style.transform = 'scale(0) translateY(10px)';
    }, 400);

    setTimeout(() => {
      apple.remove();
      eyesOpen();
      setState('happy');
      say(`nom nom nom 🍎 <span class="xp-pop">+${xpAmount} XP</span>`, 2500);
      gainXP(xpAmount);
      setTimeout(() => { if (state === 'happy') setState('idle') }, 2500);
    }, 700);
  }

  const SNACKS = ['🍪', '🍎', '🍩', '🍕', '🌮', '🧁'];
  function spawnFeedTreat() {
    stopRun();
    setState('idle');

    const snack = SNACKS[Math.floor(Math.random() * SNACKS.length)];
    const treat = document.createElement('div');
    treat.innerText = snack;
    treat.style.position = 'absolute';
    treat.style.fontSize = '22px';
    treat.style.zIndex = '100';
    const isLeft = pet.classList.contains('face-left');
    treat.style.top = '-16px';
    treat.style.left = isLeft ? '10px' : '80px';
    treat.style.transition = 'all 0.35s cubic-bezier(0.3, 1.4, 0.5, 1)';
    treat.style.transform = 'scale(0) translateY(0)';
    pet.appendChild(treat);

    setTimeout(() => { treat.style.transform = 'scale(1) translateY(66px)'; }, 50);

    setTimeout(() => {
      eyesHappy();
      treat.style.transform = 'scale(0) translateY(76px)';
      spawnHeart();
    }, 420);

    setTimeout(() => { spawnHeart(); }, 600);
    setTimeout(() => { spawnHeart(); }, 780);

    setTimeout(() => {
      treat.remove();
      eyesOpen();
      setState('happy');
      say(`nom nom nom ${snack} <span class="xp-pop">+5 XP</span>`, 2500);
      gainXP(5);
      setTimeout(() => { if (state === 'happy') setState('idle') }, 2500);
    }, 700);
  }

  let feedCountdownTimer = null;
  function showFeedCooldown(remainingMs) {
    clearInterval(feedCountdownTimer);
    let secs = Math.ceil(remainingMs / 1000);
    say(`I'm full… try again in ${secs}s 🦝`, 0);
    feedCountdownTimer = setInterval(() => {
      secs--;
      if (secs <= 0) {
        clearInterval(feedCountdownTimer);
        bubble.classList.remove('show');
        return;
      }
      say(`I'm full… try again in ${secs}s 🦝`, 0);
    }, 1000);
  }

  function feedRocky() {
    pokeActivity();
    const remaining = FEED_COOLDOWN_MS - (Date.now() - lastFedAt);
    if (remaining > 0) {
      showFeedCooldown(remaining);
      return;
    }
    lastFedAt = Date.now();
    persist({ lastFedAt }, { immediate: true });
    spawnFeedTreat();
  }

  const menuFeed = doc.getElementById('menuFeed');
  if (menuFeed) menuFeed.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    wrap.classList.remove('show-menu');
    feedRocky();
  });
  const settingsModal = doc.getElementById('settingsModal');
  const settingName = doc.getElementById('settingName');
  const settingSize = doc.getElementById('settingSize');
  const sizeValue = doc.getElementById('sizeValue');
  const settingProvider = doc.getElementById('settingProvider');
  const settingApiKey = doc.getElementById('settingApiKey');
  const settingModel = doc.getElementById('settingModel');
  const settingStyle = doc.getElementById('settingStyle');
  const settingAskPlaceholders = doc.getElementById('settingAskPlaceholders');
  const testApiKeyBtn = doc.getElementById('testApiKey');
  const testApiKeyStatus = doc.getElementById('testApiKeyStatus');

  const menuSettings = doc.getElementById('menuSettings');
  if (menuSettings) menuSettings.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    wrap.classList.remove('show-menu');
    if (settingProvider) settingProvider.value = aiSettings.provider || 'builtin';
    // Hydrate the key field from the per-provider map first, falling back to legacy flat field
    if (settingApiKey) settingApiKey.value = (aiSettings.apiKeys && aiSettings.apiKeys[aiSettings.provider]) || aiSettings.apiKey || '';
    if (settingModel) settingModel.value = aiSettings.model || '';
    if (settingStyle) settingStyle.value = enhanceStyle;
    if (settingAskPlaceholders) settingAskPlaceholders.checked = askPlaceholders;
    if (testApiKeyStatus) { testApiKeyStatus.textContent = ''; testApiKeyStatus.className = 'test-key-status'; }
    if (settingsModal) settingsModal.classList.add('show');
  });

  // Pasting a key auto-picks the matching provider in the dropdown.
  if (settingApiKey) settingApiKey.addEventListener('input', () => {
    const detected = detectProviderFromKey(settingApiKey.value);
    if (detected && settingProvider) settingProvider.value = detected;
  });

  // Switching provider swaps the key field to that provider's saved key,
  // so users can stash one key per provider (fuels the failover chain).
  let currentSettingsProvider = aiSettings.provider || 'builtin';
  if (settingProvider) {
    currentSettingsProvider = settingProvider.value;
    settingProvider.addEventListener('change', () => {
      // Save the typed key to the OLD provider before swapping to the new one
      if (currentSettingsProvider !== 'builtin') {
        aiSettings.apiKeys[currentSettingsProvider] = settingApiKey ? settingApiKey.value.trim() : '';
      }
      currentSettingsProvider = settingProvider.value;
      if (settingApiKey) settingApiKey.value = aiSettings.apiKeys[currentSettingsProvider] || '';
    });
  }

  const resetDisabledSites = doc.getElementById('resetDisabledSites');
  const resetDisabledStatus = doc.getElementById('resetDisabledStatus');
  if (resetDisabledSites) {
    resetDisabledSites.addEventListener('click', () => {
      persist({ disabledSites: [] }, { immediate: true });
      if (resetDisabledStatus) {
        resetDisabledStatus.textContent = 'Cleared!';
        setTimeout(() => { resetDisabledStatus.textContent = ''; }, 2000);
      }
    });
  }

  const closeSettings = doc.getElementById('closeSettings');
  if (closeSettings) closeSettings.addEventListener('click', () => {
    if (settingsModal) settingsModal.classList.remove('show');
    petName = (settingName ? settingName.value.trim() : petName) || 'Bandit';
    updateXPDisplay();

    const chosenProvider = settingProvider ? (settingProvider.value || 'builtin') : aiSettings.provider;
    const enteredKey = settingApiKey ? settingApiKey.value.trim() : aiSettings.apiKey;
    const newApiKeys = { ...aiSettings.apiKeys };
    if (chosenProvider !== 'builtin') newApiKeys[chosenProvider] = enteredKey; // '' clears that slot
    aiSettings = {
      provider: chosenProvider,
      apiKey: enteredKey,
      model: settingModel ? settingModel.value.trim() : aiSettings.model,
      apiKeys: newApiKeys,
    };
    if (settingStyle) enhanceStyle = settingStyle.value || 'structured';
    if (settingAskPlaceholders) askPlaceholders = settingAskPlaceholders.checked;
    persist({ petName, provider: aiSettings.provider, apiKey: aiSettings.apiKey, model: aiSettings.model, apiKeys: newApiKeys, enhanceStyle, askPlaceholders });
  });

  if (settingSize) settingSize.addEventListener('input', e => {
    const s = e.target.value;
    if (sizeValue) sizeValue.textContent = Math.round(s * 100) + '%';
    wrap.style.setProperty('--pet-scale', s);
    persist({ settings: { size: parseFloat(s) } });
  });

  if (testApiKeyBtn) testApiKeyBtn.addEventListener('click', () => {
    const provider = settingProvider ? settingProvider.value : 'builtin';
    if (provider === 'builtin') {
      if (testApiKeyStatus) { testApiKeyStatus.textContent = 'built-in AI needs no key ✓'; testApiKeyStatus.className = 'test-key-status ok'; }
      return;
    }
    const testSettings = {
      provider,
      apiKey: settingApiKey ? settingApiKey.value.trim() : '',
      model: settingModel ? settingModel.value.trim() : '',
    };
    if (!testSettings.apiKey) {
      if (testApiKeyStatus) { testApiKeyStatus.textContent = 'paste a key first'; testApiKeyStatus.className = 'test-key-status fail'; }
      return;
    }
    if (testApiKeyStatus) { testApiKeyStatus.textContent = 'testing…'; testApiKeyStatus.className = 'test-key-status'; }
    testApiKeyBtn.disabled = true;

    testAIKey(testSettings)
      .then(res => {
        if (testApiKeyStatus) { testApiKeyStatus.textContent = `✓ ${res.provider} key works`; testApiKeyStatus.className = 'test-key-status ok'; }
      })
      .catch(err => {
        if (testApiKeyStatus) { testApiKeyStatus.textContent = `✗ ${friendlyError(err)}`; testApiKeyStatus.className = 'test-key-status fail'; }
      })
      .finally(() => {
        testApiKeyBtn.disabled = false;
      });
  });

  const sendBtn = doc.getElementById('sendBtn');
  if (sendBtn) sendBtn.addEventListener('click', () => {
    pokeActivity();
    if (!input) return;
    const v = input.value.trim(); if (!v) return;

    const m = document.createElement('div');
    m.className = 'msg you' + (v.startsWith('GOAL') ? ' enhanced' : '');
    m.replaceChildren(...new DOMParser().parseFromString('<div class="who">' + (v.startsWith('GOAL') ? 'You · enhanced by Bandit' : 'You') + '</div>' + v.replace(/</g, '&lt;'), 'text/html').body.childNodes);
    if (messages) messages.appendChild(m);

    input.value = ''; input.style.height = 'auto';
    if (hint) hint.textContent = 'Bandit watches this box 👀';
    alertShown = false;

    stopRun();
    setState('working');
    say('Hold tight, the AI is cooking! 🍳', 8000);

    if (!messages) return;
    const aiMsg = document.createElement('div');
    aiMsg.className = 'msg ai';
    aiMsg.replaceChildren(...new DOMParser().parseFromString('<div class="who">VibeBuild AI</div><span class="stream"></span><span class="cursor">█</span>', 'text/html').body.childNodes);
    messages.appendChild(aiMsg);
    messages.scrollTop = messages.scrollHeight;

    const streamTarget = aiMsg.querySelector('.stream');
    const cursor = aiMsg.querySelector('.cursor');

    const fakeCode = `I've updated the components according to your prompt.
Here is the generated output:

\`\`\`javascript
export default function App() {
  return (
    <div className="flex h-screen bg-neutral-900 text-white">
      <h1 className="m-auto text-4xl font-bold">Hello World</h1>
    </div>
  );
}
\`\`\`

Let me know if you need any adjustments!`;

    let i = 0;
    const interval = setInterval(() => {
      streamTarget.textContent += fakeCode[i];
      messages.scrollTop = messages.scrollHeight;
      i++;
      if (i >= fakeCode.length) {
        clearInterval(interval);
        cursor.remove();
        setState('happy');
        say('All done! Boom! <span class="xp-pop">+10 XP</span>', 3000);
        gainXP(10);
        setTimeout(() => { if (state === 'happy') setState('idle'); }, 3000);
      }
    }, 25);
  });

  /* Keyboard shortcut: Ctrl+Shift+E (or Cmd+Shift+E on Mac) → Enhance */
  window.addEventListener('keydown', e => {
    pokeActivity();
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      e.stopPropagation();
      enhancePrompt();
    }
  }, { signal });

  window.addEventListener('dblclick', e => {
    if (state === 'working' || state === 'alert') return; // Don't interrupt AI processing or user input
    if (getClosest(e, '#petWrap') || getClosest(e, '.modal')) return;

    // Don't play fetch if the user is double-clicking text, inputs, buttons, or links
    const closest = getClosest(e, '*');
    const tag = closest && closest.tagName ? closest.tagName.toUpperCase() : '';
    const isInteractive = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A' || tag === 'SELECT' || getClosest(e, 'button') || getClosest(e, 'a') || (closest ? closest.isContentEditable : false);
    if (isInteractive) return;

    // Also check if text is selected to avoid fetching when highlighting words
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) return;


    // drop apple
    const apple = document.createElement('div');
    apple.className = 'fetch-apple';
    apple.innerText = '🍎';
    apple.style.position = 'fixed';
    apple.style.left = (e.clientX - 12) + 'px';
    apple.style.top = (e.clientY - 12) + 'px';
    docBody.appendChild(apple);

    stopRun();
    setState('running');
    pokeActivity();
    isFetching = true;

    const startX = root.offsetLeft;
    const startY = root.offsetTop;

    // Clamp the landing spot itself (not just the click point) so a fetch
    // triggered near an edge can't run Rocky off-screen.
    const landing = clampToViewport(e.clientX - 60, e.clientY - 90);

    const dx = landing.x - startX;
    const dy = landing.y - startY;
    pet.className = `pet ${dx < 0 ? 'face-left' : 'face-right'}`;

    const dist = Math.hypot(dx, dy);
    const duration = dist * 4; // 4ms per pixel speed

    root.style.transition = `left ${duration}ms linear, top ${duration}ms linear`;
    root.style.right = 'auto';
    root.style.bottom = 'auto';
    root.style.left = landing.x + 'px';
    root.style.top = landing.y + 'px';

    if (fetchTimer) clearTimeout(fetchTimer);
    fetchTimer = setTimeout(() => {
      if (!isFetching) return; // cancelled by drag
      isFetching = false;
      root.style.transition = '';
      apple.remove();
      eatApple(3);
      persist({ position: { x: root.offsetLeft, y: root.offsetTop } });
    }, duration);
  }, { signal });

  window.addEventListener('pointerdown', e => {
    if (!getClosest(e, '#rocky-root')) pokeActivity();
  }, { signal });

  /* =========================================================
     HYDRATE FROM SAVED STATE, THEN REVEAL
     ========================================================= */
  // Apply size BEFORE position: clampToViewport() measures Rocky's actual
  // rendered box, which the --pet-scale zoom affects.
  const hydratedSize = (hydrated.settings && hydrated.settings.size) || 1;
  wrap.style.setProperty('--pet-scale', hydratedSize);
  if (settingSize) settingSize.value = hydratedSize;

  // The saved spot may have come from a bigger screen — clamp it back on-screen.
  if (hydrated.position && typeof hydrated.position.x === 'number' && typeof hydrated.position.y === 'number') {
    const clampedStart = clampToViewport(hydrated.position.x, hydrated.position.y);
    root.style.left = clampedStart.x + 'px';
    root.style.top = clampedStart.y + 'px';
    root.style.right = 'auto';
    root.style.bottom = 'auto';
    if (clampedStart.x !== hydrated.position.x || clampedStart.y !== hydrated.position.y) {
      persist({ position: { x: clampedStart.x, y: clampedStart.y } });
    }
  }
  if (sizeValue) sizeValue.textContent = Math.round(hydratedSize * 100) + '%';
  if (settingName) settingName.value = petName;

  applyAccessories(level);
  updateXPDisplay();

  // If Rocky levels up (or gets renamed) in another tab, mirror it here live —
  // but don't touch position, so the two tabs' independent wandering doesn't fight.
  function applyRemoteState(remote) {
    if (!remote) return;
    let changed = false;
    if (remote.petName && remote.petName !== petName) {
      petName = remote.petName;
      if (settingName) settingName.value = petName;
      changed = true;
    }
    if (typeof remote.xp === 'number' && remote.xp !== xp) { xp = remote.xp; changed = true; }
    if (typeof remote.level === 'number' && remote.level !== level) {
      level = remote.level;
      applyAccessories(level);
      changed = true;
    }
    if (typeof remote.provider === 'string' || typeof remote.apiKey === 'string' || typeof remote.model === 'string' || remote.apiKeys) {
      aiSettings = {
        provider: typeof remote.provider === 'string' ? remote.provider : aiSettings.provider,
        apiKey: typeof remote.apiKey === 'string' ? remote.apiKey : aiSettings.apiKey,
        model: typeof remote.model === 'string' ? remote.model : aiSettings.model,
        apiKeys: remote.apiKeys && typeof remote.apiKeys === 'object' ? remote.apiKeys : aiSettings.apiKeys,
      };
    }
    if (typeof remote.lastFedAt === 'number') lastFedAt = remote.lastFedAt;
    if (typeof remote.enhanceStyle === 'string') enhanceStyle = remote.enhanceStyle;
    if (typeof remote.askPlaceholders === 'boolean') askPlaceholders = remote.askPlaceholders;
    if (Array.isArray(remote.history)) copyHistory = remote.history;
    if (changed) updateXPDisplay();
  }
  if (window.RockyStorage) window.RockyStorage.onStateChanged(applyRemoteState);

  // Catch any pending debounced write before the page (and this script) is torn down.
  window.addEventListener('beforeunload', () => {
    if (window.RockyStorage) window.RockyStorage.flush();
  }, { signal });

  cleanupTasks.push(() => {
    clearTimeout(gainXP._t);
    clearTimeout(say._t);
    stopRun();
    lastEnhance = null;
  });

  root.style.visibility = '';

  // The stylesheet may not have finished applying when hydration first
  // measured Rocky's box above (clampToViewport's 150x180 fallback covers that
  // gap). Re-clamp once layout has definitely settled, using the real
  // measurement — rAF for the common case, 'load' as a belt-and-suspenders for
  // slow-loading pages where even a rAF fires before styles are in.
  requestAnimationFrame(reclampToViewport);
  window.addEventListener('load', reclampToViewport, { signal });

  // Daily streak: first visit each local day counts; consecutive days earn +5 XP.
  (function checkDailyStreak() {
    const fmt = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    const today = fmt(Date.now());
    if (hydrated.lastVisitDay === today) return;
    const newStreak = hydrated.lastVisitDay === fmt(Date.now() - 86400000) ? (hydrated.streak || 0) + 1 : 1;
    persist({ lastVisitDay: today, streak: newStreak });
    if (newStreak >= 2) {
      setTimeout(() => {
        gainXP(5, true);
        say(`🔥 day ${newStreak} streak! <span class="xp-pop">+5 XP</span>`, 3200);
      }, 2200);
    }
  })();

  if (!hydrated.onboarded) {
    // Multi-step onboarding for new users — teaches them what Bandit does
    setTimeout(() => {
      say(`hi, I'm <b>${escapeHTML(petName)}</b> 🦝<br>I make your AI prompts way better!`, 4500);
    }, 700);
    setTimeout(() => {
      say('Type a rough idea in any text box,<br>then press <b>Ctrl+Shift+E</b> ⚡<br>I\'ll turn it into a pro prompt!', 6000);
    }, 5500);
    setTimeout(() => {
      say('<b>Right-click me</b> for the full menu:<br>✨ Enhance · 📋 Summarize · ⚙️ Settings', 5000);
      persist({ onboarded: true });
    }, 12000);
  } else if (Math.random() < 0.35) {
    // Returning user: occasional time-of-day hello, kept rare so it never nags.
    setTimeout(() => {
      if (state !== 'idle') return;
      const h = new Date().getHours();
      const g = h < 6 ? 'up late hacking? me too 🌙' : h < 12 ? 'morning! ☀️ let\'s build something' : h < 18 ? 'afternoon grind 🔨 let\'s go' : 'evening vibes 🌆 still at it?';
      say(g, 2600);
    }, 1400);
  }
  setTimeout(() => { if (state === 'idle') startRun(); }, 4200);
  // Listen for context menu requests
  if (rockyApi && rockyApi.runtime && rockyApi.runtime.onMessage) {
    rockyApi.runtime.onMessage.addListener((msg) => {
      if (msg.type === "ROCKY_TRIGGER_ENHANCE" && msg.text) {
        if (state !== 'idle') return;
        const dummyInput = {
          value: msg.text,
          tagName: 'TEXTAREA',
          isContentEditable: false,
          isConnected: false,
          focus: () => { },
          setAttribute: () => { },
          removeAttribute: () => { },
          isContextMenu: true
        };
        // We simulate a host input so enhancePrompt can run exactly as usual
        enhancePrompt(dummyInput, msg.text);
      }
    });
  }

}

// Auto-run if we are not in the Chrome Extension environment
if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
  window.addEventListener('DOMContentLoaded', () => {
    const demoRoot = document.getElementById('rocky-root');
    if (demoRoot) demoRoot.style.visibility = 'hidden';
    const loadPromise = window.RockyStorage ? window.RockyStorage.loadState() : Promise.resolve(null);
    loadPromise
      .catch(err => { console.warn('Bandit: state load failed, using defaults', err); return null; })
      .then(state => initRocky(state));
  });
}
