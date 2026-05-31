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
  registerVoiceModelIpcHandlers,
};

function createMainIpcRegistry({
  app,
  calculateDirectorySize,
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
  ensureVoiceBackendStarted,
  ensureVoiceServer,
  fs,
  getFloatingBar,
  getInteractiveCardPayload,
  getMainWindow,
  getVoiceModelStatus,
  handleFloatingBarSetAlwaysOnTopForWindows,
  handleFloatingBarUpdatePositions,
  handleFloatingPanelEvent,
  handleVoiceState,
  ipcMain,
  isMuted,
  isSameFocusedContext,
  localCompatState,
  localDataDir,
  logFilePath,
  logger = console,
  muteBackgroundSessionsForRecording,
  normalizeHistoryItem,
  openExternalUrl,
  os,
  processEnv,
  processExecPath,
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
  setInteractiveCardPayload,
  shell,
  spawnProcess,
  startVoiceModelDownload,
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
      sendToMain,
      handleFloatingPanelEvent,
      handleVoiceState,
      handleFloatingBarUpdatePositions,
      handleFloatingBarSetAlwaysOnTopForWindows,
      openExternalUrl,
      shell,
      getInteractiveCardPayload,
      setInteractiveCardPayload,
    });
    registers.registerPermissionIpcHandlers({
      ipcMain,
      app,
      processExecPath,
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
