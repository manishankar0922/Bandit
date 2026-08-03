(function(root) {
  function getDeepActiveElement() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) {
      el = el.shadowRoot.activeElement;
    }
    return el;
  }

  function getHostInput() {
    const active = getDeepActiveElement();
    if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.isContentEditable)) {
      if (active.disabled || active.readOnly) return null;
      const r = active.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return active;
    }

    const candidates = document.querySelectorAll(
      'textarea, input[type="text"], input:not([type]), div[contenteditable="true"], [contenteditable="plaintext-only"]'
    );
    let best = null, bestArea = 0;
    for (const el of candidates) {
      if (el.disabled || el.readOnly) continue;
      if (el.offsetParent === null) continue;
      const r = el.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) { bestArea = area; best = el; }
    }
    return best;
  }

  function simulatePaste(el, text) {
    el.focus();

    // The most robust way to replace text in modern web apps (React, ProseMirror, etc)
    // is using execCommand, as it natively triggers all internal framework events.
    if (el.isContentEditable) {
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
    } else {
      el.select();
      const success = document.execCommand('insertText', false, text);
      
      // Fallback for extremely stubborn inputs if execCommand fails
      if (!success) {
        const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        const nativeTextareaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (el.tagName === 'INPUT' && nativeInputSetter) nativeInputSetter.call(el, text);
        else if (el.tagName === 'TEXTAREA' && nativeTextareaSetter) nativeTextareaSetter.call(el, text);
        else el.value = text;

        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }

  function setPromptText(hostInput, text) {
    hostInput.focus();
    simulatePaste(hostInput, text);
  }

  root.BanditInjector = { getHostInput, setPromptText };
})((typeof window !== 'undefined' ? window : globalThis));
