// Shared variables across all Bandit modules
var doc, docBody, abortController, signal, cleanupTasks, shadowHost;
var rockyDefaults, hydrated, persist, rockyApi, testAIKey, detectProviderFromKey, escapeHTML, friendlyError, copyToClipboard;
var NS, group, setSafeSvg, frontSvg, fTailG, fBodyG, fEarsG, fBodyRectsG, fEyesG, fAccG, overlay, eyesOpen, eyesClosed, eyesHappy, applyAccessories;
var wrap, root, pet, bubble, input, box, hint, xpFill, xpLabel, toast, messages;
var state, xp, level, petName, lastFedAt, aiSettings, enhanceStyle, enhanceTone, askPlaceholders, lastEnhance, copyHistory;
var currentVersion, lastSeenVersion, updateMessageCount, FEED_COOLDOWN_MS, LEVELS, lastActivity, alertShown, runAnim, isHovering;
var setState, say, showToast, sayThinking, stopThinking, blinkTimer, isFetching, fetchTimer, pokeActivity, sleepInterval;
var startRun, runInterval, stopRun, idleLines, chatterInterval, PLACEHOLDER_SUGGESTIONS, suggestionsFor, extractPlaceholders;
var openRockyModal, askPlaceholderValues, enhancePrompt, updateXPDisplay, gainXP, getClosest, clampToViewport, reclampToViewport;
var drag, spinTimer, lastTap, petDistance, lastHeartTime, spawnHeart, lastEyeMove, eyesFollowCursor, lastPointerCheck;
var timeAgo, runSummarize, eatApple, SNACKS, spawnFeedTreat, showFeedCooldown, feedRocky, initialRaf;
var settingsModal, settingName, settingSize, sizeValue, settingProvider, settingApiKey, settingModel, settingStyle, settingTone, settingAskPlaceholders;
var testApiKeyBtn, testApiKeyStatus, exportBtn, importBtn, backupStatus, getApiKeyLink, API_LINKS, updateApiKeyLink, currentSettingsProvider, applyRemoteState;

BanditEnv.initRocky = function(savedState) {
    if (BanditEnv.initBanditState) BanditEnv.initBanditState(savedState);
    if (BanditEnv.initBanditAnimations) BanditEnv.initBanditAnimations();
    if (BanditEnv.initBanditDrag) BanditEnv.initBanditDrag();
    if (BanditEnv.initBanditUI) BanditEnv.initBanditUI();
};
