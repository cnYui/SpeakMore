const {
  app,
  BrowserWindow,
  globalShortcut,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  clipboard,
  shell,
  screen,
  session,
} = require('electron');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs');
const { spawn } = require('child_process');
const { createRightAltRelay } = require('./right-alt-relay');
const {
  isSameFocusedContext,
  readFocusedInfo,
  readSelectedTextByClipboard,
  readSelectionSnapshot,
} = require('./focused-context');
const { resolveBottomCenterBounds } = require('./floating-window-layout');
const {
  isActiveVoiceState,
  isErrorVoiceState,
  isTerminalVoiceState,
  shouldShowShortcutHint,
} = require('./floating-window-state');
const {
  MAX_HISTORY_ITEMS,
  normalizeHistoryItem,
  normalizeHistoryStats,
  createHistoryStatsFromItems,
  calculateHistoryStatsForDashboard,
  upsertHistoryItemWithStats,
} = require('./history-stats-store');

let mainWindow = null;
let floatingBar = null;
let floatingPanelWindow = null;
let tray = null;
let registeredIpc = false;
let rightAltReleaseTimer = null;
let rightAltRelay = null;
let rightAltListener = null;
let rightAltListenerStdout = '';
let floatingBarCompletedHideTimer = null;
let backgroundMuteActive = false;
let mutedBackgroundSessions = [];
let quitAfterBackgroundAudioRestore = false;
let appIsQuitting = false;
let pendingInteractiveCardPayload = null;
let floatingPanelVisible = false;
let floatingPanelType = null;
let lastVoiceState = null;

const DEFAULT_LANGUAGE = 'zh-CN';
const VOICE_SERVER_URL = 'http://127.0.0.1:8000';
const VOICE_SERVER_HEALTH_URL = `${VOICE_SERVER_URL}/health`;
const VOICE_SERVER_READY_URL = `${VOICE_SERVER_URL}/ready`;
const VOICE_SERVER_VOICE_FLOW_URL = `${VOICE_SERVER_URL}/ai/voice_flow`;
const FLOATING_BAR_COMPLETED_HIDE_DELAY_MS = 1000;
const FLOATING_BAR_SIZE = { width: 400, height: 360 };
const FLOATING_PANEL_SIZE = { width: 440, height: 220 };
const FLOATING_WINDOW_BOTTOM_GAP = 32;
const AUDIO_SESSION_CONTROL_TIMEOUT_MS = 5000;
const LOCAL_DATA_DIR_NAME = 'local-data';
const SETTINGS_FILE_NAME = 'settings.json';
const HISTORY_FILE_NAME = 'history.json';
const HISTORY_STATS_FILE_NAME = 'history-stats.json';
const DEFAULT_TRANSLATION_TARGET_LANGUAGE = 'en';
const SUPPORTED_TRANSLATION_TARGET_LANGUAGES = new Set([DEFAULT_TRANSLATION_TARGET_LANGUAGE]);
const SHORTCUT_DEBUG_ENABLED = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.TYPELESS_SHORTCUT_DEBUG || '').toLowerCase(),
);

const localStores = {
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
    preferredLanguage: DEFAULT_LANGUAGE,
    translationTargetLanguage: DEFAULT_TRANSLATION_TARGET_LANGUAGE,
    selectedLanguages: [],
    autoSelectLanguages: false,
    launchAtSystemStartup: false,
    enableInteractionSoundEffects: true,
    enableShowAppInDock: true,
    historyDurationSeconds: -1,
    enabledMuteBackgroundAudio: true,
    enabledOpusCompression: false,
  },
  'app-storage': {},
};

