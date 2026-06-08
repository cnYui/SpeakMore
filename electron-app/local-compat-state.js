function createDefaultLocalStores({
  defaultLanguage,
  defaultTranslationTargetLanguage,
}) {
  return {
    'app-onboarding': {
      isCompleted: true,
      onboardingIsCompleted: true,
      onboardingStep: null,
      onboardingMaxReachedStep: null,
    },
    'app-settings': {
      keyboardShortcut: {
        pushToTalk: 'RightAlt',
        handlesFreeMode: 'RightAlt+Space',
        pasteLastTranscript: 'LeftCtrl+RightShift+V',
        translationMode: 'RightAlt+RightShift',
      },
      microphoneDevices: [],
      selectedMicrophoneDevice: null,
      preferredLanguage: defaultLanguage,
      translationTargetLanguage: defaultTranslationTargetLanguage,
      translationEnginePreference: 'auto',
      localTranslationModelEnabled: true,
      meetingRealtimeAsrPreference: 'auto',
      meetingRealtimeAsrModelEnabled: true,
      translationModelCacheDir: '',
      selectedLanguages: [],
      autoSelectLanguages: false,
      launchAtSystemStartup: false,
      enableInteractionSoundEffects: true,
      enableShowAppInDock: true,
      historyDurationSeconds: -1,
      enabledMuteBackgroundAudio: true,
      showFloatingBar: true,
      hideMainWindowOnClose: true,
      enabledOpusCompression: false,
    },
    'app-storage': {},
  };
}

function createDefaultLocalUser() {
  return {
    user_id: 'local-user',
    client_user_id: 'local-user',
    email: 'local@typeless.local',
    name: 'SpeakMore',
    plan: 'pro',
    subscription: {
      plan: 'pro',
      status: 'active',
    },
  };
}

function createLocalCompatState({
  defaultLanguage,
  defaultTranslationTargetLanguage,
  sendToMain = () => undefined,
  sendToFloatingBar = () => undefined,
} = {}) {
  const localStores = createDefaultLocalStores({
    defaultLanguage,
    defaultTranslationTargetLanguage,
  });
  let localUser = createDefaultLocalUser();

  function getLocalUser() {
    return localUser;
  }

  function setLocalUser(nextUser) {
    localUser = nextUser;
  }

  function emitUserStateChange() {
    sendToMain('user-state-change', localUser);
  }

  function emitUserRoleChange() {
    sendToMain('user-role-change', {
      plan: localUser.plan,
      subscription: localUser.subscription,
    });
  }

  function syncLocalSettingsToLegacyStore(settings) {
    localStores['app-settings'].launchAtSystemStartup = settings.launchAtSystemStartup;
    localStores['app-settings'].enableInteractionSoundEffects = settings.interactionSoundsEnabled !== false;
    localStores['app-settings'].enabledMuteBackgroundAudio = settings.muteBackgroundAudioDuringRecording !== false;
    localStores['app-settings'].showFloatingBar = settings.showFloatingBar !== false;
    localStores['app-settings'].hideMainWindowOnClose = settings.hideMainWindowOnClose !== false;
    localStores['app-settings'].translationTargetLanguage = settings.translationTargetLanguage;
    localStores['app-settings'].translationEnginePreference = settings.translationEnginePreference;
    localStores['app-settings'].localTranslationModelEnabled = settings.localTranslationModelEnabled !== false;
    localStores['app-settings'].meetingRealtimeAsrPreference = settings.meetingRealtimeAsrPreference || 'auto';
    localStores['app-settings'].meetingRealtimeAsrModelEnabled = settings.meetingRealtimeAsrModelEnabled !== false;
    localStores['app-settings'].translationModelCacheDir = settings.translationModelCacheDir || '';
    localStores['app-settings'].selectedMicrophoneDevice = settings.selectedAudioDeviceId === 'default'
      ? null
      : settings.selectedAudioDeviceId;
  }

  function handleStoreUse(_, payload = {}) {
    const { action, store, key, value } = payload;
    const targetStore = localStores[store];
    if (!targetStore) return null;

    if (action === 'get-all') return { ...targetStore };
    if (action === 'get') return key ? targetStore[key] : null;
    if (action === 'set') {
      targetStore[key] = key === 'preferredLanguage' ? defaultLanguage : value;
      sendToMain('app-settings-updated', {});
      sendToFloatingBar('app-settings-updated', {});
      return value;
    }
    if (action === 'delete') {
      delete targetStore[key];
      return true;
    }
    return null;
  }

  return {
    emitUserRoleChange,
    emitUserStateChange,
    getLocalUser,
    handleStoreUse,
    localStores,
    setLocalUser,
    syncLocalSettingsToLegacyStore,
  };
}

module.exports = {
  createLocalCompatState,
};
