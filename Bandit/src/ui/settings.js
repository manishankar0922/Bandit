import { detectProviderFromKey } from '../ai/utils.js';

export function initSettings(doc, stateObj, callbacks) {
  const settingsModal = doc.getElementById('settingsModal');
  const settingName = doc.getElementById('settingName');
  const settingSize = doc.getElementById('settingSize');
  const sizeValue = doc.getElementById('sizeValue');
  const settingProvider = doc.getElementById('settingProvider');
  const settingApiKey = doc.getElementById('settingApiKey');
  const settingModel = doc.getElementById('settingModel');
  const settingCustomModel = doc.getElementById('settingCustomModel');
  const settingCustomInstructions = doc.getElementById('settingCustomInstructions');
  const settingStyle = doc.getElementById('settingStyle');
  const settingTone = doc.getElementById('settingTone');
  const settingAskPlaceholders = doc.getElementById('settingAskPlaceholders');
  const testApiKeyBtn = doc.getElementById('testApiKey');
  const testApiKeyStatus = doc.getElementById('testApiKeyStatus');
  const exportBtn = doc.getElementById('exportSettings');
  const importBtn = doc.getElementById('importSettings');
  const backupStatus = doc.getElementById('backupStatus');
  const getApiKeyLink = doc.getElementById('getApiKeyLink');

  const API_LINKS = {
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

  // Load initial view
  if (settingProvider) {
    settingProvider.value = stateObj.aiSettings.provider || 'builtin';
    updateApiKeyLink(settingProvider.value);
  }
  if (settingApiKey) settingApiKey.value = (stateObj.aiSettings.apiKeys && stateObj.aiSettings.apiKeys[stateObj.aiSettings.provider]) || stateObj.aiSettings.apiKey || '';
  if (settingModel) settingModel.value = stateObj.aiSettings.model || '';
  if (settingCustomModel) settingCustomModel.value = stateObj.aiSettings.customModel || '';
  if (settingCustomInstructions) settingCustomInstructions.value = stateObj.aiSettings.customInstructions || '';
  if (settingStyle) settingStyle.value = stateObj.enhanceStyle;
  if (settingTone) settingTone.value = stateObj.enhanceTone;
  if (settingAskPlaceholders) settingAskPlaceholders.checked = stateObj.askPlaceholders;
  if (settingName) settingName.value = stateObj.petName;
  if (settingSize) settingSize.value = stateObj.settingsSize || 1;
  if (sizeValue) sizeValue.textContent = Math.round((stateObj.settingsSize || 1) * 100) + '%';


  let currentSettingsProvider = stateObj.aiSettings.provider || 'builtin';

  if (settingApiKey) settingApiKey.addEventListener('input', () => {
    const detected = detectProviderFromKey(settingApiKey.value);
    if (detected && settingProvider) settingProvider.value = detected;
  });

  if (settingProvider) {
    settingProvider.addEventListener('change', () => {
      updateApiKeyLink(settingProvider.value);
      if (settingApiKey) settingApiKey.value = stateObj.aiSettings.apiKeys[settingProvider.value] || '';
      if (currentSettingsProvider !== 'builtin') {
        stateObj.aiSettings.apiKeys[currentSettingsProvider] = settingApiKey ? settingApiKey.value.trim() : '';
      }
      currentSettingsProvider = settingProvider.value;
      if (settingApiKey) settingApiKey.value = stateObj.aiSettings.apiKeys[currentSettingsProvider] || '';
    });
  }

  const resetDisabledSites = doc.getElementById('resetDisabledSites');
  const resetDisabledStatus = doc.getElementById('resetDisabledStatus');
  if (resetDisabledSites) {
    resetDisabledSites.addEventListener('click', () => {
      callbacks.persist({ disabledSites: [] }, { immediate: true });
      if (resetDisabledStatus) {
        resetDisabledStatus.textContent = 'Cleared!';
        setTimeout(() => { resetDisabledStatus.textContent = ''; }, 2000);
      }
    });
  }

  function saveSettings() {
    stateObj.petName = (settingName ? settingName.value.trim() : stateObj.petName) || 'Bandit';
    callbacks.updateXPDisplay();

    const chosenProvider = settingProvider ? (settingProvider.value || 'builtin') : stateObj.aiSettings.provider;
    const enteredKey = settingApiKey ? settingApiKey.value.trim() : stateObj.aiSettings.apiKey;
    const newApiKeys = { ...stateObj.aiSettings.apiKeys };
    if (chosenProvider !== 'builtin') newApiKeys[chosenProvider] = enteredKey;
    
    stateObj.aiSettings = {
      provider: chosenProvider,
      apiKey: enteredKey,
      model: settingModel ? settingModel.value.trim() : stateObj.aiSettings.model,
      customModel: settingCustomModel ? settingCustomModel.value.trim() : stateObj.aiSettings.customModel,
      customInstructions: settingCustomInstructions ? settingCustomInstructions.value.trim() : stateObj.aiSettings.customInstructions,
      apiKeys: newApiKeys,
    };
    if (settingStyle) stateObj.enhanceStyle = settingStyle.value || 'structured';
    if (settingTone) stateObj.enhanceTone = settingTone.value || 'professional';
    if (settingAskPlaceholders) stateObj.askPlaceholders = settingAskPlaceholders.checked;
    
    callbacks.persist({ 
      petName: stateObj.petName, 
      provider: stateObj.aiSettings.provider, 
      apiKey: stateObj.aiSettings.apiKey, 
      model: stateObj.aiSettings.model, 
      customModel: stateObj.aiSettings.customModel,
      customInstructions: stateObj.aiSettings.customInstructions,
      apiKeys: newApiKeys, 
      enhanceStyle: stateObj.enhanceStyle, 
      enhanceTone: stateObj.enhanceTone, 
      askPlaceholders: stateObj.askPlaceholders 
    });
  }

  if (settingName) settingName.addEventListener('input', saveSettings);
  if (settingApiKey) settingApiKey.addEventListener('input', saveSettings);
  if (settingProvider) settingProvider.addEventListener('change', saveSettings);
  if (settingModel) settingModel.addEventListener('input', saveSettings);
  if (settingCustomModel) settingCustomModel.addEventListener('input', saveSettings);
  if (settingCustomInstructions) settingCustomInstructions.addEventListener('input', saveSettings);
  if (settingStyle) settingStyle.addEventListener('change', saveSettings);
  if (settingTone) settingTone.addEventListener('change', saveSettings);
  if (settingAskPlaceholders) settingAskPlaceholders.addEventListener('change', saveSettings);

  const closeSettings = doc.getElementById('closeSettings');
  if (closeSettings) closeSettings.addEventListener('click', () => {
    if (settingsModal) settingsModal.classList.remove('show');
    saveSettings();
  });

  if (exportBtn) exportBtn.addEventListener('click', () => {
    try {
      const stateToExport = {
        petName: stateObj.petName, xp: stateObj.xp, level: stateObj.level, 
        enhanceStyle: stateObj.enhanceStyle, enhanceTone: stateObj.enhanceTone, 
        askPlaceholders: stateObj.askPlaceholders,
        provider: stateObj.aiSettings.provider, apiKeys: stateObj.aiSettings.apiKeys,
        model: stateObj.aiSettings.model, history: stateObj.copyHistory,
        _banditBackup: true, _exportedAt: new Date().toISOString(),
      };
      const blob = new Blob([JSON.stringify(stateToExport, null, 2)], { type: 'application/json' });
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
          
          if (data.petName) { stateObj.petName = data.petName; if (settingName) settingName.value = stateObj.petName; }
          if (typeof data.xp === 'number') { stateObj.xp = data.xp; }
          if (typeof data.level === 'number') { stateObj.level = data.level; }
          if (data.enhanceStyle) { stateObj.enhanceStyle = data.enhanceStyle; if (settingStyle) settingStyle.value = stateObj.enhanceStyle; }
          if (data.enhanceTone) { stateObj.enhanceTone = data.enhanceTone; if (settingTone) settingTone.value = stateObj.enhanceTone; }
          if (typeof data.askPlaceholders === 'boolean') { stateObj.askPlaceholders = data.askPlaceholders; if (settingAskPlaceholders) settingAskPlaceholders.checked = stateObj.askPlaceholders; }
          if (data.provider) { stateObj.aiSettings.provider = data.provider; if (settingProvider) settingProvider.value = data.provider; }
          if (data.apiKeys && typeof data.apiKeys === 'object') { stateObj.aiSettings.apiKeys = data.apiKeys; if (settingApiKey) settingApiKey.value = data.apiKeys[data.provider] || ''; }
          if (data.model) { stateObj.aiSettings.model = data.model; if (settingModel) settingModel.value = data.model; }
          if (Array.isArray(data.history)) { stateObj.copyHistory = data.history; }
          
          callbacks.updateXPDisplay();
          callbacks.applyAccessories(stateObj.level);
          
          callbacks.persist({ 
            petName: stateObj.petName, xp: stateObj.xp, level: stateObj.level, 
            enhanceStyle: stateObj.enhanceStyle, enhanceTone: stateObj.enhanceTone, askPlaceholders: stateObj.askPlaceholders, 
            provider: stateObj.aiSettings.provider, apiKey: stateObj.aiSettings.apiKey, model: stateObj.aiSettings.model, 
            apiKeys: stateObj.aiSettings.apiKeys, history: stateObj.copyHistory 
          }, { immediate: true });
          
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
    stateObj.settingsSize = parseFloat(s);
    if (sizeValue) sizeValue.textContent = Math.round(s * 100) + '%';
    const wrap = doc.getElementById('petWrap');
    if (wrap) wrap.style.setProperty('--pet-scale', s);
    callbacks.persist({ settings: { size: parseFloat(s) } });
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

    callbacks.testAIKey(testSettings)
      .then(res => {
        if (testApiKeyStatus) { testApiKeyStatus.textContent = `✓ ${res.provider} key works`; testApiKeyStatus.className = 'test-key-status ok'; }
      })
      .catch(err => {
        if (testApiKeyStatus) { testApiKeyStatus.textContent = `✗ ${callbacks.friendlyError(err)}`; testApiKeyStatus.className = 'test-key-status fail'; }
      })
      .finally(() => {
        testApiKeyBtn.disabled = false;
      });
  });

  return {
    show: () => {
      if (settingProvider) {
        settingProvider.value = stateObj.aiSettings.provider || 'builtin';
        updateApiKeyLink(settingProvider.value);
      }
      if (settingApiKey) settingApiKey.value = (stateObj.aiSettings.apiKeys && stateObj.aiSettings.apiKeys[stateObj.aiSettings.provider]) || stateObj.aiSettings.apiKey || '';
      if (settingModel) settingModel.value = stateObj.aiSettings.model || '';
      if (settingCustomModel) settingCustomModel.value = stateObj.aiSettings.customModel || '';
      if (settingCustomInstructions) settingCustomInstructions.value = stateObj.aiSettings.customInstructions || '';
      if (settingStyle) settingStyle.value = stateObj.enhanceStyle;
      if (settingTone) settingTone.value = stateObj.enhanceTone;
      if (settingAskPlaceholders) settingAskPlaceholders.checked = stateObj.askPlaceholders;
      if (testApiKeyStatus) { testApiKeyStatus.textContent = ''; testApiKeyStatus.className = 'test-key-status'; }
      if (settingsModal) settingsModal.classList.add('show');
    }
  };
}