let localUser = {
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

const defaultLocalSettings = {
  preferredLanguage: DEFAULT_LANGUAGE,
  translationTargetLanguage: DEFAULT_TRANSLATION_TARGET_LANGUAGE,
  launchAtSystemStartup: false,
  selectedAudioDeviceId: 'default',
};

function localDataDir() {
  return path.join(app.getPath('userData'), LOCAL_DATA_DIR_NAME);
}

function localDataPath(fileName) {
  return path.join(localDataDir(), fileName);
}

function logFilePath() {
  return localDataPath('recording.log');
}

function recordingsDir() {
  return localDataPath('recordings');
}

function readJsonFile(fileName, fallback) {
  try {
    const filePath = localDataPath(fileName);
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error(`读取本地数据失败: ${fileName}`, error);
    return fallback;
  }
}

function writeJsonFile(fileName, value) {
  const dir = localDataDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(localDataPath(fileName), JSON.stringify(value, null, 2), 'utf8');
  return value;
}

function normalizeLocalSettings(value = {}) {
  return {
    ...defaultLocalSettings,
    preferredLanguage: DEFAULT_LANGUAGE,
    translationTargetLanguage: SUPPORTED_TRANSLATION_TARGET_LANGUAGES.has(value.translationTargetLanguage)
      ? value.translationTargetLanguage
      : DEFAULT_TRANSLATION_TARGET_LANGUAGE,
    launchAtSystemStartup: Boolean(value.launchAtSystemStartup),
    selectedAudioDeviceId: typeof value.selectedAudioDeviceId === 'string' && value.selectedAudioDeviceId
      ? value.selectedAudioDeviceId
      : 'default',
  };
}

function syncLocalSettingsToLegacyStore(settings) {
  localStores['app-settings'].launchAtSystemStartup = settings.launchAtSystemStartup;
  localStores['app-settings'].translationTargetLanguage = settings.translationTargetLanguage;
  localStores['app-settings'].selectedMicrophoneDevice = settings.selectedAudioDeviceId === 'default'
    ? null
    : settings.selectedAudioDeviceId;
}

function readLocalSettings() {
  const settings = normalizeLocalSettings(readJsonFile(SETTINGS_FILE_NAME, defaultLocalSettings));
  syncLocalSettingsToLegacyStore(settings);
  return settings;
}

function writeLocalSettings(settings) {
  const normalized = normalizeLocalSettings(settings);
  writeJsonFile(SETTINGS_FILE_NAME, normalized);
  syncLocalSettingsToLegacyStore(normalized);
  return normalized;
}

function readHistoryItems() {
  const value = readJsonFile(HISTORY_FILE_NAME, []);
  if (!Array.isArray(value)) return [];
  return value.map(normalizeHistoryItem).slice(0, MAX_HISTORY_ITEMS);
}

function writeHistoryItems(items) {
  return writeJsonFile(HISTORY_FILE_NAME, items.map(normalizeHistoryItem).slice(0, MAX_HISTORY_ITEMS));
}

function isPersistedHistoryStats(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Array.isArray(value.countedHistoryIds);
}

function readHistoryStats() {
  const value = readJsonFile(HISTORY_STATS_FILE_NAME, null);
  if (isPersistedHistoryStats(value)) return normalizeHistoryStats(value);

  const migrated = createHistoryStatsFromItems(readHistoryItems());
  writeHistoryStats(migrated);
  return migrated;
}

function writeHistoryStats(stats) {
  return writeJsonFile(HISTORY_STATS_FILE_NAME, normalizeHistoryStats(stats));
}

function debugShortcut(event, payload = {}) {
  if (!SHORTCUT_DEBUG_ENABLED) return;
  console.log(`[shortcut-debug] ${event} ${JSON.stringify(payload)}`);
}

function readHistoryStatsForDashboard() {
  return calculateHistoryStatsForDashboard(readHistoryStats());
}

function upsertHistoryItem(item) {
  const result = upsertHistoryItemWithStats(readHistoryItems(), readHistoryStats(), item);
  writeHistoryItems(result.items);
  writeHistoryStats(result.stats);
  return result.items[0];
}

function calculateDirectorySize(targetPath) {
  if (!fs.existsSync(targetPath)) return 0;

  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) return stat.size;

  return fs.readdirSync(targetPath, { withFileTypes: true }).reduce((total, entry) => {
    const nextPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) return total + calculateDirectorySize(nextPath);
    return total + fs.statSync(nextPath).size;
  }, 0);
}

function extractedPath(...segments) {
  return path.join(__dirname, '..', 'app-extracted', ...segments);
}

function extractedRendererPath(fileName) {
  return extractedPath('dist', 'renderer', fileName);
}

function preloadPath() {
  return path.join(__dirname, 'preload.js');
}

function iconPath() {
  return extractedPath('build', 'icons', 'png', '32x32.png');
}

function trayIconPath() {
  return extractedPath('build', 'tray-win32.png');
}

function rightAltListenerPath() {
  return path.join(__dirname, 'right-alt-listener.ps1');
}

function audioSessionControlPath() {
  return path.join(__dirname, 'audio-session-control.ps1');
}

function loadExtractedPage(windowInstance, fileName) {
  windowInstance.loadFile(extractedRendererPath(fileName));
}

