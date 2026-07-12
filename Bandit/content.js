// Avoid multiple injections
if (!window.rockyInjected) {
  window.rockyInjected = true;
  
  // Prevent injecting the extension over the native test page
  if (document.getElementById('rocky-root')) {
    console.log("Rocky is natively present on this page. Aborting extension injection to prevent duplicates.");
  } else {
  
  // Destroy any old clones left behind if the extension was reloaded without refreshing the page
  const oldHosts = document.querySelectorAll('#rocky-extension-host');
  oldHosts.forEach(h => h.remove());

  // Firefox uses browser.*, Chrome uses chrome.* — fall back between them.
  const api = globalThis.browser ?? globalThis.chrome;

  // 1. Create the host element for the Shadow DOM
  const host = document.createElement('div');
  host.id = 'rocky-extension-host';
  // High z-index so it floats above everything
  host.style.position = 'fixed';
  host.style.zIndex = '2147483647'; 
  host.style.pointerEvents = 'none'; // let clicks pass through the host container itself
  host.style.top = '0';
  host.style.left = '0';
  host.style.width = '100vw';
  host.style.height = '100vh';
  document.body.appendChild(host);

  // 2. Attach Shadow DOM
  const shadow = host.attachShadow({ mode: 'open' });
  
  // Make the shadow root globally accessible for our script.js
  window.rockyShadowRoot = shadow;

  // 3. Fetch index.html with cache busting, and load saved state in parallel.
  //    Rocky stays hidden until both resolve, so he never flashes as level 1
  //    before hydrating to his real saved level.
  const htmlPromise = fetch(api.runtime.getURL('index.html') + '?t=' + Date.now())
    .then(response => response.text());

  const statePromise = (window.RockyStorage ? window.RockyStorage.loadState() : Promise.resolve(null))
    .catch(err => { console.warn('Rocky: state load failed, using defaults', err); return null; });

  Promise.all([htmlPromise, statePromise])
    .then(([html, state]) => {
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

      // 5. Inject CSS with cache busting
      const style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = api.runtime.getURL('styles.css') + '?t=' + Date.now();
      shadow.appendChild(style);

      // 6. Initialize Rocky logic (reveals itself once hydrated)
      if (typeof initRocky === 'function') {
        initRocky(state);
      }
    })
    .catch(err => console.error("Rocky load error:", err));
  }
}
