BanditEnv.initBanditAnimations = function(savedState) {

  /* =========================================================
     CONVERSATION SCRAPING — per-site adapters + generic fallback.
     Every stage is try/caught: a broken selector never crashes the host page,
     it just falls through to the next, less-specific strategy.
     ========================================================= */


  /* =========================================================
     SHARED PALETTE + HELPERS
     ========================================================= */
  NS = 'http://www.w3.org/2000/svg';
  function group(cls, parentSvg) {
    const g = document.createElementNS(NS, 'g');
    if (cls) g.setAttribute('class', cls);
    parentSvg.appendChild(g); return g;
  }

  frontSvg = doc.getElementById('frontSvg');
  if (!frontSvg) { console.error('Bandit: #frontSvg missing — aborting init'); return; }
  
  fTailG = group('tail', frontSvg);
  fTailG.innerHTML = BANDIT_SPRITES.tail;
  
  fBodyG = group('body-group', frontSvg);
  fEarsG = document.createElementNS(NS, 'g'); fEarsG.setAttribute('class', 'ears'); fBodyG.appendChild(fEarsG);
  fEarsG.innerHTML = BANDIT_SPRITES.ears;
  
  fBodyRectsG = document.createElementNS(NS, 'g'); fBodyG.appendChild(fBodyRectsG);
  fBodyRectsG.innerHTML = BANDIT_SPRITES.body;
  
  fEyesG = document.createElementNS(NS, 'g'); fBodyG.appendChild(fEyesG);
  fAccG = document.createElementNS(NS, 'g'); fBodyG.appendChild(fAccG);
  
  function overlay(g, html) { if (!g) return; g.innerHTML = html || ''; }
  function eyesOpen() { overlay(fEyesG, BANDIT_SPRITES.eyesOpen); }
  function eyesClosed() { overlay(fEyesG, BANDIT_SPRITES.eyesClosed); }
  function eyesHappy() { overlay(fEyesG, BANDIT_SPRITES.eyesHappy); }
  
  function applyAccessories(lvl) {
    let accHtml = '';
    if (lvl >= 2) accHtml += BANDIT_SPRITES.shades;
    if (lvl >= 3) accHtml += BANDIT_SPRITES.scarf;
    if (lvl >= 4) accHtml += BANDIT_SPRITES.crown;
    overlay(fAccG, accHtml);
  }
  eyesOpen();

  /* =========================================================
     STATE + BEHAVIOR
     ========================================================= */
  wrap = doc.getElementById('petWrap');
  root = doc.getElementById('rocky-root');
  pet = doc.getElementById('pet');
  bubble = doc.getElementById('bubble');
  input = doc.getElementById('promptInput');
  box = doc.getElementById('composerBox');
  hint = doc.getElementById('composerHint');
  xpFill = doc.getElementById('xpFill');
  xpLabel = doc.getElementById('xpLabel');
  toast = doc.getElementById('toast');
  messages = doc.getElementById('messages');

  if (!wrap || !root || !pet || !bubble) { console.error('Bandit: critical DOM elements missing — aborting init'); return; }

  state = 'idle';
  xp = hydrated.xp, level = hydrated.level;
  petName = hydrated.petName;
  lastFedAt = hydrated.lastFedAt || 0;
  aiSettings = { provider: hydrated.provider || 'builtin', apiKey: hydrated.apiKey || '', model: hydrated.model || '', apiKeys: hydrated.apiKeys || {} };
  enhanceStyle = hydrated.enhanceStyle || 'structured';
  enhanceTone = hydrated.enhanceTone || 'professional';
  askPlaceholders = hydrated.askPlaceholders === true; // default OFF — enable in settings
  lastEnhance = null; // { inputRef, original } — lets the Undo menu restore pre-enhance text
  // Named copyHistory (not `history`) to avoid shadowing window.history.
  copyHistory = Array.isArray(hydrated.history) ? hydrated.history : [];

  function recordHistory(type, text) {
    copyHistory = [{ type, text, at: Date.now() }, ...copyHistory].slice(0, 10);
    persist({ history: copyHistory });
  }
  currentVersion = (rockyApi && rockyApi.runtime && rockyApi.runtime.getManifest) ? rockyApi.runtime.getManifest().version : '2.4';
  lastSeenVersion = hydrated.lastSeenVersion || '';
  updateMessageCount = hydrated.updateMessageCount || 0;

  if (lastSeenVersion && lastSeenVersion !== currentVersion) {
    lastSeenVersion = currentVersion;
    updateMessageCount = 0;
    persist({ lastSeenVersion, updateMessageCount });
  } else if (!lastSeenVersion) {
    lastSeenVersion = currentVersion;
    updateMessageCount = 5; // Don't show on very first install
    persist({ lastSeenVersion, updateMessageCount });
  }

  FEED_COOLDOWN_MS = 60000;
  LEVELS = [0, 20, 50, 100]; // level 1..4 thresholds; Level 4 is max, so no 200 cap.
  lastActivity = Date.now();
  alertShown = false;
  runAnim = null;
  isHovering = false;
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
  thinkingTimer = null;
  function sayThinking(base) {
    clearInterval(thinkingTimer);
    let n = 0;
    const step = () => { n = (n % 3) + 1; say(base + '.'.repeat(n), 0); };
    step();
    thinkingTimer = setInterval(step, 450);
    cleanupTasks.push(() => clearInterval(thinkingTimer));
  }
  function stopThinking() {
    clearInterval(thinkingTimer);
    thinkingTimer = null;
  }

  /* blinking (front sprite) */
  blinkTimer;
  (function scheduleBlink() {
    blinkTimer = setTimeout(() => {
      if (!document.hidden && state !== 'sleeping' && state !== 'running' && level < 2) {
        eyesClosed(); setTimeout(() => { if (state !== 'sleeping') eyesOpen(); }, 140);
      }
      scheduleBlink();
    }, 2200 + Math.random() * 2600);
  })();
  cleanupTasks.push(() => clearTimeout(blinkTimer));

  isFetching = false;
  fetchTimer = null;
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
  sleepInterval = setInterval(() => {
    if (document.hidden) return;
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
      if (document.hidden) { setState('idle'); runAnim = null; return; }
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
  runInterval = setInterval(() => {
    if (document.hidden) return;
    if (state === 'idle' && !isHovering && Date.now() - lastActivity > 5000 && Math.random() < .4) startRun();
  }, 8000);
  cleanupTasks.push(() => clearInterval(runInterval));
  function stopRun() {
    if (runAnim) cancelAnimationFrame(runAnim);
    runAnim = null;
    if (state === 'running' || state === 'scooting' || state === 'hopping') setState('idle');
  }

  /* idle chatter */
  idleLines = [
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
  chatterInterval = setInterval(() => {
    if (document.hidden) return;
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

  /* =========================================================
     PLACEHOLDER Q&A — when the enhanced prompt contains
     [bracketed placeholders], Rocky asks the user to fill each one
     (with clickable suggestions) before inserting the final text.
     ========================================================= */
  PLACEHOLDER_SUGGESTIONS = [
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
    const dialog = BanditModals.createDialog(onClose);
    dialog.show();
    return { modal: dialog.modal, close: dialog.close };
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
    wrap.classList.remove('show-menu');
    const hostInput = overrideInput || BanditInjector.getHostInput();

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

    const buildSys = window.RockyPrompts && window.RockyPrompts.buildSystemPrompt;
    const ENHANCE_SYSTEM = buildSys
      ? buildSys(enhanceStyle, enhanceTone)
      : ((window.RockyPrompts && window.RockyPrompts.ENHANCE_SYSTEMS || {})[enhanceStyle] || (window.RockyPrompts ? window.RockyPrompts.ENHANCE_SYSTEM : ''));

    const inputWordCount = val.trim().split(/\s+/).length;

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
          BanditInjector.setPromptText(hostInput, finalStr);
          const outputWordCount = finalStr.split(/\s+/).length;
          say(`trash → treasure! <span class="xp-pop">+10 XP</span> ✨<br><span style="opacity:.7">${inputWordCount} → ${outputWordCount} words · menu → ↩️ Undo</span>`, 4200);
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
};
