const { registerClipboardUserIpcHandlers } = require('./clipboard-user-ipc');
const { registerHistoryIpcHandlers } = require('./history-ipc');
const { registerSettingsIpcHandlers } = require('./settings-ipc');
const { registerDictionaryIpcHandlers } = require('./dictionary-ipc');
const { registerAudioIpcHandlers } = require('./audio-ipc');
const { registerFocusedContextIpcHandlers } = require('./focused-context-ipc');
const { registerFileIpcHandlers } = require('./file-ipc');
const { registerKeyboardIpcHandlers } = require('./keyboard-ipc');
const { registerPageIpcHandlers } = require('./page-ipc');
const { registerPermissionIpcHandlers } = require('./permission-ipc');
const { registerCompatIpcHandlers } = require('./compat-ipc');
const { registerVoiceModelIpcHandlers } = require('./voice-model-ipc');
const { registerTranslationModelIpcHandlers } = require('./translation-model-ipc');
const { registerShortcutCommandIpcHandlers } = require('./shortcut-command-ipc');
const { registerMeetingNoteIpcHandlers } = require('./meeting-note-ipc');
const { registerVoiceDiagnosticsIpcHandlers } = require('./voice-diagnostics-ipc');

const defaultRegisters = {
  registerAudioIpcHandlers,
  registerClipboardUserIpcHandlers,
  registerCompatIpcHandlers,
  registerDictionaryIpcHandlers,
  registerFileIpcHandlers,
  registerFocusedContextIpcHandlers,
  registerHistoryIpcHandlers,
  registerKeyboardIpcHandlers,
  registerPageIpcHandlers,
  registerPermissionIpcHandlers,
  registerSettingsIpcHandlers,
  registerShortcutCommandIpcHandlers,
  registerTranslationModelIpcHandlers,
  registerVoiceModelIpcHandlers,
  registerMeetingNoteIpcHandlers,
  registerVoiceDiagnosticsIpcHandlers,
};

