const {
  app,
  BrowserWindow,
  globalShortcut,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  clipboard,
  systemPreferences,
  shell,
  screen,
  session,
  dialog,
} = require('electron');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createRightAltListenerService } = require('./right-alt-listener-service');
const {
  DEFAULT_LANGUAGE,
  DEFAULT_TRANSLATION_TARGET_LANGUAGE,
  createSettingsStore,
  normalizeLlmRequestConfig,
} = require('./settings-store');
const { createVoiceBackendClient } = require('./voice-backend-client');
const { createAudioSessionService } = require('./audio-session-service');
const {
  createClipboardSnapshot,
  createEmptyFocusedInfo,
  isSameFocusedContext,
  readFocusedInfo,
  readFocusedTextTarget,
  readSelectedTextByClipboard,
  readSelectionSnapshot,
  restoreClipboardSnapshot,
} = require('./focused-context');
const { resolveBottomCenterBounds } = require('./floating-window-layout');
const {
  isActiveVoiceState,
  isErrorVoiceState,
  isTerminalVoiceState,
  shouldShowShortcutHint,
} = require('./floating-window-state');
const { createWindowManager } = require('./window-manager');
const {
  normalizeHistoryItem,
} = require('./history-stats-store');
const { createAppPaths } = require('./app-paths');
const { createLocalJsonStore } = require('./local-json-store');
const { createHistoryRepository } = require('./history-repository');
const { createDictionaryRepository } = require('./dictionary-repository');
const { createTextObserverService } = require('./text-observer-service');
const { createLocalCompatState } = require('./local-compat-state');
const { createMainIpcRegistry } = require('./main-ipc-registry');
const { createMacosPlatformCapabilities } = require('./macos-platform-capabilities');
const { createAutoLearningDebugLogger } = require('./auto-learning-debug-logger');
const { createVoiceBackendService } = require('./voice-backend-service');

let quitAfterBackgroundAudioRestore = false;
let appIsQuitting = false;
let pendingInteractiveCardPayload = null;
let sendToMainRef = () => undefined;
let sendToFloatingBarRef = () => undefined;

const SETTINGS_FILE_NAME = 'settings.json';
const HISTORY_FILE_NAME = 'history.json';
const HISTORY_STATS_FILE_NAME = 'history-stats.json';
const DICTIONARY_FILE_NAME = 'dictionary.json';
const DICTIONARY_CANDIDATES_FILE_NAME = 'dictionary-candidates.json';
const SHORTCUT_DEBUG_ENABLED = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.TYPELESS_SHORTCUT_DEBUG || '').toLowerCase(),
);
const IS_MACOS = process.platform === 'darwin';

if (app.isPackaged) {
  app.setName('SpeakMore');
}

const userDataDirOverride = String(process.env.SPEAKMORE_USER_DATA_DIR || '').trim();
if (userDataDirOverride) {
  // 打包态烟测需要隔离本机用户数据，避免改写真实 settings.json。
  fs.mkdirSync(userDataDirOverride, { recursive: true });
  app.setPath('userData', userDataDirOverride);
}

const appPaths = createAppPaths({
  baseDir: __dirname,
  resourcesPath: process.resourcesPath,
  isPackaged: app.isPackaged,
  getUserDataPath: () => app.getPath('userData'),
});

const localJsonStore = createLocalJsonStore({
  fs,
  localDataDir: appPaths.localDataDir,
  localDataPath: appPaths.localDataPath,
});

function localDataDir() { return appPaths.localDataDir(); }
function logFilePath() { return appPaths.logFilePath(); }
function autoLearningDebugLogPath() { return appPaths.localDataPath('auto-learning-debug.log'); }
function recordingsDir() { return appPaths.recordingsDir(); }
function readJsonFile(fileName, fallback) { return localJsonStore.readJsonFile(fileName, fallback); }
function writeJsonFile(fileName, value) { return localJsonStore.writeJsonFile(fileName, value); }

const autoLearningLogger = createAutoLearningDebugLogger({
  fs,
  logFilePath: autoLearningDebugLogPath,
  consoleLogger: console,
});

const localCompatState = createLocalCompatState({
  defaultLanguage: DEFAULT_LANGUAGE,
  defaultTranslationTargetLanguage: DEFAULT_TRANSLATION_TARGET_LANGUAGE,
  sendToMain: (...args) => sendToMainRef(...args),
  sendToFloatingBar: (...args) => sendToFloatingBarRef(...args),
});

const settingsStore = createSettingsStore({
  readJsonFile,
  writeJsonFile,
  syncSettings: (...args) => localCompatState.syncLocalSettingsToLegacyStore(...args),
  fileName: SETTINGS_FILE_NAME,
});

function readLocalSettings() {
  return settingsStore.readLocalSettings();
}

