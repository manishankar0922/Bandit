import { showHistoryModal } from './history.js';

export function bindMenuHandlers(doc, wrap, stateObj, callbacks) {
  const menuEnhance = doc.getElementById('menuEnhance');
  if (menuEnhance) menuEnhance.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    wrap.classList.remove('show-menu');
    callbacks.enhancePrompt();
  });

  const menuUndo = doc.getElementById('menuUndo');
  if (menuUndo) menuUndo.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    wrap.classList.remove('show-menu');
    callbacks.pokeActivity();
    callbacks.undoEnhance();
  });

  const menuDisable = doc.getElementById('menuDisable');
  if (menuDisable) menuDisable.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    wrap.classList.remove('show-menu');
    const hostname = window.location.hostname;
    if (!hostname) {
      callbacks.say('I cannot be disabled on local files! 🐾', 3000);
      return;
    }
    callbacks.disableOnSite(hostname);
  });

  const menuHome = doc.getElementById('menuHome');
  if (menuHome) menuHome.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    wrap.classList.remove('show-menu');
    callbacks.goHome();
  });

  const menuSummarize = doc.getElementById('menuSummarize');
  if (menuSummarize) menuSummarize.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    wrap.classList.remove('show-menu');
    callbacks.runSummarize();
  });

  const menuFeed = doc.getElementById('menuFeed');
  if (menuFeed) menuFeed.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    wrap.classList.remove('show-menu');
    callbacks.feedRocky();
  });

  const menuHistory = doc.getElementById('menuHistory');
  if (menuHistory) menuHistory.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    wrap.classList.remove('show-menu');
    callbacks.pokeActivity();
    showHistoryModal({
      copyHistory: callbacks.getHistory(),
      openRockyModal: callbacks.openRockyModal,
      timeAgo: callbacks.timeAgo,
      copyToClipboard: callbacks.copyToClipboard,
      showToast: callbacks.showToast,
      persist: callbacks.persist,
      onClear: () => { callbacks.persist({ history: [] }, { immediate: true }); }
    });
  });

  const menuSettings = doc.getElementById('menuSettings');
  if (menuSettings) menuSettings.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    wrap.classList.remove('show-menu');
    if (callbacks.showSettings) callbacks.showSettings();
  });
}
