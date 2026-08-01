(function(root) {
  // container: where to append the <dialog>. Pass the Shadow Root so the dialog
  // inherits the extension's CSS (injected into the shadow). Falls back to
  // document.body in demo / standalone mode where there is no shadow root.
  function createDialog(onClose, container) {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal';

    // In modern browsers, clicking the backdrop of a <dialog> fires the click event
    // on the dialog itself. If the click coordinates are outside the dialog's rect,
    // we consider it a backdrop click and close it.
    dialog.addEventListener('click', (e) => {
      const rect = dialog.getBoundingClientRect();
      const inDialog = (
        rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX && e.clientX <= rect.left + rect.width
      );
      if (!inDialog) {
        dialog.close();
      }
    });

    let closed = false;
    dialog.addEventListener('close', () => {
      if (closed) return;
      closed = true;
      dialog.remove();
      if (onClose) onClose();
    });

    // Append inside the shadow root so the dialog inherits the extension's
    // injected CSS. Fall back to document.body for the standalone demo page.
    const host = container || document.body;
    host.appendChild(dialog);
    return {
      modal: dialog,
      show: () => dialog.showModal(),
      close: () => dialog.close()
    };
  }

  root.BanditModals = { createDialog };
})(typeof BanditEnv !== 'undefined' ? BanditEnv : (typeof window !== 'undefined' ? window : globalThis));