function createMainIpcRegistry({
  app,
  buildCurrentLlmRequestConfig,
  calculateDirectorySize,
  callTextRefineBackend,
  callVoiceFlowBackend,
  checkVoiceServerReady,
  clipboard,
  createClipboardSnapshot,
  createFloatingBar,
  createMainWindow,
  crypto,
  defaultLanguage,
  dictionaryRepository,
  dialog,
  emitDictionaryChanged = () => undefined,
  emitMeetingNotesChanged = () => undefined,
  emitSettingsChanged = () => undefined,
  emitShortcutCommandsChanged = () => undefined,
  emitVoiceDiagnosticsChanged = () => undefined,
  ensureVoiceBackendStarted,
  ensureVoiceServer,
  fs,
  getFloatingBar,
  getMeetingSubtitlesWindow,
  getInteractiveCardPayload,
  getMainWindow,
  getVoiceModelStatus,
  getTranslationModelStatus,
  handleFloatingWindowsBringToFront,
  handleFloatingBarSetAlwaysOnTopForWindows,
  handleFloatingBarUpdatePositions,
  handleFloatingPanelEvent,
  handleVoiceState,
  handleMeetingDetectorStartRecording,
  handleMeetingDetectorDismiss,
  ipcMain,
  isMuted,
  isSameFocusedContext,
  localCompatState,
  localDataDir,
  logFilePath,
  logger = console,
  macosPlatformCapabilities,
  muteBackgroundSessionsForRecording,
  normalizeHistoryItem,
  openExternalUrl,
  os,
  processEnv,
  processExecPath,
  processPlatform = process.platform,
  readFocusedInfo,
  readFocusedTextTarget,
  readHistoryItems,
  readHistoryStats,
  readHistoryStatsForDashboard,
  readLocalSettings,
  readSelectedTextByClipboard,
  readSelectionSnapshot,
  recordingsDir,
  registers = defaultRegisters,
  reloadVoiceServerConfig,
  restoreClipboardSnapshot,
  restoreMutedBackgroundSessions,
  sendToMain,
  sendToFloatingBar,
  sendToMeetingSubtitles,
  setInteractiveCardPayload,
  showMeetingSubtitles,
  hideMeetingSubtitles,
  shell,
  spawnProcess,
  startVoiceModelDownload,
  startTranslationModelDownload,
  loadTranslationModel,
  unloadTranslationModel,
  systemPreferences,
  shortcutCommandRepository,
  shortcutCommandRegistrar,
  meetingNoteRepository,
  voiceDiagnosticsRepository,
  textObservationManager,
  upsertHistoryItem,
  writeHistoryItems,
  writeLocalSettings,
} = {}) {
  let registered = false;

  function registerIpcHandlers() {
    if (registered) return;
    registered = true;

    registers.registerClipboardUserIpcHandlers({
      ipcMain,
      clipboard,
      getLocalUser: () => localCompatState.getLocalUser(),
      setLocalUser: (nextUser) => {
        localCompatState.setLocalUser(nextUser);
      },
      emitUserStateChange: () => localCompatState.emitUserStateChange(),
      emitUserRoleChange: () => localCompatState.emitUserRoleChange(),
    });
    registers.registerHistoryIpcHandlers({
      ipcMain,
      getDeviceId: () => crypto.createHash('sha256').update(os.hostname()).digest('hex'),
      buildCurrentLlmRequestConfig,
      callTextRefineBackend,
      callVoiceFlowBackend,
      fs,
      localDataDir,
      readLocalSettings,
      readHistoryItems,
      writeHistoryItems,
      readHistoryStats,
      readHistoryStatsForDashboard,
      upsertHistoryItem,
      normalizeHistoryItem,
    });
    registers.registerSettingsIpcHandlers({
      ipcMain,
      readLocalSettings,
      writeLocalSettings,
      reloadVoiceServerConfig,
      emitSettingsChanged,
    });
    registers.registerDictionaryIpcHandlers({
      ipcMain,
      dictionaryRepository,
      emitDictionaryChanged,
    });
    registers.registerAudioIpcHandlers({
      ipcMain,
      callVoiceFlowBackend,
      checkVoiceServerReady,
      ensureVoiceServer,
      muteBackgroundSessionsForRecording,
      restoreMutedBackgroundSessions,
      isMuted,
    });
    registers.registerVoiceModelIpcHandlers({
      ipcMain,
      ensureVoiceBackendStarted,
      getVoiceModelStatus,
      startVoiceModelDownload,
    });
    registers.registerTranslationModelIpcHandlers({
      ipcMain,
      ensureVoiceBackendStarted,
      getTranslationModelStatus,
      startTranslationModelDownload,
      loadTranslationModel,
      unloadTranslationModel,
    });
    registers.registerShortcutCommandIpcHandlers({
      ipcMain,
      shortcutCommandRepository,
      shortcutCommandRegistrar,
      emitShortcutCommandsChanged,
    });
    registers.registerMeetingNoteIpcHandlers({
      ipcMain,
      meetingNoteRepository,
      emitMeetingNotesChanged,
    });
    registers.registerVoiceDiagnosticsIpcHandlers({
      ipcMain,
      voiceDiagnosticsRepository,
      emitVoiceDiagnosticsChanged,
    });
    registers.registerFocusedContextIpcHandlers({
      ipcMain,
      clipboard,
      readFocusedInfo,
      readSelectedTextByClipboard,
      readSelectionSnapshot,
      isSameFocusedContext,
      logger,
    });
    registers.registerFileIpcHandlers({
      ipcMain,
      fs,
      shell,
      dialog,
      localDataDir,
      logFilePath,
      recordingsDir,
      calculateDirectorySize,
    });
    registers.registerKeyboardIpcHandlers({
      ipcMain,
      clipboard,
      spawnProcess,
      readFocusedTextTarget,
      createClipboardSnapshot,
      restoreClipboardSnapshot,
      readFocusedInfo,
      textObservationManager,
      macosPlatformCapabilities,
      platform: processPlatform,
      randomUUID: () => crypto.randomUUID(),
      processEnv,
      logger,
    });
    registers.registerPageIpcHandlers({
      ipcMain,
      createMainWindow,
      createFloatingBar,
      getMainWindow,
      getFloatingBar,
      getMeetingSubtitlesWindow,
      sendToMain,
      sendToMeetingSubtitles,
      handleFloatingPanelEvent,
      handleVoiceState,
      handleFloatingBarUpdatePositions,
      handleFloatingWindowsBringToFront,
      handleFloatingBarSetAlwaysOnTopForWindows,
      openExternalUrl,
      shell,
      getInteractiveCardPayload,
      setInteractiveCardPayload,
      showMeetingSubtitles,
      hideMeetingSubtitles,
      handleMeetingDetectorStartRecording,
      handleMeetingDetectorDismiss,
    });
    registers.registerPermissionIpcHandlers({
      ipcMain,
      app,
      macosPlatformCapabilities,
      processPlatform,
      processExecPath,
      systemPreferences,
    });
    registers.registerCompatIpcHandlers({
      ipcMain,
      localStores: localCompatState.localStores,
      defaultLanguage,
      handleStoreUse: (...args) => localCompatState.handleStoreUse(...args),
      sendToMain,
      sendToFloatingBar,
      app,
    });
  }

  return { registerIpcHandlers };
}

module.exports = {
  createMainIpcRegistry,
};
