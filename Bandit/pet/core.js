// pet/core.js - Bootloader
BanditEnv.initRocky = function(savedState) {
    if (BanditEnv.initBanditState) BanditEnv.initBanditState(savedState);
    if (BanditEnv.initBanditAnimations) BanditEnv.initBanditAnimations(savedState);
    if (BanditEnv.initBanditDrag) BanditEnv.initBanditDrag(savedState);
    if (BanditEnv.initBanditUI) BanditEnv.initBanditUI(savedState);
    if (BanditEnv.initHistory) BanditEnv.initHistory();
    if (BanditEnv.initSettings) BanditEnv.initSettings();
};

if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
  window.addEventListener('DOMContentLoaded', () => {
    const demoRoot = document.getElementById('rocky-root');
    if (demoRoot) demoRoot.style.visibility = 'hidden';
    const loadPromise = (typeof BanditEnv !== "undefined" ? BanditEnv.RockyStorage : window.RockyStorage) ? (typeof BanditEnv !== "undefined" ? BanditEnv.RockyStorage : window.RockyStorage).loadState() : Promise.resolve(null);
    loadPromise
      .catch(err => { console.warn('Bandit: state load failed, using defaults', err); return null; })
      .then(state => {
        const hostname = window.location.hostname;
        if (state && state.disabledSites && hostname && state.disabledSites.includes(hostname)) {
          if (demoRoot) demoRoot.remove();
          return;
        }
        BanditEnv.initRocky(state);
      });
  });
}
