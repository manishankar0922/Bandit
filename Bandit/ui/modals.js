(function(root) {
  function createDialog(onClose) {
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

    document.body.appendChild(dialog);
    return {
      modal: dialog,
      show: () => dialog.showModal(),
      close: () => dialog.close()
    };
  }

  root.BanditModals = { createDialog };
})(typeof window !== 'undefined' ? window : globalThis);
