const test = require('node:test');
const assert = require('node:assert/strict');
const { createMainIpcRegistry } = require('./main-ipc-registry');

function createFakeRegisters(calls) {
  const names = [
    'registerClipboardUserIpcHandlers',
    'registerHistoryIpcHandlers',
    'registerSettingsIpcHandlers',
    'registerDictionaryIpcHandlers',
    'registerAudioIpcHandlers',
    'registerVoiceModelIpcHandlers',
    'registerTranslationModelIpcHandlers',
    'registerShortcutCommandIpcHandlers',
    'registerMeetingNoteIpcHandlers',
    'registerVoiceDiagnosticsIpcHandlers',
    'registerFocusedContextIpcHandlers',
    'registerFileIpcHandlers',
    'registerKeyboardIpcHandlers',
    'registerPageIpcHandlers',
    'registerPermissionIpcHandlers',
    'registerCompatIpcHandlers',
  ];

  return Object.fromEntries(names.map((name) => [name, (payload) => calls.push([name, payload])]));
}

test('createMainIpcRegistry 只注册一次并按固定顺序分发依赖', () => {
  const calls = [];
  const clipboard = { name: 'clipboard' };
  const dialog = { name: 'dialog' };
  const localUser = { name: 'SpeakMore' };
  const emitDictionaryChanged = () => undefined;
  const emitSettingsChanged = () => undefined;
  const macosPlatformCapabilities = { name: 'macosPlatformCapabilities' };
  const localCompatState = {
    localStores: { 'app-settings': { enabledMuteBackgroundAudio: true } },
    getLocalUser: () => localUser,
    setLocalUser: () => undefined,
    emitUserStateChange: () => undefined,
    emitUserRoleChange: () => undefined,
    handleStoreUse: () => undefined,
  };
  const registered = [];
  const registry = createMainIpcRegistry({
    registers: createFakeRegisters(calls),
    ipcMain: { name: 'ipcMain' },
    clipboard,
    crypto: {
      createHash: () => ({ update: () => ({ digest: () => 'device-1' }) }),
      randomUUID: () => 'uuid-1',
    },
    os: {
      hostname: () => 'host-1',
      release: () => 'os-1',
      arch: () => 'x64',
      cpus: () => [{}, {}],
      totalmem: () => 1234,
    },
    app: { name: 'app', quit: () => undefined },
    shell: { name: 'shell' },
    dialog,
    fs: { name: 'fs' },
    spawnProcess: () => undefined,
    logger: { log: () => registered.push('log') },
    readFocusedInfo: () => undefined,
    readSelectedTextByClipboard: () => undefined,
    readSelectionSnapshot: () => undefined,
    isSameFocusedContext: () => undefined,
    readFocusedTextTarget: () => undefined,
    createClipboardSnapshot: () => undefined,
    restoreClipboardSnapshot: () => undefined,
    textObservationManager: { name: 'textObservationManager' },
    readHistoryItems: () => undefined,
    writeHistoryItems: () => undefined,
    readHistoryStats: () => undefined,
    readHistoryStatsForDashboard: () => undefined,
    upsertHistoryItem: () => undefined,
    normalizeHistoryItem: (item) => item,
    readLocalSettings: () => undefined,
    writeLocalSettings: () => undefined,
    reloadVoiceServerConfig: () => undefined,
    dictionaryRepository: { name: 'dictionaryRepository' },
    emitDictionaryChanged,
    emitSettingsChanged,
    buildCurrentLlmRequestConfig: () => ({ provider_id: 'deepseek' }),
    callVoiceFlowBackend: () => undefined,
    callTextRefineBackend: () => undefined,
    checkVoiceServerReady: () => undefined,
    ensureVoiceBackendStarted: () => undefined,
    ensureVoiceServer: () => undefined,
    getVoiceModelStatus: () => undefined,
    startVoiceModelDownload: () => undefined,
    getTranslationModelStatus: () => undefined,
    startTranslationModelDownload: () => undefined,
    loadTranslationModel: () => undefined,
    unloadTranslationModel: () => undefined,
    muteBackgroundSessionsForRecording: () => undefined,
    restoreMutedBackgroundSessions: () => undefined,
    isMuted: () => false,
    localCompatState,
    sendToFloatingBar: () => undefined,
    localDataDir: () => 'D:\\data',
    logFilePath: () => 'D:\\data\\log.txt',
    recordingsDir: () => 'D:\\data\\recordings',
    calculateDirectorySize: () => 42,
    createMainWindow: () => 'main-window',
    createFloatingBar: () => 'floating-bar',
    getMainWindow: () => 'main-window',
    getFloatingBar: () => 'floating-bar',
    sendToMain: () => undefined,
    handleFloatingPanelEvent: () => undefined,
    handleVoiceState: () => undefined,
    handleFloatingBarUpdatePositions: () => undefined,
    handleFloatingWindowsBringToFront: () => undefined,
    handleFloatingBarSetAlwaysOnTopForWindows: () => undefined,
    openExternalUrl: () => undefined,
    getInteractiveCardPayload: () => undefined,
    setInteractiveCardPayload: () => undefined,
    processExecPath: 'D:\\SpeakMore.exe',
    processEnv: { TYPELESS: '1' },
    processPlatform: 'win32',
    macosPlatformCapabilities,
  });

  registry.registerIpcHandlers();
  registry.registerIpcHandlers();

  assert.equal(calls.length, 16);
  assert.deepEqual(calls.map(([name]) => name), [
    'registerClipboardUserIpcHandlers',
    'registerHistoryIpcHandlers',
    'registerSettingsIpcHandlers',
    'registerDictionaryIpcHandlers',
    'registerAudioIpcHandlers',
    'registerVoiceModelIpcHandlers',
    'registerTranslationModelIpcHandlers',
    'registerShortcutCommandIpcHandlers',
    'registerMeetingNoteIpcHandlers',
    'registerVoiceDiagnosticsIpcHandlers',
    'registerFocusedContextIpcHandlers',
    'registerFileIpcHandlers',
    'registerKeyboardIpcHandlers',
    'registerPageIpcHandlers',
    'registerPermissionIpcHandlers',
    'registerCompatIpcHandlers',
  ]);

  assert.equal(calls[0][1].clipboard, clipboard);
  assert.equal(calls[0][1].getLocalUser(), localUser);
  assert.equal(calls[1][1].getDeviceId(), 'device-1');
  assert.equal(typeof calls[1][1].buildCurrentLlmRequestConfig, 'function');
  assert.equal(typeof calls[1][1].callVoiceFlowBackend, 'function');
  assert.equal(typeof calls[1][1].callTextRefineBackend, 'function');
  assert.equal(calls[2][1].emitSettingsChanged, emitSettingsChanged);
  assert.equal(calls[3][1].emitDictionaryChanged, emitDictionaryChanged);
  assert.equal(typeof calls[4][1].ensureVoiceServer, 'function');
  assert.equal(typeof calls[5][1].startVoiceModelDownload, 'function');
  assert.equal(typeof calls[6][1].loadTranslationModel, 'function');
  assert.equal(calls[11][1].dialog, dialog);
  assert.equal(calls[12][1].randomUUID(), 'uuid-1');
  assert.equal(calls[12][1].macosPlatformCapabilities, macosPlatformCapabilities);
  assert.equal(calls[12][1].platform, 'win32');
  assert.equal(calls[13][1].createMainWindow(), 'main-window');
  assert.equal(typeof calls[13][1].handleFloatingWindowsBringToFront, 'function');
  assert.equal(calls[14][1].macosPlatformCapabilities, macosPlatformCapabilities);
  assert.equal(calls[14][1].processPlatform, 'win32');
  assert.equal(calls[15][1].localStores, localCompatState.localStores);
  assert.equal('getSystemInfo' in calls[15][1], false);
});
