const { registerClipboardUserIpcHandlers } = require('./clipboard-user-ipc');
const { registerHistoryIpcHandlers } = require('./history-ipc');
const { registerSettingsIpcHandlers } = require('./settings-ipc');
const { registerDictionaryIpcHandlers } = require('./dictionary-ipc');
const { registerModelIpcHandlers } = require('./model-ipc');
const { registerAudioIpcHandlers } = require('./audio-ipc');
const { registerFocusedContextIpcHandlers } = require('./focused-context-ipc');
const { registerFileIpcHandlers } = require('./file-ipc');
const { registerKeyboardIpcHandlers } = require('./keyboard-ipc');
const { registerPageIpcHandlers } = require('./page-ipc');
const { registerPermissionIpcHandlers } = require('./permission-ipc');
const { registerCompatIpcHandlers } = require('./compat-ipc');

const defaultRegisters = {
  registerAudioIpcHandlers,
  registerClipboardUserIpcHandlers,
  registerCompatIpcHandlers,
  registerDictionaryIpcHandlers,
  registerFileIpcHandlers,
  registerFocusedContextIpcHandlers,
  registerHistoryIpcHandlers,
  registerKeyboardIpcHandlers,
  registerModelIpcHandlers,
  registerPageIpcHandlers,
  registerPermissionIpcHandlers,
  registerSettingsIpcHandlers,
};

function createMainIpcRegistry({
  app,
  calculateDirectorySize,
  callModelBackend,
  callVoiceFlowBackend,
  checkVoiceServerReady,
  clipboard,
  createClipboardSnapshot,
  createFloatingBar,
  createMainWindow,
  crypto,
  defaultLanguage,
  dictionaryRepository,
  fs,
  getFloatingBar,
  getInteractiveCardPayload,
  getMainWindow,
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
    });
    registers.registerModelIpcHandlers({
      ipcMain,
      callModelBackend,
    });
    registers.registerAudioIpcHandlers({
      ipcMain,
      callVoiceFlowBackend,
      checkVoiceServerReady,
      muteBackgroundSessionsForRecording,
      restoreMutedBackgroundSessions,
      isMuted,
    });
    registers.registerFocusedContextIpcHandlers({
      ipcMain,
      clipboard,
      readFocusedInfo,
      readSelectedTextByClipboard,
      readSelectionSnapshot,
      isSameFocusedContext,
    });
    registers.registerFileIpcHandlers({
      ipcMain,
      fs,
      shell,
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
      getSystemInfo: () => ({
        platform: process.platform,
        osVersion: os.release(),
        architecture: os.arch(),
        cpuCores: os.cpus().length,
        totalMemory: os.totalmem(),
      }),
      app,
    });
  }

  return { registerIpcHandlers };
}

module.exports = {
  createMainIpcRegistry,
};
