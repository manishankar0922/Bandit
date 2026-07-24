(function(root) {
  root.BanditPopup = {
    showHistoryModal: function({
      copyHistory, openRockyModal, timeAgo, copyToClipboard, showToast, persist, onClear
    }) {
      const { modal, close } = openRockyModal();

      const h = document.createElement('h3');
      h.textContent = '📜 History';
      modal.appendChild(h);

      if (!copyHistory.length) {
        const empty = document.createElement('div');
        empty.style.cssText = 'font-size:12px;color:#8a95a5;line-height:1.6';
        empty.textContent = 'Nothing here yet — enhance a prompt or summarize a chat, and it lands here for re-copying.';
        modal.appendChild(empty);
      } else {
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'secondary';
        clearBtn.style.cssText = 'font-size:11px;opacity:.7;margin-top:4px';
        clearBtn.textContent = '🗑 Clear history';
        clearBtn.addEventListener('click', () => {
          if (onClear) onClear();
          persist({ history: [] });
          close();
          showToast('history cleared');
        });
        modal.appendChild(clearBtn);
      }

      copyHistory.forEach(item => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'secondary';
        row.style.cssText = 'text-align:left;white-space:normal;line-height:1.5;display:block;width:100%';
        const icon = item.type === 'summary' ? '📋' : '✨';
        const preview = item.text.length > 90 ? item.text.slice(0, 90) + '…' : item.text;
        const meta = document.createElement('div');
        meta.style.cssText = 'font-size:10px;opacity:.6;margin-bottom:3px';
        meta.textContent = `${icon} ${item.type} · ${timeAgo(item.at)} · click to copy`;
        const body = document.createElement('div');
        body.textContent = preview;
        row.appendChild(meta);
        row.appendChild(body);
        row.addEventListener('click', () => {
          copyToClipboard(item.text)
            .then(() => { showToast('copied 📋'); close(); })
            .catch(() => { showToast("couldn't copy 😖"); });
        });
        modal.appendChild(row);
      });

      const done = document.createElement('button');
      done.type = 'button';
      done.textContent = 'Close';
      done.addEventListener('click', close);
      modal.appendChild(done);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
