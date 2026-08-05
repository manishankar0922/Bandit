// Dialog creation utility.
// container: where to append the <dialog>. Pass the Shadow Root so the dialog inherits styles.

export function createDialog(onClose, container) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.style.pointerEvents = 'auto';

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

  const host = container || document.body;
  host.appendChild(dialog);
  return {
    modal: dialog,
    show: () => dialog.showModal(),
    close: () => dialog.close()
  };
}
