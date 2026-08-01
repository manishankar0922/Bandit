BanditEnv.initHistory = function() {
  function timeAgo(t) {
    const s = Math.max(1, Math.round((Date.now() - t) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }

  menuHistory = doc.getElementById('menuHistory');
  if (menuHistory) {
    menuHistory.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      wrap.classList.remove('show-menu');
      pokeActivity();
      if (window.BanditPopup) {
        window.BanditPopup.showHistoryModal({
          copyHistory,
          openRockyModal,
          timeAgo,
          copyToClipboard,
          showToast,
          persist,
          onClear: () => { copyHistory = []; }
        });
      }
    });
  }
};
