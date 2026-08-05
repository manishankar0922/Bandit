import { BANDIT_SPRITES } from './sprites.js';

export function initPet(shadowRoot, initialState, callbacks) {
  let doc = shadowRoot;
  let wrap = doc.getElementById('petWrap');
  let pet = doc.getElementById('pet');
  let bubble = doc.getElementById('bubble');
  let bubbleText = doc.getElementById('bubbleText');
  let followUpForm = doc.getElementById('followUpForm');
  let followUpInput = doc.getElementById('followUpInput');
  let xpFill = doc.getElementById('xpFill');
  let xpLabel = doc.getElementById('xpLabel');
  let toast = doc.getElementById('toast');
  let frontSvg = doc.getElementById('frontSvg');
  let bubbleClose = doc.getElementById('bubbleClose');

  if (bubbleClose) bubbleClose.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    bubble.classList.remove('show');
    if (followUpForm) followUpForm.style.display = 'none';
  });

  // We only use the front sprite now (no side/sleep/dangle separate svgs, we animate the front one)
  // Clean up old elements if they exist from the template
  let sideS = doc.getElementById('sideSprite'); if(sideS) sideS.remove();
  let sleepS = doc.getElementById('sleepSprite'); if(sleepS) sleepS.remove();
  let dangleS = doc.getElementById('dangleSprite'); if(dangleS) dangleS.remove();

  if (!frontSvg) return null; // failed to find UI

  // --- INTERNAL STATE ---
  let petName = initialState.petName || 'Bandit';
  let xp = initialState.xp || 0;
  let level = initialState.level || 1;
  let settingsSize = initialState.settingsSize || 1;
  let isDragging = false;
  let startX = 0, startY = 0, initialLeft = 0, initialTop = 0;
  let petLeft = initialState.position?.x ?? (window.innerWidth - 180);
  let petTop = initialState.position?.y ?? (window.innerHeight - 180);
  let hasMoved = false;

  let activityTimer = null;
  let sleepMode = false;
  let accessories = { shades: false, scarf: false, crown: false };

  function setSafeSvg(element, htmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${htmlString}</svg>`, 'image/svg+xml');
    element.innerHTML = ''; // This is safe because it's an empty string
    while (doc.documentElement.firstChild) {
      element.appendChild(doc.documentElement.firstChild);
    }
  }

  // --- RENDER SPRITE ---
  function renderSprite() {
    let html = BANDIT_SPRITES.body + BANDIT_SPRITES.tail;
    if (accessories.shades) html += BANDIT_SPRITES.shades;
    else html += BANDIT_SPRITES.eyesOpen;
    html += BANDIT_SPRITES.ears;
    if (accessories.scarf) html += BANDIT_SPRITES.scarf;
    if (accessories.crown) html += BANDIT_SPRITES.crown;

    setSafeSvg(frontSvg, `
      <g class="tail">${BANDIT_SPRITES.tail}</g>
      <g class="body-group">
        ${BANDIT_SPRITES.body}
        ${accessories.shades ? BANDIT_SPRITES.shades : BANDIT_SPRITES.eyesOpen}
        <g class="ears">${BANDIT_SPRITES.ears}</g>
        ${accessories.scarf ? BANDIT_SPRITES.scarf : ''}
        ${accessories.crown ? BANDIT_SPRITES.crown : ''}
      </g>
    `);
  }

  function applyAccessories(lv) {
    accessories = { shades: lv >= 3, scarf: lv >= 5, crown: lv >= 7 };
    renderSprite();
  }
  applyAccessories(level);

  // --- POSITIONING ---
  function clampPosition() {
    const maxX = window.innerWidth - 60;
    const maxY = window.innerHeight - 60;
    petLeft = Math.max(-20, Math.min(petLeft, maxX));
    petTop = Math.max(-20, Math.min(petTop, maxY));
  }
  
  let cachedPetCenterX = 0;
  function updatePosition() {
    if (!wrap) return;
    wrap.style.left = petLeft + 'px';
    wrap.style.top = petTop + 'px';
    wrap.style.bottom = 'auto';
    wrap.style.right = 'auto';

    if (petLeft > window.innerWidth / 2) {
      wrap.classList.add('menu-left');
    } else {
      wrap.classList.remove('menu-left');
    }
    
    // Cache center for mousemove to prevent layout thrashing
    const rect = wrap.getBoundingClientRect();
    cachedPetCenterX = rect.left + rect.width / 2;
  }

  clampPosition();
  updatePosition();
  if (wrap) wrap.style.setProperty('--pet-scale', settingsSize);

  // --- ANIMATIONS & BEHAVIORS ---
  function pokeActivity() {
    if (sleepMode) wakeUp();
    clearTimeout(activityTimer);
    activityTimer = setTimeout(fallAsleep, 60000); // sleep after 60s of no poking
  }

  function wakeUp() {
    if (!sleepMode) return;
    sleepMode = false;
    wrap.classList.remove('sleeping');
    // Open eyes
    const bodyG = frontSvg.querySelector('.body-group');
    if (bodyG) {
      setSafeSvg(bodyG, `
        ${BANDIT_SPRITES.body}
        ${accessories.shades ? BANDIT_SPRITES.shades : BANDIT_SPRITES.eyesOpen}
        <g class="ears">${BANDIT_SPRITES.ears}</g>
        ${accessories.scarf ? BANDIT_SPRITES.scarf : ''}
        ${accessories.crown ? BANDIT_SPRITES.crown : ''}
      `);
    }
    say('*yawns*');
  }

  function fallAsleep() {
    if (isDragging || sleepMode) return;
    sleepMode = true;
    wrap.className = 'pet-wrap sleeping';
    wrap.classList.toggle('menu-left', petLeft > window.innerWidth / 2); // preserve menu side
    // Close eyes
    const bodyG = frontSvg.querySelector('.body-group');
    if (bodyG) {
      setSafeSvg(bodyG, `
        ${BANDIT_SPRITES.body}
        ${accessories.shades ? BANDIT_SPRITES.shades : BANDIT_SPRITES.eyesClosed}
        <g class="ears">${BANDIT_SPRITES.ears}</g>
        ${accessories.scarf ? BANDIT_SPRITES.scarf : ''}
        ${accessories.crown ? BANDIT_SPRITES.crown : ''}
      `);
    }
  }

  pokeActivity();

  // Face left/right based on mouse position relative to pet
  // Uses cached center to prevent layout thrashing (lag) on every mousemove
  document.addEventListener('mousemove', (e) => {
    if (sleepMode || isDragging || !wrap) return;
    if (e.clientX < cachedPetCenterX - 20) {
      pet.classList.add('face-left');
    } else if (e.clientX > cachedPetCenterX + 20) {
      pet.classList.remove('face-left');
    }
  }, { passive: true });

  let sayTimer = null;
  function say(text, timeoutMs = 4000) {
    if (!bubble) return;
    if (followUpForm) followUpForm.style.display = 'none';
    if (bubbleText) bubbleText.innerHTML = text;
    bubble.classList.add('show');
    clearTimeout(sayTimer);
    if (timeoutMs > 0) {
      sayTimer = setTimeout(() => bubble.classList.remove('show'), timeoutMs);
    }
  }

  function askForRefinement(promptHtml, onRefine) {
    if (!bubble || !bubbleText || !followUpForm) return;
    clearTimeout(sayTimer);
    bubbleText.innerHTML = promptHtml;
    followUpForm.style.display = 'block';
    bubble.classList.add('show');
    
    // clear and focus
    followUpInput.value = '';
    followUpInput.focus();
    
    // one-time submit handler
    const onSubmit = (e) => {
      e.preventDefault();
      const val = followUpInput.value.trim();
      followUpForm.style.display = 'none';
      bubble.classList.remove('show');
      followUpForm.removeEventListener('submit', onSubmit);
      if (val) onRefine(val);
    };
    followUpForm.addEventListener('submit', onSubmit);
    
    // Auto-dismiss after a few seconds if they don't use it!
    sayTimer = setTimeout(() => {
      if (document.activeElement !== followUpInput && followUpInput.value.trim() === '') {
        followUpForm.style.display = 'none';
        bubble.classList.remove('show');
        followUpForm.removeEventListener('submit', onSubmit);
      }
    }, 4500);
  }

  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
  }

  // --- XP & LEVELING ---
  function updateXPDisplay() {
    if (!xpFill || !xpLabel) return;
    let nextXP = level * 20;
    let pct = Math.min(100, Math.max(0, (xp / nextXP) * 100));
    xpFill.style.width = pct + '%';
    xpLabel.innerHTML = `${petName.toUpperCase()} · <b>LVL ${level}</b> · ${xp}/${nextXP} XP`;
  }

  function addXP(amount) {
    xp += amount;
    let nextXP = level * 20;
    let leveledUp = false;
    while (xp >= nextXP) {
      xp -= nextXP;
      level++;
      nextXP = level * 20;
      leveledUp = true;
      applyAccessories(level);
    }

    updateXPDisplay();
    callbacks.persist({ xp, level });

    if (leveledUp) {
      say(`<b>LEVEL UP!</b><br>I'm level ${level} now! 🎉`, 5000);
      wrap.classList.add('levelup');
      setTimeout(() => wrap.classList.remove('levelup'), 1500);
    } else {
      wrap.classList.add('show-xp');
      setTimeout(() => wrap.classList.remove('show-xp'), 2000);
    }
  }
  
  updateXPDisplay();

  // --- DRAG ---
  function onPointerDown(e) {
    if (e.button !== 0 || !wrap) return;
    const target = e.target;
    // Don't drag if clicking buttons or menu. Prevent default to preserve focus, EXCEPT for inputs!
    if (target.tagName === 'BUTTON' || target.closest('.radial-menu') || target.closest('#petMenu') || target.closest('.bubble')) {
      if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
        e.preventDefault();
      }
      return;
    }
    
    isDragging = true;
    hasMoved = false;
    startX = e.clientX;
    startY = e.clientY;
    initialLeft = petLeft;
    initialTop = petTop;
    wrap.classList.add('dragging');
    pokeActivity();
    
    e.preventDefault();
    wrap.setPointerCapture(e.pointerId);
    wrap.addEventListener('pointermove', onPointerMove);
    wrap.addEventListener('pointerup', onPointerUp);
    wrap.addEventListener('pointercancel', onPointerUp);
  }

  function onPointerMove(e) {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved = true;
    
    petLeft = initialLeft + dx;
    petTop = initialTop + dy;
    clampPosition();
    updatePosition();
    
    // face direction of drag
    if (dx < -2) pet.classList.add('face-left');
    else if (dx > 2) pet.classList.remove('face-left');
  }

  function onPointerUp(e) {
    isDragging = false;
    wrap.classList.remove('dragging');
    wrap.removeEventListener('pointermove', onPointerMove);
    wrap.removeEventListener('pointerup', onPointerUp);
    wrap.removeEventListener('pointercancel', onPointerUp);
    try {
      if (wrap.hasPointerCapture(e.pointerId)) {
        wrap.releasePointerCapture(e.pointerId);
      }
    } catch (err) {}
    
    if (hasMoved) {
      callbacks.persist({ position: { x: petLeft, y: petTop } });
      // drop startle
      wrap.classList.add('startled');
      const emote = doc.getElementById('startleEmote');
      if (emote) {
        emote.style.display = 'block';
        setTimeout(() => emote.style.display = 'none', 600);
      }
      setTimeout(() => wrap.classList.remove('startled'), 500);
    } else {
      // It was a click!
      toggleMenu();
    }
  }

  if (wrap) wrap.addEventListener('pointerdown', onPointerDown);

  // --- MENU ---
  function toggleMenu() {
    pokeActivity();
    if (wrap.classList.contains('show-menu')) {
      wrap.classList.remove('show-menu');
      const m = doc.getElementById('menuExtra');
      const b = doc.getElementById('menuMore');
      if (m && b) { m.style.display = 'none'; b.style.display = 'block'; }
    } else {
      wrap.classList.add('show-menu');
    }
  }

  // Click outside to close menu
  document.addEventListener('pointerdown', (e) => {
    if (!wrap) return;
    if (wrap.classList.contains('show-menu')) {
      const p = e.composedPath();
      if (!p.includes(wrap) && !p.some(el => el.classList && el.classList.contains('modal-overlay'))) {
        wrap.classList.remove('show-menu');
      }
    }
  });

  // --- EXPORT API ---
  return {
    updateState: (partial) => {
      if (partial.petName !== undefined) petName = partial.petName;
      if (partial.xp !== undefined) xp = partial.xp;
      if (partial.level !== undefined) {
        level = partial.level;
        applyAccessories(level);
      }
      if (partial.settingsSize !== undefined) {
        settingsSize = partial.settingsSize;
        if (wrap) wrap.style.setProperty('--pet-scale', settingsSize);
      }
      updateXPDisplay();
    },
    say,
    showToast,
    askForRefinement,
    addXP,
    pokeActivity,
    goHome: () => {
      petLeft = window.innerWidth - 180;
      petTop = window.innerHeight - 180;
      updatePosition();
      callbacks.persist({ position: { x: petLeft, y: petTop } });
      wrap.classList.add('hopping');
      setTimeout(() => wrap.classList.remove('hopping'), 600);
    },
    playAnimation: (className, ms) => {
      pokeActivity();
      wrap.classList.add(className);
      setTimeout(() => wrap.classList.remove(className), ms);
    },
    feed: () => {
      pokeActivity();
      const apple = document.createElement('div');
      apple.className = 'fetch-apple';
      apple.textContent = '🍎';
      const r = wrap.getBoundingClientRect();
      apple.style.left = (r.left + r.width/2 - 12) + 'px';
      apple.style.top = (r.top + r.height/2 - 12) + 'px';
      const rootEl = shadowRoot.getElementById('rocky-root') || shadowRoot;
      rootEl.appendChild(apple);
      
      say('Nom nom nom! 🍎', 2000);
      wrap.classList.add('happy');
      
      setTimeout(() => {
        apple.remove();
        wrap.classList.remove('happy');
        addXP(1);
      }, 1000);
    }
  };
}
