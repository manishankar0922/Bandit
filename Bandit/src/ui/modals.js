// Dialog creation utility.
// container: where to append the <dialog>. Pass the Shadow Root so the dialog inherits styles.

export function createDialog(onClose, container) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.style.pointerEvents = 'auto';

  let openedAt = Date.now();
  let backdropMouseDown = false;

  dialog.addEventListener('mousedown', (e) => {
    if (e.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      const inDialog = (
        rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX && e.clientX <= rect.left + rect.width
      );
      if (!inDialog) {
        backdropMouseDown = true;
      }
    }
  });

  dialog.addEventListener('click', (e) => {
    // Only close if mousedown also started on backdrop and at least 250ms passed since creation
    if (e.target === dialog && backdropMouseDown && (Date.now() - openedAt > 250)) {
      const rect = dialog.getBoundingClientRect();
      const inDialog = (
        rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX && e.clientX <= rect.left + rect.width
      );
      if (!inDialog) {
        dialog.close();
      }
    }
    backdropMouseDown = false;
  });

  let closed = false;
  dialog.addEventListener('close', () => {
    if (closed) return;
    closed = true;
    dialog.remove();
    if (onClose) onClose();
  });

  const host = container || document.body;
  host.appendChild(dialog);
  dialog.showModal();
  return {
    modal: dialog,
    show: () => { if (!dialog.open) dialog.showModal(); },
    close: () => dialog.close()
  };
}