function writeLocalSettings(settings) {
  return settingsStore.writeLocalSettings(settings);
}

function buildCurrentLlmRequestConfig(settings = readLocalSettings()) {
  return settingsStore.buildCurrentLlmRequestConfig(settings);
}

const voiceBackendClient = createVoiceBackendClient({
  fetchImpl: fetch,
  checkReadyFetchImpl: fetch,
  buildCurrentLlmRequestConfig: () => buildCurrentLlmRequestConfig(),
  normalizeLlmRequestConfig,
});

function getConfiguredModelCacheDir(settings = readLocalSettings()) {
  return typeof settings.modelCacheDir === 'string' ? settings.modelCacheDir.trim() : '';
}

function getConfiguredAsrDeviceMode(settings = readLocalSettings()) {
  return ['mps', 'cuda', 'cpu'].includes(settings.asrDeviceMode) ? settings.asrDeviceMode : 'default';
}

function resolveModelCacheDirOption(options = {}) {
  const requestedCacheDir = typeof options.cacheDir === 'string' ? options.cacheDir.trim() : '';
  return requestedCacheDir || getConfiguredModelCacheDir();
}

const voiceBackendService = createVoiceBackendService({
  isPackaged: app.isPackaged,
  backendExecutablePath: () => appPaths.backendExecutablePath(),
  ffmpegBinDir: () => path.dirname(appPaths.ffmpegExecutablePath()),
  getModelCacheDir: () => getConfiguredModelCacheDir(),
  getAsrDeviceMode: () => getConfiguredAsrDeviceMode(),
  spawnProcess: spawn,
  probeReady: () => voiceBackendClient.checkVoiceServerReady(),
  probeModelStatus: () => voiceBackendClient.getVoiceModelStatus({ cacheDir: getConfiguredModelCacheDir() }),
  startModelLoad: () => voiceBackendClient.startVoiceModelDownload({ cacheDir: getConfiguredModelCacheDir() }),
  processEnv: process.env,
  logger: console,
});

const audioSessionService = createAudioSessionService({
  isEnabled: () => localCompatState.localStores['app-settings'].enabledMuteBackgroundAudio !== false,
  getTypelessProcessIds: () => {
    const processIds = new Set([process.pid]);

    for (const windowInstance of BrowserWindow.getAllWindows()) {
      if (windowInstance.isDestroyed()) continue;
      const osProcessId = windowInstance.webContents?.getOSProcessId?.();
      if (typeof osProcessId === 'number' && osProcessId > 0) {
        processIds.add(osProcessId);
      }
    }

    return Array.from(processIds);
  },
  audioSessionControlPath: () => audioSessionControlPath(),
  processEnv: process.env,
  platform: process.platform,
  workDir: __dirname,
  timeoutMs: 5000,
  spawnProcess: spawn,
  logger: console,
});

const historyRepository = createHistoryRepository({
  readJsonFile,
  writeJsonFile,
  historyFileName: HISTORY_FILE_NAME,
  statsFileName: HISTORY_STATS_FILE_NAME,
});

const dictionaryRepository = createDictionaryRepository({
  readJsonFile,
  writeJsonFile,
  dictionaryFileName: DICTIONARY_FILE_NAME,
  candidatesFileName: DICTIONARY_CANDIDATES_FILE_NAME,
  logger: autoLearningLogger,
});

function readHistoryItems() {
  return historyRepository.readHistoryItems();
}

function writeHistoryItems(items) {
  return historyRepository.writeHistoryItems(items);
}

function readHistoryStats() {
  return historyRepository.readHistoryStats();
}

function readHistoryStatsForDashboard() {
  return historyRepository.readHistoryStatsForDashboard();
}

function upsertHistoryItem(item) {
  return historyRepository.upsertHistoryItem(item);
}

function learnDictionaryCorrection(candidate) {
  return dictionaryRepository.learnDictionaryCorrection(candidate);
}

const macosPlatformCapabilities = createMacosPlatformCapabilities({
  clipboard,
  helperSourcePath: () => macosPlatformHelperPath(),
  processPlatform: process.platform,
  processEnv: process.env,
  shell,
  spawnProcess: spawn,
});

const textObserverService = createTextObserverService({
  exePath: appPaths.textObserverExecutablePath(),
  processPlatform: process.platform,
  processEnv: process.env,
  spawnProcess: spawn,
  fileExists: fs.existsSync,
  dotnetRoot: appPaths.dotnetRootPath(),
  learnCorrection: async (candidate) => learnDictionaryCorrection(candidate),
  emitDictionaryChanged,
  macosPlatformCapabilities,
  logger: autoLearningLogger,
});

const textObservationManager = textObserverService.textObservationManager;

