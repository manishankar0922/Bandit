BanditEnv.initBanditUI = function(savedState) {
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

  menuEnhance = doc.getElementById('menuEnhance');
  if (menuEnhance) menuEnhance.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    wrap.classList.remove('show-menu');
    enhancePrompt();
  });

  menuUndo = doc.getElementById('menuUndo');
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
      BanditInjector.setPromptText(inputEl, lastEnhance.original);
      lastEnhance = null;
      say('back to your original ↩️', 2400);
    } catch (err) {
      console.warn('Bandit: undo failed', err && err.message);
      say("couldn't undo that one 😖", 2400);
    }
  });

  menuMore = doc.getElementById('menuMore');
  menuExtra = doc.getElementById('menuExtra');
  if (menuMore && menuExtra) {
    menuMore.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      menuMore.style.display = 'none';
      menuExtra.style.display = 'flex';
    });
  }

  /* =========================================================
     HISTORY
     ========================================================= */
  if (BanditEnv.initHistory) BanditEnv.initHistory();

  menuDisable = doc.getElementById('menuDisable');
  if (menuDisable) menuDisable.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    wrap.classList.remove('show-menu');
    const hostname = window.location.hostname;
    if (!hostname) {
      say('I cannot be disabled on local files! 🐾', 3000);
      return;
    }
    (async () => {
      const currentState = window.RockyStorage ? await window.RockyStorage.loadState() : {};
      const currentList = currentState.disabledSites || [];
      if (!currentList.includes(hostname)) {
        persist({ disabledSites: [...currentList, hostname] }, { immediate: true });
      }
      say('ZZZ... (disabled on this site)');
      setTimeout(() => {
        if (shadowHost) {
          shadowHost.dispatchEvent(new CustomEvent('bandit-cleanup'));
          shadowHost.remove();
        } else {
          const root = document.getElementById('rocky-root');
          if (root) root.remove();
        }
      }, 1500);
    })().catch(err => console.warn('Bandit: disable failed', err));
  });

  menuHome = doc.getElementById('menuHome');
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
      transcript = BanditScraper.scrapeConversation();
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

  menuSummarize = doc.getElementById('menuSummarize');
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

  SNACKS = ['🍪', '🍎', '🍩', '🍕', '🌮', '🧁'];
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

  feedCountdownTimer = null;
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
    cleanupTasks.push(() => clearInterval(feedCountdownTimer));
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

  menuFeed = doc.getElementById('menuFeed');
  if (menuFeed) menuFeed.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    wrap.classList.remove('show-menu');
    feedRocky();
  });
  /* =========================================================
     SETTINGS
     ========================================================= */
  if (BanditEnv.initSettings) BanditEnv.initSettings();


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
  hydratedSize = (hydrated.settings && hydrated.settings.size) || 1;
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
  initialRaf = requestAnimationFrame(reclampToViewport);
  cleanupTasks.push(() => cancelAnimationFrame(initialRaf));
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
      say('<b>Click on me</b> for the full menu!<br>Or select text and <b>Right-Click</b> to enhance.', 5000);
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
      .then(state => {
        const hostname = window.location.hostname;
        if (state && state.disabledSites && hostname && state.disabledSites.includes(hostname)) {
          if (demoRoot) demoRoot.remove();
          return;
        }
        initRocky(state);
      });
  });
};
