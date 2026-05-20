const test = require('node:test');
const assert = require('node:assert/strict');
const { createMainIpcRegistry } = require('./main-ipc-registry');

function createFakeRegisters(calls) {
  const names = [
    'registerClipboardUserIpcHandlers',
    'registerHistoryIpcHandlers',
    'registerSettingsIpcHandlers',
    'registerDictionaryIpcHandlers',
    'registerModelIpcHandlers',
    'registerAudioIpcHandlers',
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
  const localUser = { name: 'SpeakMore' };
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
    callModelBackend: () => undefined,
    callVoiceFlowBackend: () => undefined,
    checkVoiceServerReady: () => undefined,
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
    handleFloatingBarSetAlwaysOnTopForWindows: () => undefined,
    openExternalUrl: () => undefined,
    getInteractiveCardPayload: () => undefined,
    setInteractiveCardPayload: () => undefined,
    processExecPath: 'D:\\SpeakMore.exe',
    processEnv: { TYPELESS: '1' },
  });

  registry.registerIpcHandlers();
  registry.registerIpcHandlers();

  assert.equal(calls.length, 12);
  assert.deepEqual(calls.map(([name]) => name), [
    'registerClipboardUserIpcHandlers',
    'registerHistoryIpcHandlers',
    'registerSettingsIpcHandlers',
    'registerDictionaryIpcHandlers',
    'registerModelIpcHandlers',
    'registerAudioIpcHandlers',
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
  assert.equal(calls[8][1].randomUUID(), 'uuid-1');
  assert.equal(calls[9][1].createMainWindow(), 'main-window');
  assert.equal(calls[11][1].localStores, localCompatState.localStores);
  assert.equal(typeof calls[11][1].getSystemInfo, 'function');
  assert.deepEqual(calls[11][1].getSystemInfo(), {
    platform: process.platform,
    osVersion: 'os-1',
    architecture: 'x64',
    cpuCores: 2,
    totalMemory: 1234,
  });
});
