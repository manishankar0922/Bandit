(() => {
  // src/popup.js
  var api = globalThis.browser ?? globalThis.chrome;
  document.addEventListener("DOMContentLoaded", async () => {
    const toggleSite = document.getElementById("toggleSite");
    const resetAll = document.getElementById("resetAll");
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;
    const host = new URL(tab.url).hostname;
    api.storage.local.get(["rockyState"], (res) => {
      let state = res.rockyState || {};
      let disabled = state.disabledSites || [];
      toggleSite.checked = !disabled.includes(host);
      toggleSite.addEventListener("change", () => {
        const isEnabled = toggleSite.checked;
        if (isEnabled) {
          disabled = disabled.filter((h) => h !== host);
        } else {
          if (!disabled.includes(host)) disabled.push(host);
        }
        state.disabledSites = disabled;
        api.storage.local.set({ rockyState: state });
        api.tabs.sendMessage(tab.id, { type: "ROCKY_TOGGLE", disabled: !isEnabled }).catch(() => {
          if (isEnabled) {
            api.scripting.executeScript({
              target: { tabId: tab.id },
              files: ["content.bundle.js"]
            }).catch((err) => console.error("Could not inject content script:", err));
          }
        });
      });
      resetAll.addEventListener("click", () => {
        state.disabledSites = [];
        api.storage.local.set({ rockyState: state });
        resetAll.textContent = "Cleared!";
        setTimeout(() => {
          resetAll.textContent = "Reset all disabled sites";
        }, 2e3);
        toggleSite.checked = true;
        api.tabs.sendMessage(tab.id, { type: "ROCKY_TOGGLE", disabled: false }).catch(() => {
          api.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content.bundle.js"]
          }).catch((err) => console.error("Could not inject content script:", err));
        });
      });
    });
  });
})();
