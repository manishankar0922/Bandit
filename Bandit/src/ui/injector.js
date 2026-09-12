// Injects text into host page elements.
// Handles ChatGPT, Gemini, Claude, and generic sites.

function getDeepActiveElement() {
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) {
    el = el.shadowRoot.activeElement;
  }
  return el;
}

/**
 * Detect ChatGPT's input element.
 * ChatGPT uses a ProseMirror contenteditable div with id="prompt-textarea".
 */
function getChatGPTInput() {
  // Primary: ProseMirror contenteditable
  const pm = document.querySelector('#prompt-textarea[contenteditable="true"]');
  if (pm && pm.offsetParent !== null) return pm;
  // Fallback: textarea variant (older builds)
  const ta = document.querySelector('#prompt-textarea');
  if (ta && ta.offsetParent !== null) return ta;
  return null;
}

/**
 * Detect Gemini's input element.
 * Gemini uses a custom rich-textarea element containing a contenteditable .ql-editor div.
 */
function getGeminiInput() {
  // Primary: .ql-editor inside rich-textarea
  const ql = document.querySelector('rich-textarea .ql-editor[contenteditable="true"]');
  if (ql && ql.offsetParent !== null) return ql;
  // Fallback: rich-textarea's inner contenteditable
  const rt = document.querySelector('rich-textarea [contenteditable="true"]');
  if (rt && rt.offsetParent !== null) return rt;
  // Fallback: direct textarea inside the input area
  const ta = document.querySelector('.input-area textarea, .text-input-field textarea');
  if (ta && ta.offsetParent !== null) return ta;
  return null;
}

/**
 * Detect Claude's input element.
 * Claude uses a ProseMirror contenteditable div.
 */
function getClaudeInput() {
  const pm = document.querySelector('div.ProseMirror[contenteditable="true"]');
  if (pm && pm.offsetParent !== null) return pm;
  const anyCe = document.querySelector('fieldset [contenteditable="true"], main [contenteditable="true"]');
  if (anyCe && anyCe.offsetParent !== null) return anyCe;
  return null;
}

export function getHostInput() {
  const host = window.location.hostname;

  // Site-specific detection first — these override the generic logic
  if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) {
    const el = getChatGPTInput();
    if (el) return el;
  }
  if (host.includes('claude.ai')) {
    const el = getClaudeInput();
    if (el) return el;
  }
  if (host.includes('gemini.google.com')) {
    const el = getGeminiInput();
    if (el) return el;
  }

  // Generic: prefer the currently focused element
  const active = getDeepActiveElement();
  if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.isContentEditable)) {
    if (active.disabled || active.readOnly) return null;
    const r = active.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return active;
  }

  // Generic: find the largest visible text input on the page
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

/**
 * Dispatch a React-compatible InputEvent.
 * ChatGPT (and many React apps) listen for native InputEvents, not just 'input'.
 */
function dispatchReactInput(el) {
  // React 16+ uses a synthetic event system that listens on the native InputEvent
  try {
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText' }));
  } catch (err) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export function simulatePaste(el, text) {
  el.focus();

  if (el.isContentEditable) {
    // Clear existing content
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);

    // Use insertText for undo support, fall back to textContent
    let success = false;
    try {
      success = document.execCommand('insertText', false, text);
    } catch (_) {}

    if (!success) {
      // ProseMirror / Quill fallback: set innerHTML + dispatch input
      el.textContent = text;
    }
    dispatchReactInput(el);
  } else {
    el.select();
    let success = false;
    try {
      success = document.execCommand('insertText', false, text);
    } catch (_) {}

    if (!success) {
      const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      const nativeTextareaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (el.tagName === 'INPUT' && nativeInputSetter) nativeInputSetter.call(el, text);
      else if (el.tagName === 'TEXTAREA' && nativeTextareaSetter) nativeTextareaSetter.call(el, text);
      else el.value = text;
    }
    dispatchReactInput(el);
  }
}

export function setPromptText(hostInput, text) {
  hostInput.focus();
  simulatePaste(hostInput, text);
}
