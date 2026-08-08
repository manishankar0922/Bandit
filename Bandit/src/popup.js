const api = globalThis.browser ?? globalThis.chrome;

document.addEventListener('DOMContentLoaded', async () => {
  const toggleSite = document.getElementById('toggleSite');
  const resetAll = document.getElementById('resetAll');
  
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  const host = (tab && tab.url) ? new URL(tab.url).hostname : null;
  
  if (!host) {
    toggleSite.disabled = true;
    toggleSite.parentElement.style.opacity = '0.5';
  }

  api.storage.local.get(['rockyState'], (res) => {
    let state = res.rockyState || {};
    let disabled = state.disabledSites || [];
    toggleSite.checked = host ? !disabled.includes(host) : false;
    
    toggleSite.addEventListener('change', () => {
      if (!host) return;
      const isEnabled = toggleSite.checked;
      if (isEnabled) {
        disabled = disabled.filter(h => h !== host);
      } else {
        if (!disabled.includes(host)) disabled.push(host);
      }
      state.disabledSites = disabled;
      api.storage.local.set({ rockyState: state });
      
      // Tell content script to toggle
      if (tab && tab.id) {
        api.tabs.sendMessage(tab.id, { type: 'ROCKY_TOGGLE', disabled: !isEnabled }).catch(() => {
          if (isEnabled) {
            api.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['content.bundle.js']
            }).catch(err => console.error("Could not inject content script:", err));
          }
        });
      }
    });
    
    resetAll.addEventListener('click', () => {
      state.disabledSites = [];
      api.storage.local.set({ rockyState: state });
      resetAll.textContent = "Cleared!";
      setTimeout(() => { resetAll.textContent = "Reset all disabled sites"; }, 2000);
      if (host) toggleSite.checked = true;
      
      // Attempt to re-enable on current tab just in case
      if (tab && tab.id && host) {
        api.tabs.sendMessage(tab.id, { type: 'ROCKY_TOGGLE', disabled: false }).catch(() => {
          api.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.bundle.js']
          }).catch(err => console.error("Could not inject content script:", err));
        });
      }
    });
  });
});