function sendToMain(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function sendToFloatingBar(channel, payload) {
  if (floatingBar && !floatingBar.isDestroyed()) {
    floatingBar.webContents.send(channel, payload);
  }
}

function sendToFloatingPanel(channel, payload) {
  if (floatingPanelWindow && !floatingPanelWindow.isDestroyed()) {
    floatingPanelWindow.webContents.send(channel, payload);
  }
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

function clearFloatingBarCompletedHideTimer() {
  if (!floatingBarCompletedHideTimer) return;
  clearTimeout(floatingBarCompletedHideTimer);
  floatingBarCompletedHideTimer = null;
}

function showFloatingBar() {
  if (!floatingBar || floatingBar.isDestroyed()) return;
  clearFloatingBarCompletedHideTimer();
  positionFloatingBar();
  floatingBar.setIgnoreMouseEvents(false);
  floatingBar.show();
}

function hideFloatingBar() {
  if (!floatingBar || floatingBar.isDestroyed()) return;
  clearFloatingBarCompletedHideTimer();
  floatingBar.setIgnoreMouseEvents(true, { forward: true });
  floatingBar.hide();
}

function showFloatingPanel(payload = { visible: true, type: 'shortcut-hint' }) {
  createFloatingPanelWindow();
  if (!floatingPanelWindow || floatingPanelWindow.isDestroyed()) return;
  floatingPanelVisible = true;
  floatingPanelType = payload.type || 'shortcut-hint';
  positionFloatingPanel();
  floatingPanelWindow.setIgnoreMouseEvents(false);
  floatingPanelWindow.show();
}

function hideFloatingPanel() {
  floatingPanelVisible = false;
  floatingPanelType = null;
  if (!floatingPanelWindow || floatingPanelWindow.isDestroyed()) return;
  floatingPanelWindow.setIgnoreMouseEvents(true, { forward: true });
  floatingPanelWindow.hide();
}

function normalizeFloatingPanelPayload(payload = {}) {
  const type = payload.type === 'free-ask-result' ? 'free-ask-result' : 'shortcut-hint';
  return { ...payload, type };
}

function scheduleFloatingBarCompletedHide() {
  clearFloatingBarCompletedHideTimer();
  floatingBarCompletedHideTimer = setTimeout(() => {
    lastVoiceState = null;
    hideFloatingBar();
  }, FLOATING_BAR_COMPLETED_HIDE_DELAY_MS);
}

function renderFloatingBarForVoiceState(payload = {}) {
  if (isTerminalVoiceState(payload)) {
    showFloatingBar();
    scheduleFloatingBarCompletedHide();
    return;
  }

  if (payload.visible || isErrorVoiceState(payload)) {
    clearFloatingBarCompletedHideTimer();
    showFloatingBar();
    return;
  }

  lastVoiceState = null;
  hideFloatingBar();
}

function updateFloatingBarVisibility(keys) {
  if (floatingPanelVisible) return;
  const hasActiveKey = Array.isArray(keys) && keys.some((key) => key?.isKeydown);
  if (hasActiveKey) showFloatingBar();
}

function getCurrentFloatingWorkArea() {
  try {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  } catch {
    return screen.getPrimaryDisplay().workArea;
  }
}

function resolveFloatingBarBounds() {
  return resolveBottomCenterBounds(getCurrentFloatingWorkArea(), FLOATING_BAR_SIZE, FLOATING_WINDOW_BOTTOM_GAP);
}

function resolveFloatingPanelBounds() {
  return resolveBottomCenterBounds(getCurrentFloatingWorkArea(), FLOATING_PANEL_SIZE, FLOATING_WINDOW_BOTTOM_GAP);
}

function positionFloatingBar() {
  if (!floatingBar || floatingBar.isDestroyed()) return;
  floatingBar.setBounds(resolveFloatingBarBounds(), false);
}

function positionFloatingPanel() {
  if (!floatingPanelWindow || floatingPanelWindow.isDestroyed()) return;
  floatingPanelWindow.setBounds(resolveFloatingPanelBounds(), false);
}

function createRightAltKeyDownEvent() {
  return {
    keyCode: 165,
    keyName: 'RightAlt',
    enKeyName: 'RightAlt',
    isKeydown: true,
    isBlocked: false,
    timestamp: Date.now(),
  };
}

function createRightAltKeyUpEvent() {
  return {
    keyCode: 165,
    keyName: 'RightAlt',
    enKeyName: 'RightAlt',
    isKeydown: false,
    isBlocked: false,
    timestamp: Date.now(),
  };
}

function createSpaceKeyboardEvent(isKeydown) {
  return {
    keyCode: 32,
    keyName: 'Space',
    enKeyName: 'Space',
    isKeydown,
    isBlocked: false,
    timestamp: Date.now(),
  };
}

function createRightShiftKeyboardEvent(isKeydown) {
  return {
    keyCode: 161,
    keyName: 'RightShift',
    enKeyName: 'RightShift',
    isKeydown,
    isBlocked: false,
    timestamp: Date.now(),
  };
}

function keyboardEventFromListenerPayload(payload) {
  if (payload.key === 'Space') return createSpaceKeyboardEvent(Boolean(payload.isKeydown));
  if (payload.key === 'RightShift') return createRightShiftKeyboardEvent(Boolean(payload.isKeydown));
  return payload.isKeydown ? createRightAltKeyDownEvent() : createRightAltKeyUpEvent();
}

function emitKeyboardState(keys) {
  updateFloatingBarVisibility(keys);
  sendToMain('global-keyboard', keys);
}

function getRightAltRelay() {
  if (rightAltRelay) return rightAltRelay;

  rightAltRelay = createRightAltRelay({
    emitKeyboardState,
    setTimer: setTimeout,
    clearTimer: clearTimeout,
    now: () => Date.now(),
    debugLog: debugShortcut,
  });

  return rightAltRelay;
}

function emitRightAltPulse() {
  if (rightAltReleaseTimer) {
    clearTimeout(rightAltReleaseTimer);
  }

  emitKeyboardState([createRightAltKeyDownEvent()]);
  rightAltReleaseTimer = setTimeout(() => {
    emitKeyboardState([createRightAltKeyUpEvent()]);
    setTimeout(() => emitKeyboardState([]), 40);
    rightAltReleaseTimer = null;
  }, 900);
}

function handleRightAltListenerLine(line) {
  if (!line.trim()) return;

  try {
    const payload = JSON.parse(line);
    debugShortcut('right-alt-listener:payload', payload);
    if (payload.key === 'Escape') {
      if (payload.isKeydown) {
        if (isActiveVoiceState(lastVoiceState)) {
          sendToMain('voice-cancel-requested');
          return;
        }
        if (floatingPanelVisible) {
          hideFloatingPanel();
          return;
        }
        sendToMain('voice-cancel-requested');
      }
      return;
    }
    getRightAltRelay().handlePayload(payload);
  } catch (error) {
    console.error('Right Alt 监听器输出解析失败:', error);
  }
}

function startRightAltListener() {
  if (process.platform !== 'win32') return false;
  if (rightAltListener && !rightAltListener.killed) return true;

  rightAltListener = spawn('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-WindowStyle',
    'Hidden',
    '-File',
    rightAltListenerPath(),
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      SystemRoot: process.env.SystemRoot,
      PATH: process.env.PATH,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      USERPROFILE: process.env.USERPROFILE,
      APPDATA: process.env.APPDATA,
    },
  });

  rightAltListener.stdout.on('data', (chunk) => {
    rightAltListenerStdout += chunk.toString('utf8');
    const lines = rightAltListenerStdout.split(/\r?\n/);
    rightAltListenerStdout = lines.pop() || '';
    lines.forEach(handleRightAltListenerLine);
  });

  rightAltListener.stderr.on('data', (chunk) => {
    console.error(`Right Alt 监听器错误: ${chunk.toString('utf8').trim()}`);
  });

  rightAltListener.on('exit', () => {
    rightAltListener = null;
    rightAltListenerStdout = '';
  });

  return true;
}

function stopRightAltListener() {
  if (!rightAltListener || rightAltListener.killed) return;
  rightAltListener.kill();
  rightAltListener = null;
}

function minimalProcessEnv(extra = {}) {
  return {
    SystemRoot: process.env.SystemRoot,
    PATH: process.env.PATH,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    USERPROFILE: process.env.USERPROFILE,
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    ...extra,
  };
}

function shouldMuteBackgroundAudio() {
  return process.platform === 'win32' && localStores['app-settings'].enabledMuteBackgroundAudio !== false;
}