function debugShortcut(event, payload = {}) {
  if (!SHORTCUT_DEBUG_ENABLED) return;
  console.log(`[shortcut-debug] ${event} ${JSON.stringify(payload)}`);
}

function calculateDirectorySize(targetPath) { return localJsonStore.calculateDirectorySize(targetPath); }
function preloadPath() { return appPaths.preloadPath(); }
function iconPath() { return appPaths.iconPath(); }
function trayIconPath() { return appPaths.trayIconPath(); }
function rightAltListenerPath() { return appPaths.rightAltListenerPath(); }
function audioSessionControlPath() { return appPaths.audioSessionControlPath(); }
function macosOptionListenerPath() { return appPaths.macosOptionListenerPath(); }
function macosPlatformHelperPath() { return appPaths.macosPlatformHelperPath(); }

async function readFocusedInfoForPlatform(options = {}) {
  if (IS_MACOS) {
    const focusedInfo = await macosPlatformCapabilities.getFocusedInfo(options);
    if (focusedInfo?.appInfo && focusedInfo?.elementInfo) return focusedInfo;
    return createEmptyFocusedInfo();
  }
  return readFocusedInfo(options);
}

function readFocusedTextTargetForPlatform() {
  if (IS_MACOS) return macosPlatformCapabilities.getFocusedTextTargetForPaste(...arguments);
  return readFocusedTextTarget(...arguments);
}

function readSelectedTextByClipboardForPlatform() {
  if (IS_MACOS) {
    return Promise.resolve({
      success: false,
      text: '',
      source: 'clipboard',
      confidence: 'none',
      reason: 'macos_selection_not_supported',
    });
  }
  return readSelectedTextByClipboard(...arguments);
}

function readSelectionSnapshotForPlatform() {
  if (IS_MACOS) {
    return macosPlatformCapabilities.getSelectionSnapshot(...arguments);
  }
  return readSelectionSnapshot(...arguments);
}

let windowManager = null;

function getMainWindow() {
  return windowManager?.getMainWindow() || null;
}

function getFloatingBar() {
  return windowManager?.getFloatingBar() || null;
}

function getFloatingPanelWindow() {
  return windowManager?.getFloatingPanelWindow() || null;
}

function sendToMain(channel, payload) {
  const target = getMainWindow();
  if (target && !target.isDestroyed()) {
    target.webContents.send(channel, payload);
  }
}

function emitDictionaryChanged(payload = {}) {
  sendToMain('dictionary:changed', {
    ...payload,
    changedAt: new Date().toISOString(),
  });
}

function sendToFloatingBar(channel, payload) {
  const target = getFloatingBar();
  if (target && !target.isDestroyed()) {
    target.webContents.send(channel, payload);
  }
}

function sendToFloatingPanel(channel, payload) {
  const target = getFloatingPanelWindow();
  if (target && !target.isDestroyed()) {
    target.webContents.send(channel, payload);
  }
}

sendToMainRef = sendToMain;
sendToFloatingBarRef = sendToFloatingBar;

function emitKeyboardState(keys) {
  windowManager?.updateFloatingBarVisibility(keys);
  sendToMain('global-keyboard', keys);
}

function handleRightAltEscapeKeydown() {
  return windowManager?.handleEscapeKeydown();
}

function createMainWindow() {
  return windowManager?.createMainWindow() || null;
}

function createFloatingBar() {
  return windowManager?.createFloatingBar() || null;
}

function createTray() {
  return windowManager?.createTray() || null;
}

function restoreMutedBackgroundSessions() {
  return audioSessionService.restoreMutedBackgroundSessions();
}

function muteBackgroundSessionsForRecording() {
  return audioSessionService.muteBackgroundSessionsForRecording();
}

async function checkVoiceServerReady() {
  return voiceBackendClient.checkVoiceServerReady();
}

async function ensureVoiceServer() {
  return voiceBackendService.ensureReady();
}

async function ensureVoiceBackendStarted() {
  return voiceBackendService.start();
}

async function getVoiceModelStatus(options = {}) {
  return voiceBackendClient.getVoiceModelStatus({ cacheDir: resolveModelCacheDirOption(options) });
}

async function startVoiceModelDownload(options = {}) {
  return voiceBackendClient.startVoiceModelDownload({ cacheDir: resolveModelCacheDirOption(options) });
}

async function reloadVoiceServerConfig() {
  return voiceBackendClient.reloadVoiceServerConfig();
}

async function callVoiceFlowBackend(payload = {}) {
  return voiceBackendClient.callVoiceFlowBackend(payload);
}

windowManager = createWindowManager({
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  session,
  screen,
  baseDir: __dirname,
  preloadPath,
  iconPath,
  trayIconPath,
  resolveBottomCenterBounds,
  isActiveVoiceState,
  isErrorVoiceState,
  isTerminalVoiceState,
  shouldShowShortcutHint,
  sendToMain,
  sendToFloatingBar,
  sendToFloatingPanel,
  getAppIsQuitting: () => appIsQuitting,
  processPlatform: process.platform,
});

