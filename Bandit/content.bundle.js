(() => {
  // content.js
  if (!window.rockyInjected) {
    window.rockyInjected = true;
    if (document.getElementById("rocky-root")) {
      console.log("Bandit is natively present on this page. Aborting extension injection to prevent duplicates.");
    } else {
      const oldHosts = document.querySelectorAll("#bandit-extension-host, #rocky-extension-host");
      oldHosts.forEach((h) => {
        h.dispatchEvent(new CustomEvent("bandit-cleanup"));
        h.remove();
      });
      const api = globalThis.browser ?? globalThis.chrome;
      const statePromise = ((typeof BanditEnv !== "undefined" ? BanditEnv.RockyStorage : window.RockyStorage) ? (typeof BanditEnv !== "undefined" ? BanditEnv.RockyStorage : window.RockyStorage).loadState() : Promise.resolve(null)).catch((err) => {
        console.warn("Bandit: state load failed, using defaults", err);
        return null;
      });
      statePromise.then((state) => {
        if (state && state.disabledSites && state.disabledSites.includes(window.location.hostname)) {
          return;
        }
        const host = document.createElement("div");
        host.id = "bandit-extension-host";
        host.style.position = "fixed";
        host.style.zIndex = "2147483647";
        host.style.pointerEvents = "none";
        host.style.top = "0";
        host.style.left = "0";
        host.style.width = "100vw";
        host.style.height = "100vh";
        (document.body || document.documentElement).appendChild(host);
        const shadow2 = host.attachShadow({ mode: "closed" });
        window.rockyShadowRoot = shadow2;
        const html = BanditEnv.BanditTemplate ? BanditEnv.BanditTemplate.html : "";
        const css = BanditEnv.BanditTemplate ? BanditEnv.BanditTemplate.css : "";
        const parser = new DOMParser();
        const parsedDoc = parser.parseFromString(html, "text/html");
        const fragment = document.createDocumentFragment();
        while (parsedDoc.body.firstChild) {
          fragment.appendChild(parsedDoc.body.firstChild);
        }
        const rockyRoot = fragment.querySelector("#rocky-root");
        const settingsModal = fragment.querySelector("#settingsModal");
        const toast = fragment.querySelector("#toast");
        if (rockyRoot) rockyRoot.style.visibility = "hidden";
        if (rockyRoot) shadow2.appendChild(rockyRoot);
        if (settingsModal) shadow2.appendChild(settingsModal);
        if (toast) shadow2.appendChild(toast);
        if (rockyRoot) {
          rockyRoot.style.pointerEvents = "none";
          const petWrap = rockyRoot.querySelector("#petWrap");
          if (petWrap) petWrap.style.pointerEvents = "none";
          const pet = rockyRoot.querySelector("#pet");
          if (pet) pet.style.pointerEvents = "auto";
          const petMenu = rockyRoot.querySelector("#petMenu");
          if (petMenu) petMenu.style.pointerEvents = "auto";
        }
        const style = document.createElement("style");
        style.textContent = css;
        shadow2.appendChild(style);
        if (typeof BanditEnv.initRocky === "function") {
          BanditEnv.initRocky(state);
        } else {
          throw new Error("pet/core.js did not define initRocky (it may have failed to load)");
        }
      }).catch((err) => {
        console.error("Bandit load error:", err);
        try {
          const banner = document.createElement("div");
          banner.textContent = "Bandit failed to load: " + (err && err.message || String(err));
          banner.style.cssText = "position:fixed;bottom:8px;right:8px;z-index:2147483647;background:#c0392b;color:#fff;font:12px monospace;padding:8px 12px;border-radius:8px;max-width:320px;box-shadow:0 4px 12px rgba(0,0,0,.4);pointer-events:auto;";
          shadow.appendChild(banner);
          setTimeout(() => banner.remove(), 2e4);
        } catch (bannerErr) {
        }
      });
    }
  }
})();
