BanditEnv.initSettings = function() {
  settingsModal = doc.getElementById('settingsModal');
  settingName = doc.getElementById('settingName');
  settingSize = doc.getElementById('settingSize');
  sizeValue = doc.getElementById('sizeValue');
  settingProvider = doc.getElementById('settingProvider');
  settingApiKey = doc.getElementById('settingApiKey');
  settingModel = doc.getElementById('settingModel');
  settingStyle = doc.getElementById('settingStyle');
  settingTone = doc.getElementById('settingTone');
  settingAskPlaceholders = doc.getElementById('settingAskPlaceholders');
  testApiKeyBtn = doc.getElementById('testApiKey');
  testApiKeyStatus = doc.getElementById('testApiKeyStatus');
  exportBtn = doc.getElementById('exportSettings');
  importBtn = doc.getElementById('importSettings');
  backupStatus = doc.getElementById('backupStatus');

  getApiKeyLink = doc.getElementById('getApiKeyLink');

  API_LINKS = {
    anthropic: 'https://console.anthropic.com/settings/keys',
    openai: 'https://platform.openai.com/api-keys',
    gemini: 'https://aistudio.google.com/app/apikey',
    groq: 'https://console.groq.com/keys',
    nvidia: 'https://build.nvidia.com/explore/discover'
  };

  function updateApiKeyLink(provider) {
    if (!getApiKeyLink) return;
    if (provider === 'builtin') {
      getApiKeyLink.style.display = 'none';
    } else {
      getApiKeyLink.style.display = 'inline';
      getApiKeyLink.href = API_LINKS[provider] || '#';
    }
  }

  menuSettings = doc.getElementById('menuSettings');
  if (menuSettings) menuSettings.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    wrap.classList.remove('show-menu');
    if (settingProvider) {
      settingProvider.value = aiSettings.provider || 'builtin';
      updateApiKeyLink(settingProvider.value);
    }
    // Hydrate the key field from the per-provider map first, falling back to legacy flat field
    if (settingApiKey) settingApiKey.value = (aiSettings.apiKeys && aiSettings.apiKeys[aiSettings.provider]) || aiSettings.apiKey || '';
    if (settingModel) settingModel.value = aiSettings.model || '';
    if (settingStyle) settingStyle.value = enhanceStyle;
    if (settingTone) settingTone.value = enhanceTone;
    if (settingAskPlaceholders) settingAskPlaceholders.checked = askPlaceholders;
    if (testApiKeyStatus) { testApiKeyStatus.textContent = ''; testApiKeyStatus.className = 'test-key-status'; }
    if (settingsModal) settingsModal.classList.add('show');
  });

  if (settingApiKey) settingApiKey.addEventListener('input', () => {
    const detected = BanditEnv.detectProviderFromKey(settingApiKey.value);
    if (detected && settingProvider) settingProvider.value = detected;
  });

  // Switching provider swaps the key field to that provider's saved key,
  // so users can stash one key per provider (fuels the failover chain).
  currentSettingsProvider = aiSettings.provider || 'builtin';
  if (settingProvider) {
    currentSettingsProvider = settingProvider.value;
    settingProvider.addEventListener('change', () => {
      updateApiKeyLink(settingProvider.value);
      // load the specific key if present
      if (settingApiKey) settingApiKey.value = aiSettings.apiKeys[settingProvider.value] || '';
      // Save the typed key to the OLD provider before swapping to the new one
      if (currentSettingsProvider !== 'builtin') {
        aiSettings.apiKeys[currentSettingsProvider] = settingApiKey ? settingApiKey.value.trim() : '';
      }
      currentSettingsProvider = settingProvider.value;
      if (settingApiKey) settingApiKey.value = aiSettings.apiKeys[currentSettingsProvider] || '';
    });
  }

  resetDisabledSites = doc.getElementById('resetDisabledSites');
  resetDisabledStatus = doc.getElementById('resetDisabledStatus');
  if (resetDisabledSites) {
    resetDisabledSites.addEventListener('click', () => {
      persist({ disabledSites: [] }, { immediate: true });
      if (resetDisabledStatus) {
        resetDisabledStatus.textContent = 'Cleared!';
        setTimeout(() => { resetDisabledStatus.textContent = ''; }, 2000);
      }
    });
  }

  function saveSettings() {
    petName = (settingName ? settingName.value.trim() : petName) || 'Bandit';
    updateXPDisplay();

    const chosenProvider = settingProvider ? (settingProvider.value || 'builtin') : aiSettings.provider;
    const enteredKey = settingApiKey ? settingApiKey.value.trim() : aiSettings.apiKey;
    const newApiKeys = { ...aiSettings.apiKeys };
    if (chosenProvider !== 'builtin') newApiKeys[chosenProvider] = enteredKey; // '' clears that slot
    aiSettings = {
      provider: chosenProvider,
      apiKey: enteredKey,
      model: settingModel ? settingModel.value.trim() : aiSettings.model,
      apiKeys: newApiKeys,
    };
    if (settingStyle) enhanceStyle = settingStyle.value || 'structured';
    if (settingTone) enhanceTone = settingTone.value || 'professional';
    if (settingAskPlaceholders) askPlaceholders = settingAskPlaceholders.checked;
    persist({ petName, provider: aiSettings.provider, apiKey: aiSettings.apiKey, model: aiSettings.model, apiKeys: newApiKeys, enhanceStyle, enhanceTone, askPlaceholders });
  }

  if (settingName) settingName.addEventListener('input', saveSettings);
  if (settingApiKey) settingApiKey.addEventListener('input', saveSettings);
  if (settingProvider) settingProvider.addEventListener('change', saveSettings);
  if (settingModel) settingModel.addEventListener('input', saveSettings);
  if (settingStyle) settingStyle.addEventListener('change', saveSettings);
  if (settingTone) settingTone.addEventListener('change', saveSettings);
  if (settingAskPlaceholders) settingAskPlaceholders.addEventListener('change', saveSettings);

  closeSettings = doc.getElementById('closeSettings');
  if (closeSettings) closeSettings.addEventListener('click', () => {
    if (settingsModal) settingsModal.classList.remove('show');
    saveSettings();
  });

  // --- EXPORT / IMPORT BACKUP ---
  if (exportBtn) exportBtn.addEventListener('click', () => {
    try {
      const state = {
        petName, xp, level, enhanceStyle, enhanceTone, askPlaceholders,
        provider: aiSettings.provider, apiKeys: aiSettings.apiKeys,
        model: aiSettings.model, history: copyHistory,
        _banditBackup: true, _exportedAt: new Date().toISOString(),
      };
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bandit-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      if (backupStatus) { backupStatus.textContent = 'Backup exported! ✅'; setTimeout(() => { backupStatus.textContent = ''; }, 3000); }
    } catch (err) {
      if (backupStatus) { backupStatus.textContent = 'Export failed ❌'; backupStatus.style.color = '#f44'; setTimeout(() => { backupStatus.textContent = ''; backupStatus.style.color = ''; }, 3000); }
    }
  });

  if (importBtn) importBtn.addEventListener('click', () => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!data._banditBackup) throw new Error('Not a Bandit backup file');
          // Restore state
          if (data.petName) { petName = data.petName; if (settingName) settingName.value = petName; }
          if (typeof data.xp === 'number') { xp = data.xp; }
          if (typeof data.level === 'number') { level = data.level; }
          if (data.enhanceStyle) { enhanceStyle = data.enhanceStyle; if (settingStyle) settingStyle.value = enhanceStyle; }
          if (data.enhanceTone) { enhanceTone = data.enhanceTone; if (settingTone) settingTone.value = enhanceTone; }
          if (typeof data.askPlaceholders === 'boolean') { askPlaceholders = data.askPlaceholders; if (settingAskPlaceholders) settingAskPlaceholders.checked = askPlaceholders; }
          if (data.provider) { aiSettings.provider = data.provider; if (settingProvider) settingProvider.value = data.provider; }
          if (data.apiKeys && typeof data.apiKeys === 'object') { aiSettings.apiKeys = data.apiKeys; if (settingApiKey) settingApiKey.value = data.apiKeys[data.provider] || ''; }
          if (data.model) { aiSettings.model = data.model; if (settingModel) settingModel.value = data.model; }
          if (Array.isArray(data.history)) { copyHistory = data.history; }
          updateXPDisplay();
          persist({ petName, xp, level, enhanceStyle, enhanceTone, askPlaceholders, provider: aiSettings.provider, apiKey: aiSettings.apiKey, model: aiSettings.model, apiKeys: aiSettings.apiKeys, history: copyHistory }, { immediate: true });
          if (backupStatus) { backupStatus.textContent = 'Backup restored! 🎉'; setTimeout(() => { backupStatus.textContent = ''; }, 3000); }
        } catch (err) {
          if (backupStatus) { backupStatus.textContent = 'Invalid backup file ❌'; backupStatus.style.color = '#f44'; setTimeout(() => { backupStatus.textContent = ''; backupStatus.style.color = ''; }, 3000); }
        }
      };
      reader.readAsText(file);
    });
    fileInput.click();
  });

  if (settingSize) settingSize.addEventListener('input', e => {
    const s = e.target.value;
    if (sizeValue) sizeValue.textContent = Math.round(s * 100) + '%';
    wrap.style.setProperty('--pet-scale', s);
    persist({ settings: { size: parseFloat(s) } });
  });

  if (testApiKeyBtn) testApiKeyBtn.addEventListener('click', () => {
    const provider = settingProvider ? settingProvider.value : 'builtin';
    if (provider === 'builtin') {
      if (testApiKeyStatus) { testApiKeyStatus.textContent = 'built-in AI needs no key ✓'; testApiKeyStatus.className = 'test-key-status ok'; }
      return;
    }
    const testSettings = {
      provider,
      apiKey: settingApiKey ? settingApiKey.value.trim() : '',
      model: settingModel ? settingModel.value.trim() : '',
    };
    if (!testSettings.apiKey) {
      if (testApiKeyStatus) { testApiKeyStatus.textContent = 'paste a key first'; testApiKeyStatus.className = 'test-key-status fail'; }
      return;
    }
    if (testApiKeyStatus) { testApiKeyStatus.textContent = 'testing…'; testApiKeyStatus.className = 'test-key-status'; }
    testApiKeyBtn.disabled = true;

    testAIKey(testSettings)
      .then(res => {
        if (testApiKeyStatus) { testApiKeyStatus.textContent = `✓ ${res.provider} key works`; testApiKeyStatus.className = 'test-key-status ok'; }
      })
      .catch(err => {
        if (testApiKeyStatus) { testApiKeyStatus.textContent = `✗ ${friendlyError(err)}`; testApiKeyStatus.className = 'test-key-status fail'; }
      })
      .finally(() => {
        testApiKeyBtn.disabled = false;
      });
  });
};
