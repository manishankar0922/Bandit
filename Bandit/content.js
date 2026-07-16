// Avoid multiple injections
if (!window.rockyInjected) {
  window.rockyInjected = true;
  
  // Prevent injecting the extension over the native test page
  if (document.getElementById('rocky-root')) {
    console.log("Bandit is natively present on this page. Aborting extension injection to prevent duplicates.");
  } else {
  
  // Destroy any old clones left behind if the extension was reloaded without refreshing the page
  const oldHosts = document.querySelectorAll('#bandit-extension-host, #rocky-extension-host');
  oldHosts.forEach(h => {
    h.dispatchEvent(new CustomEvent('bandit-cleanup'));
    h.remove();
  });

  // Firefox uses browser.*, Chrome uses chrome.* — fall back between them.
  const api = globalThis.browser ?? globalThis.chrome;

  // 1. Create the host element for the Shadow DOM
  const host = document.createElement('div');
  host.id = 'bandit-extension-host';
  // High z-index so it floats above everything
  host.style.position = 'fixed';
  host.style.zIndex = '2147483647'; 
  host.style.pointerEvents = 'none'; // let clicks pass through the host container itself
  host.style.top = '0';
  host.style.left = '0';
  host.style.width = '100vw';
  host.style.height = '100vh';
  (document.body || document.documentElement).appendChild(host);

  // 2. Attach Shadow DOM — CLOSED so host-page scripts can't reach inside
  // (with 'open', any page script could read host.shadowRoot and lift the
  // API key straight out of the settings modal's input field).
  const shadow = host.attachShadow({ mode: 'closed' });

  // Content scripts run in an isolated world: this window property is visible
  // to script.js (same world) but NOT to the host page's own JavaScript.
  window.rockyShadowRoot = shadow;

  // 3. Fetch index.html with cache busting, and load saved state in parallel.
  //    Rocky stays hidden until both resolve, so he never flashes as level 1
  //    before hydrating to his real saved level.
  const htmlPromise = fetch(api.runtime.getURL('index.html')).then(response => response.text());
  const cssPromise = fetch(api.runtime.getURL('styles.css')).then(response => response.text());

  const statePromise = (window.RockyStorage ? window.RockyStorage.loadState() : Promise.resolve(null))
    .catch(err => { console.warn('Bandit: state load failed, using defaults', err); return null; });

  Promise.all([htmlPromise, cssPromise, statePromise])
    .then(([html, css, state]) => {
      // We only want the content inside the <body> tag, without the <script> tags.
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      let bodyContent = bodyMatch ? bodyMatch[1] : html;

      // Strip out the script tags from HTML to prevent duplicate execution
      bodyContent = bodyContent.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

      // Parse the HTML string into a DOM element
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = bodyContent;

      // Extract ONLY the pet and its settings
      const rockyRoot = tempDiv.querySelector('#rocky-root');
      const settingsModal = tempDiv.querySelector('#settingsModal');
      const toast = tempDiv.querySelector('#toast');

      // Stay invisible until initRocky finishes hydrating from saved state.
      if (rockyRoot) rockyRoot.style.visibility = 'hidden';

      if (rockyRoot) shadow.appendChild(rockyRoot);
      if (settingsModal) shadow.appendChild(settingsModal);
      if (toast) shadow.appendChild(toast);

      // Allow pointer events ONLY on the specific interactive elements to prevent blocking the host page
      if (rockyRoot) {
        rockyRoot.style.pointerEvents = 'none';
        const petWrap = rockyRoot.querySelector('#petWrap');
        if (petWrap) petWrap.style.pointerEvents = 'none';

        const pet = rockyRoot.querySelector('#pet');
        if (pet) pet.style.pointerEvents = 'auto';

        const petMenu = rockyRoot.querySelector('#petMenu');
        if (petMenu) petMenu.style.pointerEvents = 'auto';
      }
      // (Removed settingsModal pointerEvents auto, as CSS handles it via .show)

      // 5. Inject CSS as a <style> tag to bypass strict CSP style-src rules
      // that block <link> tags on some host pages.
      const style = document.createElement('style');
      style.textContent = css;
      shadow.appendChild(style);

      // 6. Initialize Rocky logic (reveals itself once hydrated)
      if (typeof initRocky === 'function') {
        initRocky(state);
      } else {
        throw new Error('script.js did not define initRocky (it may have failed to load)');
      }
    })
    .catch(err => {
      console.error("Bandit load error:", err);
      // Visible fallback so a failure is obvious without opening devtools.
      // The banner lives inside the shadow DOM, not on document.body,
      // so host-page scripts can't detect or read it.
      try {
        const banner = document.createElement('div');
        banner.textContent = 'Bandit failed to load: ' + ((err && err.message) || String(err));
        banner.style.cssText = 'position:fixed;bottom:8px;right:8px;z-index:2147483647;background:#c0392b;color:#fff;font:12px monospace;padding:8px 12px;border-radius:8px;max-width:320px;box-shadow:0 4px 12px rgba(0,0,0,.4);pointer-events:auto;';
        shadow.appendChild(banner);
        setTimeout(() => banner.remove(), 20000);
      } catch (bannerErr) { /* nothing more we can do */ }
    });
  }
}
