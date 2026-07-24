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
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    const pasteEvent = new ClipboardEvent('paste', {
      clipboardData: dt,
      bubbles: true,
      cancelable: true
    });
    
    // First clear contents before paste
    if (el.isContentEditable) {
       const selection = window.getSelection();
       if (selection) selection.selectAllChildren(el);
       try { document.execCommand('delete', false, null); } catch(e){}
    } else {
       el.value = '';
    }

    el.dispatchEvent(pasteEvent);
    
    // Fallback if the framework ignores the paste event:
    if (!pasteEvent.defaultPrevented || el.textContent.trim() === '' && el.value === '') {
      if (el.isContentEditable) {
        try {
          if (!document.execCommand('insertText', false, text)) throw new Error();
        } catch (e) {
          el.textContent = text;
        }
      } else {
        const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        const nativeTextareaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (el.tagName === 'INPUT' && nativeInputSetter) nativeInputSetter.call(el, text);
        else if (el.tagName === 'TEXTAREA' && nativeTextareaSetter) nativeTextareaSetter.call(el, text);
        else el.value = text;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));
    }
  }

  function setPromptText(hostInput, text) {
    hostInput.focus();
    simulatePaste(hostInput, text);
  }

  root.BanditInjector = { getHostInput, setPromptText };
})(typeof window !== 'undefined' ? window : globalThis);
