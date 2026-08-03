BanditEnv.initBanditDrag = function(savedState) {
  updateXPDisplay = function() {
    const base = LEVELS[level - 1] || 0, next = LEVELS[level] ?? xp;
    const range = next - base; const pct = range > 0 ? Math.min(100, ((xp - base) / range) * 100) : 100;
    if (xpFill) xpFill.style.width = pct + '%';
    const name = (petName || 'Bandit').toUpperCase();
    if (xpLabel) xpLabel.replaceChildren(...new DOMParser().parseFromString(`${escapeHTML(name)} · <b>LVL ${level}</b> · ${xp}/${LEVELS[level] ?? 'MAX'} XP`, 'text/html').body.childNodes);
  }

  gainXP = function(n, silent = false) {
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

  getClosest = function(e, sel) {
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
  clampToViewport = function(left, top) {
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
  drag = null;
  spinTimer = null;
  cleanupTasks.push(() => clearTimeout(spinTimer));
  lastTap = 0;

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
  petDistance = 0;
  lastHeartTime = 0;
  spawnHeart = function() {
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
  lastEyeMove = 0;
  eyesFollowCursor = function(e) {
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

  lastPointerCheck = 0;
  window.addEventListener('pointermove', e => {
    if (!drag) {
      eyesFollowCursor(e);
      if (state === 'sleeping') return;

      const now = Date.now();
      if (now - lastPointerCheck < 50) return;
      lastPointerCheck = now;

      if (!getClosest(e, '#pet')) return;

      petDistance += Math.hypot(e.movementX, e.movementY) * 5; // scaled up since we drop frames
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
        wrap.classList.toggle('show-menu');
      }
    }
  }, { signal });
};