function getTypelessProcessIds() {
  const processIds = new Set([process.pid]);

  for (const windowInstance of BrowserWindow.getAllWindows()) {
    if (windowInstance.isDestroyed()) continue;
    const osProcessId = windowInstance.webContents?.getOSProcessId?.();
    if (typeof osProcessId === 'number' && osProcessId > 0) {
      processIds.add(osProcessId);
    }
  }

  return Array.from(processIds);
}

function runAudioSessionControl(action, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!shouldMuteBackgroundAudio()) {
      resolve({ success: true, mutedSessions: [], restoredSessions: [] });
      return;
    }

    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      audioSessionControlPath(),
      '-Action',
      action,
      '-Payload',
      JSON.stringify(payload),
    ], {
      cwd: __dirname,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: minimalProcessEnv(),
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`audio session control timeout after ${AUDIO_SESSION_CONTROL_TIMEOUT_MS}ms`));
    }, AUDIO_SESSION_CONTROL_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `audio session control exited with code ${code}`));
        return;
      }

      try {
        resolve(stdout.trim() ? JSON.parse(stdout) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function restoreMutedBackgroundSessions() {
  if (!mutedBackgroundSessions.length) {
    backgroundMuteActive = false;
    return { success: true, restoredSessions: [] };
  }

  try {
    const result = await runAudioSessionControl('restore-sessions', {
      mutedSessions: mutedBackgroundSessions,
    });
    mutedBackgroundSessions = [];
    backgroundMuteActive = false;
    return {
      success: Boolean(result?.success),
      restoredSessions: Array.isArray(result?.restoredSessions) ? result.restoredSessions : [],
    };
  } catch (error) {
    console.error('恢复后台音频会话失败:', error);
    mutedBackgroundSessions = [];
    backgroundMuteActive = false;
    return {
      success: false,
      restoredSessions: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function muteBackgroundSessionsForRecording() {
  if (!shouldMuteBackgroundAudio()) {
    mutedBackgroundSessions = [];
    backgroundMuteActive = false;
    return { success: true, mutedSessions: [] };
  }

  if (backgroundMuteActive || mutedBackgroundSessions.length) {
    await restoreMutedBackgroundSessions();
  }

  try {
    const result = await runAudioSessionControl('mute-active-sessions', {
      excludedProcessIds: getTypelessProcessIds(),
    });
    mutedBackgroundSessions = Array.isArray(result?.mutedSessions) ? result.mutedSessions : [];
    backgroundMuteActive = mutedBackgroundSessions.length > 0;
    return {
      success: Boolean(result?.success),
      mutedSessions: mutedBackgroundSessions,
    };
  } catch (error) {
    console.error('静音后台音频会话失败:', error);
    mutedBackgroundSessions = [];
    backgroundMuteActive = false;
    return {
      success: false,
      mutedSessions: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function resolveVoiceServerProbeDetail(url, status, payload) {
  if (payload && typeof payload === 'object') {
    if (typeof payload.detail === 'string' && payload.detail) return payload.detail;
    if (typeof payload.status === 'string' && payload.status) return payload.status;
  }

  return status > 0 ? `${url} 返回 ${status}` : `无法连接 ${url}`;
}

async function probeVoiceServer(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 700);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const payload = await readJsonSafely(response);
    return {
      success: response.ok,
      status: response.status,
      detail: resolveVoiceServerProbeDetail(url, response.status, payload),
      payload,
    };
  } catch {
    return {
      success: false,
      status: 0,
      detail: `无法连接 ${url}`,
      payload: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checkVoiceServerReady() {
  return probeVoiceServer(VOICE_SERVER_READY_URL);
}

function normalizeVoiceMode(mode) {
  const normalized = String(mode || 'transcript').toLowerCase();
  if (normalized === 'dictate' || normalized === 'dictation') return 'transcript';
  if (normalized === 'ask' || normalized === 'ask_anything') return 'ask_anything';
  if (normalized === 'translate' || normalized === 'translation') return 'translation';
  return 'transcript';
}

function bufferFromVoicePayload(payload = {}) {
  const candidates = [
    payload.arrayBuffer,
    payload.audioBuffer,
    payload.buffer,
    payload.data,
    payload.audio,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (Buffer.isBuffer(candidate)) return candidate;
    if (candidate instanceof ArrayBuffer) return Buffer.from(candidate);
    if (ArrayBuffer.isView(candidate)) {
      return Buffer.from(candidate.buffer, candidate.byteOffset, candidate.byteLength);
    }
    if (candidate.type === 'Buffer' && Array.isArray(candidate.data)) {
      return Buffer.from(candidate.data);
    }
    if (typeof candidate === 'string') {
      return Buffer.from(candidate, 'base64');
    }
  }

  return null;
}

function appendJsonFormField(formData, name, value, fallback = {}) {
  if (typeof value === 'string') {
    formData.append(name, value || JSON.stringify(fallback));
    return;
  }
  formData.append(name, JSON.stringify(value || fallback));
}

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return typeof value === 'object' ? value : fallback;
}

function buildVoiceFlowParameters(payload = {}) {
  const parameters = parseJsonObject(payload.parameters);
  const audioContext = parseJsonObject(payload.audioContext || payload.audio_context);
  const modeConfig = parseJsonObject(payload.modeConfig || payload.mode_config);

  const selectedText = (
    parameters.selected_text
    || payload.selectedText
    || payload.selected_text
    || audioContext.selected_text
    || audioContext.selectedText
    || ''
  );
  const outputLanguage = (
    parameters.output_language
    || payload.outputLanguage
    || payload.output_language
    || modeConfig.output_language
    || modeConfig.outputLanguage
    || ''
  );

  return {
    ...parameters,
    ...(selectedText ? { selected_text: selectedText } : {}),
    ...(outputLanguage ? { output_language: outputLanguage } : {}),
  };
}

function buildVoiceFlowFormData(payload = {}) {
  const audioBuffer = bufferFromVoicePayload(payload);
  if (!audioBuffer || audioBuffer.length === 0) {
    throw new Error('缺少音频数据');
  }

  const mimeType = payload.mimeType || payload.contentType || 'audio/webm;codecs=opus';
  const extension = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('wav') ? 'wav' : 'webm';
  const audioId = payload.audioId || payload.audio_id || crypto.randomUUID();
  const formData = new FormData();
  const audioBlob = new Blob([audioBuffer], { type: mimeType });

  formData.append('audio_file', audioBlob, `${audioId}.${extension}`);
  formData.append('audio_id', audioId);
  formData.append('mode', normalizeVoiceMode(payload.mode));
  appendJsonFormField(formData, 'audio_context', payload.audioContext || payload.audio_context);
  appendJsonFormField(formData, 'audio_metadata', payload.audioMetadata || payload.audio_metadata);
  appendJsonFormField(formData, 'parameters', buildVoiceFlowParameters(payload));
  formData.append('is_retry', String(Boolean(payload.isRetry || payload.is_retry)));
  formData.append('device_name', payload.deviceName || payload.device_name || '');
  formData.append('user_over_time', String(payload.userOverTime || payload.user_over_time || ''));
  formData.append('send_time', String(Date.now()));

  return formData;
}

async function callVoiceFlowBackend(payload = {}) {
  const readyState = await checkVoiceServerReady();
  if (!readyState.success) {
    return {
      success: false,
      aborted: false,
      debug: readyState.payload,
      detail: readyState.detail,
      code: 'backend_not_ready',
      paywall: null,
      error: readyState.detail,
    };
  }

  const response = await fetch(VOICE_SERVER_VOICE_FLOW_URL, {
    method: 'POST',
    body: buildVoiceFlowFormData(payload),
  });
  const result = await readJsonSafely(response);

  if (!response.ok || !result || typeof result !== 'object' || result?.status === 'ERROR') {
    const detail = result?.data?.detail || result?.data?.refine_text || resolveVoiceServerProbeDetail(VOICE_SERVER_VOICE_FLOW_URL, response.status, result);
    return {
      success: false,
      aborted: false,
      debug: result,
      detail,
      code: result?.data?.code || 'voice_flow_failed',
      paywall: result?.data?.important_notification || null,
      web_metadata: result?.data?.web_metadata ?? null,
      external_action: result?.data?.external_action ?? null,
      error: result?.data?.refine_text || detail,
    };
  }

  const resultData = result.data || {};

  return {
    success: true,
    aborted: false,
    debug: result,
    data: resultData,
    detail: '',
    code: '',
    paywall: null,
    web_metadata: resultData.web_metadata ?? null,
    external_action: resultData.external_action ?? null,
    ...resultData,
  };
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1080,
    height: 750,
    minWidth: 988,
    minHeight: 658,
    title: 'SpeakMore',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#ffffff00', symbolColor: 'rgba(0, 0, 0, 0.9)', height: 48 },
    backgroundColor: '#ffffff',
    hasShadow: true,
    transparent: false,
    icon: iconPath(),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      session: session.fromPartition('persist:no-proxy-session'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'dist', 'index.html'));
  mainWindow.on('close', (event) => {
    if (appIsQuitting) return;
    event.preventDefault();
    mainWindow.hide();
    sendToMain('page-event--hub--window-blurred');
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.on('blur', () => sendToMain('page-event--hub--window-blurred'));
}

function createFloatingBar() {
  if (floatingBar && !floatingBar.isDestroyed()) return;

  const bounds = resolveFloatingBarBounds();

  floatingBar = new BrowserWindow({
    type: 'panel',
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    hasShadow: false,
    maximizable: false,
    minimizable: false,
    resizable: false,
    show: false,
    skipTaskbar: true,
    focusable: false,
    fullscreen: false,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  floatingBar.loadFile(path.join(__dirname, 'renderer', 'dist', 'floating-bar.html'));
  floatingBar.setIgnoreMouseEvents(true, { forward: true });
  floatingBar.setAlwaysOnTop(true, 'screen-saver', 1);
  floatingBar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  floatingBar.setFullScreenable(false);
  floatingBar.on('closed', () => {
    clearFloatingBarCompletedHideTimer();
    floatingBar = null;
  });
}

function createFloatingPanelWindow() {
  if (floatingPanelWindow && !floatingPanelWindow.isDestroyed()) return;

  const bounds = resolveFloatingPanelBounds();

  floatingPanelWindow = new BrowserWindow({
    type: 'panel',
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    hasShadow: false,
    maximizable: false,
    minimizable: false,
    resizable: false,
    show: false,
    skipTaskbar: true,
    focusable: false,
    fullscreen: false,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  floatingPanelWindow.loadFile(path.join(__dirname, 'renderer', 'dist', 'floating-panel.html'));
  floatingPanelWindow.setIgnoreMouseEvents(true, { forward: true });
  floatingPanelWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  floatingPanelWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  floatingPanelWindow.setFullScreenable(false);
  floatingPanelWindow.on('closed', () => {
    floatingPanelVisible = false;
    floatingPanelType = null;
    floatingPanelWindow = null;
  });
}

function createTray() {
  const image = nativeImage.createFromPath(trayIconPath()).resize({ width: 16, height: 16 });
  tray = new Tray(image);
  tray.setToolTip('SpeakMore');
  tray.on('click', createMainWindow);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开主窗口', click: createMainWindow },
    { label: '显示悬浮条', click: createFloatingBar },
    { label: '退出', click: () => app.quit() },
  ]));
}

function handleStoreUse(_, payload = {}) {
  const { action, store, key, value } = payload;
  const targetStore = localStores[store];
  if (!targetStore) return null;

  if (action === 'get-all') return { ...targetStore };
  if (action === 'get') return key ? targetStore[key] : null;
  if (action === 'set') {
    targetStore[key] = key === 'preferredLanguage' ? DEFAULT_LANGUAGE : value;
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

function openExternalUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  if (url.startsWith('http:') || url.startsWith('https:') || url.startsWith('ms-settings:')) {
    shell.openExternal(url);
    return true;
  }
  return false;
}

function registerIpcHandlers() {
  if (registeredIpc) return;
  registeredIpc = true;

  ipcMain.handle('clipboard-write', (_, text) => {
    clipboard.writeText(String(text || ''));
    return true;
  });
  ipcMain.handle('clipboard:write-text', (_, text) => {
    clipboard.writeText(String(text || ''));
    return { success: true };
  });

  ipcMain.handle('user:get-current', () => localUser);
  ipcMain.handle('user:is-logged-in', () => true);
  ipcMain.handle('user:login', (_, payload = {}) => {
    localUser = {
      ...localUser,
      ...(payload || {}),
      subscription: {
        ...localUser.subscription,
        ...(payload?.subscription || {}),
      },
    };
    emitUserStateChange();
    emitUserRoleChange();
    return true;
  });
  ipcMain.handle('user:logout', () => {
    emitUserStateChange();
    return true;
  });

  ipcMain.handle('db:get-device-id', () => crypto.createHash('sha256').update(os.hostname()).digest('hex'));
  ipcMain.handle('db:history-list', (_, cursor, limit) => {
    const items = readHistoryItems();
    if (cursor !== undefined || limit !== undefined) {
      const start = Math.max(0, Number(cursor) || 0);
      const size = Math.max(1, Number(limit) || items.length || 1);
      const data = items.slice(start, start + size);
      return { data, total: items.length, hasMore: start + size < items.length };
    }
    return items;
  });
  ipcMain.handle('db:history-latest-id', () => {
    const latest = readHistoryItems()[0];
    return latest ? { success: true, id: latest.id } : { success: false, id: '' };
  });
  ipcMain.handle('db:history-latest-id-for-error-tracking', () => {
    const latest = readHistoryItems()[0];
    return latest ? { success: true, id: latest.id } : { success: false, reason: 'empty' };
  });
  ipcMain.handle('db:history-latest', () => {
    const latest = readHistoryItems()[0];
    return latest ? { success: true, data: latest } : { success: false, data: null, error: 'empty' };
  });
  ipcMain.handle('db:history-get', (_, id) => {
    const item = readHistoryItems().find((historyItem) => historyItem.id === id);
    return item ? { success: true, data: item } : { success: false, error: 'not_found' };
  });
  ipcMain.handle('db:history-clear', () => {
    readHistoryStats();
    writeHistoryItems([]);
    return { success: true };
  });
  ipcMain.handle('db:history-delete', (_, id) => {
    readHistoryStats();
    writeHistoryItems(readHistoryItems().filter((historyItem) => historyItem.id !== id));
    return { success: true };
  });
  ipcMain.handle('db:history-delete-by-duration', () => ({ success: true }));
  ipcMain.handle('db:history-save-audio', () => ({ success: true }));
  ipcMain.handle('db:history-upsert', (_, history) => ({ success: true, data: upsertHistoryItem(history || {}) }));
  ipcMain.handle('db:history-upsert-client-metadata', () => ({ success: true }));
  ipcMain.handle('db:history-trigger-history-cleanup', () => ({ success: true }));
  ipcMain.handle('db:history-trigger-disk-cleanup', () => ({ success: true }));
  ipcMain.handle('db:history-stats', () => readHistoryStatsForDashboard());

  ipcMain.handle('settings:get', () => readLocalSettings());
  ipcMain.handle('settings:update', (_, payload = {}) => writeLocalSettings({ ...readLocalSettings(), ...payload }));

  ipcMain.handle('keyboard:start-keyboard-listener', () => true);
  ipcMain.handle('keyboard:stop-keyboard-listener', () => true);
  ipcMain.handle('keyboard:type-transcript', (_, text) => {
    if (!text) return false;
    clipboard.writeText(String(text));
    const ps = spawn('powershell.exe', [
      '-NoProfile', '-Command',
      'Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 100; [System.Windows.Forms.SendKeys]::SendWait("^v")',
    ], {
      windowsHide: true,
      env: {
        SystemRoot: process.env.SystemRoot,
        PATH: process.env.PATH,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
      },
    });
    return new Promise((resolve) => {
      ps.on('exit', () => resolve(true));
      ps.on('error', () => resolve(false));
    });
  });
  ipcMain.handle('keyboard:set-watcher-interval', () => true);
  ipcMain.handle('keyboard-input:reload-keyboard-shortcuts', () => true);

  ipcMain.handle('permission:request', () => true);
  ipcMain.handle('permission:check-with-child-process', () => true);
  ipcMain.handle('permission:reset-accessibility-permission', () => true);
  ipcMain.handle('permission:update-auto-launch', (_, payload = {}) => {
    app.setLoginItemSettings({ openAtLogin: Boolean(payload.enable), path: process.execPath });
    return true;
  });
  ipcMain.handle('permission:update-show-app-in-dock', () => true);

  ipcMain.handle('updater:check-for-update', () => null);
  ipcMain.handle('updater:download-update', () => null);
  ipcMain.handle('updater:quit-and-install', () => null);
  ipcMain.handle('updater:check-update-and-download-silently', () => null);

  ipcMain.handle('page:open-url', (_, payload) => openExternalUrl(payload?.url || payload));
  ipcMain.handle('page:open-url-scheme', (_, payload) => openExternalUrl(payload?.url || payload));
  ipcMain.handle('page:open-hub', () => {
    createMainWindow();
    return true;
  });
  ipcMain.handle('page:open-typeless-bar', () => {
    createFloatingBar();
    return true;
  });
  ipcMain.handle('page:restart-typeless-bar', () => {
    if (floatingBar && !floatingBar.isDestroyed()) {
      floatingBar.close();
    }
    createFloatingBar();
    return true;
  });
  ipcMain.handle('page:open-settings-modal', (_, payload = {}) => {
    createMainWindow();
    sendToMain('page-event--hub--open-settings-hub', payload);
    return true;
  });
  ipcMain.handle('page:change-hub-route', (_, payload = {}) => {
    createMainWindow();
    sendToMain('page-event--hub--change-route', payload);
    return true;
  });
  ipcMain.handle('page:open-devtools', (_, payload = {}) => {
    const target = payload?.target === 'floating-bar' ? floatingBar : mainWindow;
    if (target && !target.isDestroyed()) {
      target.webContents.openDevTools({ mode: payload?.mode || 'detach' });
      return true;
    }
    createMainWindow();
    mainWindow?.webContents.openDevTools({ mode: payload?.mode || 'detach' });
    return true;
  });
  ipcMain.handle('page:close-all-devtools', () => {
    for (const target of [mainWindow, floatingBar]) {
      if (target && !target.isDestroyed() && target.webContents.isDevToolsOpened()) {
        target.webContents.closeDevTools();
      }
    }
    return true;
  });
  ipcMain.handle('page:open-sidebar', (_, payload = {}) => {
    createMainWindow();
    sendToMain('page-event--hub--open-sidebar', payload);
    return true;
  });
  ipcMain.handle('page:floating-bar-click', () => true);
  ipcMain.on('floating-panel', (_, payload = {}) => {
    if (payload.visible) {
      const panelPayload = normalizeFloatingPanelPayload(payload);

      if (panelPayload.type === 'shortcut-hint' && !shouldShowShortcutHint(lastVoiceState)) {
        hideFloatingPanel();
        renderFloatingBarForVoiceState(lastVoiceState || {});
        return;
      }

      hideFloatingBar();
      showFloatingPanel(panelPayload);
      sendToFloatingPanel('floating-panel', panelPayload);
      return;
    }
    sendToFloatingPanel('floating-panel', { visible: false });
    hideFloatingPanel();
  });
  ipcMain.on('voice-state', (_, payload = {}) => {
    lastVoiceState = payload;
    sendToFloatingBar('voice-state', payload);
    if (floatingPanelVisible && isActiveVoiceState(payload)) hideFloatingPanel();
    renderFloatingBarForVoiceState(payload);
  });
  ipcMain.handle('page:floating-bar-update-positions', (_, payload = []) => {
    if (floatingBar && !floatingBar.isDestroyed()) {
      const positions = Array.isArray(payload) ? payload : payload?.positions;
      floatingBar.setIgnoreMouseEvents(!Array.isArray(positions) || positions.length === 0, { forward: false });
    }
    return true;
  });
  ipcMain.handle('page:floating-bar-set-always-on-top-for-windows', () => {
    if (floatingBar && !floatingBar.isDestroyed()) {
      floatingBar.setAlwaysOnTop(true, 'screen-saver', 1);
      floatingBar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    }
    return true;
  });
  ipcMain.handle('page:complete-onboarding', () => true);
  ipcMain.handle('page:open-interactive-card', (_, payload = {}) => {
    pendingInteractiveCardPayload = payload;
    sendToMain('interactive-card:update', payload);
    return true;
  });
  ipcMain.handle('page:close-interactive-card', () => {
    pendingInteractiveCardPayload = null;
    sendToMain('interactive-card:update', null);
    return true;
  });
  ipcMain.handle('page:get-interactive-card-payload', () => pendingInteractiveCardPayload);
  ipcMain.handle('page:update-interactive-card-bounds', () => true);
  ipcMain.handle('page:close-sidebar', () => true);
  ipcMain.handle('page:launch-application', async (_, payload = {}) => {
    const candidate = payload?.path || payload?.applicationPath || payload?.url || payload;
    if (typeof candidate !== 'string' || !candidate) return false;
    if (candidate.startsWith('http:') || candidate.startsWith('https:') || candidate.startsWith('ms-settings:')) {
      return openExternalUrl(candidate);
    }
    return shell.openPath(candidate).then((result) => result === '');
  });
  ipcMain.handle('page:set-debug-window-position', () => true);

  ipcMain.handle('audio:opus-compress-by-buffer', (_, payload = {}) => ({
    success: false,
    arrayBuffer: payload.arrayBuffer || null,
    message: '本地兼容层未启用 opus 压缩',
  }));
  ipcMain.handle('audio:opus-compress-by-audio-id', () => ({ success: false, message: '本地兼容层未启用 opus 压缩' }));
  ipcMain.handle('audio:clean-opus-audio-file', () => true);
  ipcMain.handle('audio:ai-voice-flow', async (_, payload = {}) => {
    try {
      return await callVoiceFlowBackend(payload);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        aborted: false,
        debug: null,
        detail,
        code: 'voice_flow_failed',
        paywall: null,
        web_metadata: null,
        external_action: null,
        error: detail,
      };
    }
  });
  ipcMain.handle('audio:abort-ai-voice-flow-request', () => true);
  ipcMain.handle('audio:get-devices-async', () => ({ success: true, devices: [], message: 'no devices in shim' }));
  ipcMain.handle('audio:check-voice-server-ready', async () => checkVoiceServerReady());
  ipcMain.handle('audio:ensure-voice-server', async () => checkVoiceServerReady());
  ipcMain.handle('audio:mute-background-sessions', async () => muteBackgroundSessionsForRecording());
  ipcMain.handle('audio:restore-background-sessions', async () => restoreMutedBackgroundSessions());
  ipcMain.handle('audio:is-muted', () => ({ success: true, isMuted: backgroundMuteActive }));
  ipcMain.handle('audio:mute', async () => muteBackgroundSessionsForRecording());
  ipcMain.handle('audio:unmute', async () => restoreMutedBackgroundSessions());

  ipcMain.handle('store:use', handleStoreUse);
  ipcMain.handle('i18n:get-language', () => localStores['app-settings'].preferredLanguage);
  ipcMain.handle('i18n:set-language', () => {
    localStores['app-settings'].preferredLanguage = DEFAULT_LANGUAGE;
    sendToMain('i18n:language-changed', { lng: localStores['app-settings'].preferredLanguage });
    sendToFloatingBar('i18n:language-changed', { lng: localStores['app-settings'].preferredLanguage });
    return true;
  });
  ipcMain.handle('i18n:reset-to-system-language', () => {
    localStores['app-settings'].preferredLanguage = DEFAULT_LANGUAGE;
    sendToMain('i18n:language-changed', { lng: DEFAULT_LANGUAGE });
    sendToFloatingBar('i18n:language-changed', { lng: DEFAULT_LANGUAGE });
    return true;
  });
  ipcMain.handle('mixpanel:track-event', () => ({ success: true }));
  ipcMain.handle('release-notes:prefetch', () => true);
  ipcMain.handle('release-notes:clear-cache', () => true);
  ipcMain.handle('context:get-app-icon', () => null);
  ipcMain.handle('focused-context:get-last-focused-info', () => readFocusedInfo());
  ipcMain.handle('focused-context:get-selected-text', () => readSelectedTextByClipboard({ clipboard }));
  ipcMain.handle('focused-context:get-selection-snapshot', () => readSelectionSnapshot({ clipboard }));
  ipcMain.handle('focused-context:is-current-focus', async (_, previousFocusInfo) => {
    const currentFocusInfo = await readFocusedInfo();
    return {
      success: true,
      same: isSameFocusedContext(previousFocusInfo, currentFocusInfo),
      currentFocusInfo,
    };
  });
  ipcMain.handle('focused-context:get-full-context', () => ({ success: true, data: null }));
  ipcMain.handle('device:is-lid-open', () => true);
  ipcMain.handle('file:save-recording-log', (_, payload = {}) => {
    fs.mkdirSync(localDataDir(), { recursive: true });
    const content = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
    fs.writeFileSync(logFilePath(), `${content}\n`, 'utf8');
    return true;
  });
  ipcMain.handle('file:open-log', async () => {
    fs.mkdirSync(localDataDir(), { recursive: true });
    if (!fs.existsSync(logFilePath())) {
      fs.writeFileSync(logFilePath(), '', 'utf8');
    }
    return (await shell.openPath(logFilePath())) === '';
  });
  ipcMain.handle('file:clear-log', () => {
    fs.mkdirSync(localDataDir(), { recursive: true });
    fs.writeFileSync(logFilePath(), '', 'utf8');
    return true;
  });
  ipcMain.handle('file:open-recordings', async () => {
    fs.mkdirSync(recordingsDir(), { recursive: true });
    return (await shell.openPath(recordingsDir())) === '';
  });
  ipcMain.handle('file:read-recordings-size', async () => ({
    success: true,
    size: calculateDirectorySize(recordingsDir()),
  }));
  ipcMain.handle('file:save-audio-with-dialog', () => ({ success: false, canceled: true }));
  ipcMain.handle('rsa:set-config', () => true);
  ipcMain.handle('rsa:get-config', () => ({ publicKey: '', enabled: false }));
  ipcMain.handle('rsa:is-enabled', () => false);
  ipcMain.handle('rsa:clear', () => true);
  ipcMain.handle('rsa:encrypt', (_, payload = {}) => payload.value || '');
  ipcMain.handle('test:get-latest-history', () => {
    const latest = readHistoryItems()[0] || null;
    return { success: Boolean(latest), data: latest };
  });
  ipcMain.handle('test:generate-test-records', (_, payload = {}) => {
    const count = Math.max(1, Number(payload?.count) || 3);
    const records = Array.from({ length: count }, (_, index) => normalizeHistoryItem({
      id: `test-record-${Date.now()}-${index}`,
      mode: 'Dictate',
      status: 'completed',
      rawText: `test raw ${index + 1}`,
      refinedText: `test refined ${index + 1}`,
      durationMs: 1000 * (index + 1),
      textLength: 16,
      isTestRecord: true,
    }));
    writeHistoryItems([...records, ...readHistoryItems()]);
    return { success: true, count: records.length };
  });
  ipcMain.handle('test:clear-test-records', () => {
    writeHistoryItems(readHistoryItems().filter((item) => !item.isTestRecord));
    return { success: true };
  });
  ipcMain.handle('troubleshooting:get-system-info', () => ({
    success: true,
    data: {
      basic: {
        platform: process.platform,
        osVersion: os.release(),
        architecture: os.arch(),
        cpuCores: os.cpus().length,
        totalMemory: os.totalmem(),
      },
    },
  }));
  ipcMain.handle('app:restart', () => {
    app.relaunch();
    app.exit();
  });

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
  createTray();
  createMainWindow();
  createFloatingBar();
  startRightAltListener();
});

app.on('window-all-closed', (event) => event.preventDefault());
app.on('before-quit', (event) => {
  if (quitAfterBackgroundAudioRestore || (!backgroundMuteActive && !mutedBackgroundSessions.length)) {
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
  if (rightAltReleaseTimer) {
    clearTimeout(rightAltReleaseTimer);
    rightAltReleaseTimer = null;
  }
  if (rightAltRelay) {
    rightAltRelay.dispose();
    rightAltRelay = null;
  }
  stopRightAltListener();
  globalShortcut.unregisterAll();
});