const mainIpcRegistry = createMainIpcRegistry({
  app,
  calculateDirectorySize,
  callVoiceFlowBackend,
  checkVoiceServerReady,
  clipboard,
  createClipboardSnapshot,
  createFloatingBar,
  createMainWindow,
  crypto,
  defaultLanguage: DEFAULT_LANGUAGE,
  dictionaryRepository,
  dialog,
  emitDictionaryChanged,
  ensureVoiceBackendStarted,
  ensureVoiceServer,
  fs,
  getFloatingBar,
  getInteractiveCardPayload: () => pendingInteractiveCardPayload,
  getMainWindow,
  getVoiceModelStatus,
  handleFloatingWindowsBringToFront: () => windowManager.handleFloatingWindowsBringToFront(),
  handleFloatingBarSetAlwaysOnTopForWindows: () => windowManager.handleFloatingBarSetAlwaysOnTopForWindows(),
  handleFloatingBarUpdatePositions: (payload) => windowManager.handleFloatingBarUpdatePositions(payload),
  handleFloatingPanelEvent: (payload) => windowManager.handleFloatingPanelEvent(payload),
  handleVoiceState: (payload) => windowManager.handleVoiceState(payload),
  ipcMain,
  isMuted: () => audioSessionService.isMuted(),
  isSameFocusedContext,
  localCompatState,
  localDataDir,
  logFilePath,
  logger: autoLearningLogger,
  macosPlatformCapabilities,
  muteBackgroundSessionsForRecording,
  normalizeHistoryItem,
  openExternalUrl,
  os,
  processEnv: process.env,
  processExecPath: process.execPath,
  processPlatform: process.platform,
  systemPreferences,
  readFocusedInfo: readFocusedInfoForPlatform,
  readFocusedTextTarget: readFocusedTextTargetForPlatform,
  readHistoryItems,
  readHistoryStats,
  readHistoryStatsForDashboard,
  readLocalSettings,
  readSelectedTextByClipboard: readSelectedTextByClipboardForPlatform,
  readSelectionSnapshot: readSelectionSnapshotForPlatform,
  recordingsDir,
  reloadVoiceServerConfig,
  restoreClipboardSnapshot,
  restoreMutedBackgroundSessions,
  sendToMain,
  sendToFloatingBar,
  setInteractiveCardPayload: (payload) => {
    pendingInteractiveCardPayload = payload;
  },
  shell,
  spawnProcess: spawn,
  startVoiceModelDownload,
  textObservationManager,
  upsertHistoryItem,
  writeHistoryItems,
  writeLocalSettings,
});

function registerIpcHandlers() {
  return mainIpcRegistry.registerIpcHandlers();
}

const rightAltListenerService = createRightAltListenerService({
  emitKeyboardState,
  handleEscapeKeydown: handleRightAltEscapeKeydown,
  rightAltListenerPath: () => rightAltListenerPath(),
  macosOptionListenerPath: () => macosOptionListenerPath(),
  processPlatform: process.platform,
  processEnv: process.env,
  spawnProcess: spawn,
  debugLog: debugShortcut,
});

function startRightAltListener() {
  return rightAltListenerService.start();
}

function stopRightAltListener() {
  return rightAltListenerService.stop();
}

function openExternalUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  if (url.startsWith('http:') || url.startsWith('https:') || url.startsWith('ms-settings:')) {
    shell.openExternal(url);
    return true;
  }
  return false;
}

app.whenReady().then(() => {
  // 覆盖 CSP，避免 file:// 下 module crossorigin 加载失败
  const mainSession = session.fromPartition('persist:no-proxy-session');
  mainSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [''],
      },
    });
  });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [''],
      },
    });
  });

  registerIpcHandlers();
  if (app.isPackaged) void voiceBackendService.startAndPreloadCachedModel();
  createTray();
  createMainWindow();
  createFloatingBar();
  startRightAltListener();
});

app.on('window-all-closed', (event) => event.preventDefault());
app.on('before-quit', (event) => {
  if (quitAfterBackgroundAudioRestore || (!audioSessionService.isMuted() && !audioSessionService.hasMutedSessions())) {
    appIsQuitting = true;
    return;
  }

  event.preventDefault();
  quitAfterBackgroundAudioRestore = true;
  void restoreMutedBackgroundSessions().finally(() => {
    appIsQuitting = true;
    app.quit();
  });
});
app.on('will-quit', () => {
  voiceBackendService.stop();
  windowManager?.dispose();
  rightAltListenerService.dispose();
  stopRightAltListener();
  globalShortcut.unregisterAll();
});
