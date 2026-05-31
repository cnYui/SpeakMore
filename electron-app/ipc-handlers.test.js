const test = require('node:test');
const assert = require('node:assert/strict');
const { registerClipboardUserIpcHandlers } = require('./clipboard-user-ipc');
const { registerHistoryIpcHandlers } = require('./history-ipc');
const { registerSettingsIpcHandlers } = require('./settings-ipc');
const { registerDictionaryIpcHandlers } = require('./dictionary-ipc');
const { registerAudioIpcHandlers } = require('./audio-ipc');
const { registerFocusedContextIpcHandlers } = require('./focused-context-ipc');
const { registerFileIpcHandlers } = require('./file-ipc');
const { registerPermissionIpcHandlers } = require('./permission-ipc');
const { registerCompatIpcHandlers } = require('./compat-ipc');

function createFakeIpcMain() {
  const handles = new Map();
  const listeners = new Map();

  return {
    handles,
    listeners,
    handle(channel, handler) {
      handles.set(channel, handler);
    },
    on(channel, listener) {
      listeners.set(channel, listener);
    },
    async invoke(channel, ...args) {
      const handler = handles.get(channel);
      if (!handler) throw new Error(`missing handler: ${channel}`);
      return handler({}, ...args);
    },
    emit(channel, ...args) {
      const listener = listeners.get(channel);
      if (!listener) throw new Error(`missing listener: ${channel}`);
      return listener({}, ...args);
    },
  };
}

test('registerClipboardUserIpcHandlers 注册剪贴板和用户通道', async () => {
  const ipcMain = createFakeIpcMain();
  const clipboardWrites = [];
  let currentUser = { name: 'SpeakMore' };
  let stateChanges = 0;
  let roleChanges = 0;

  registerClipboardUserIpcHandlers({
    ipcMain,
    clipboard: {
      writeText: (text) => clipboardWrites.push(text),
    },
    getLocalUser: () => currentUser,
    setLocalUser: (next) => {
      currentUser = next;
    },
    emitUserStateChange: () => {
      stateChanges += 1;
    },
    emitUserRoleChange: () => {
      roleChanges += 1;
    },
  });

  assert.equal(await ipcMain.invoke('clipboard-write', 123), true);
  assert.deepEqual(clipboardWrites, ['123']);
  assert.deepEqual(await ipcMain.invoke('clipboard:write-text', ''), { success: true });
  assert.deepEqual(await ipcMain.invoke('user:get-current'), { name: 'SpeakMore' });
  assert.equal(await ipcMain.invoke('user:login', { email: 'a@example.com', subscription: { status: 'paused' } }), true);
  assert.equal(currentUser.email, 'a@example.com');
  assert.equal(currentUser.subscription.status, 'paused');
  assert.equal(stateChanges, 1);
  assert.equal(roleChanges, 1);
  assert.equal(await ipcMain.invoke('user:logout'), true);
});

test('registerHistoryIpcHandlers 注册历史和测试记录通道', async () => {
  const ipcMain = createFakeIpcMain();
  const writes = [];
  const statsReads = [];

  registerHistoryIpcHandlers({
    ipcMain,
    getDeviceId: () => 'device-1',
    readHistoryItems: () => [
      { id: 'h-1', isTestRecord: false },
      { id: 'h-2', isTestRecord: true },
    ],
    writeHistoryItems: (items) => {
      writes.push(items);
    },
    readHistoryStats: () => {
      statsReads.push('read');
      return { countedHistoryIds: [] };
    },
    readHistoryStatsForDashboard: () => ({ total: 2 }),
    upsertHistoryItem: (history) => ({ ...history, saved: true }),
    normalizeHistoryItem: (item) => ({ ...item, normalized: true }),
  });

  assert.equal(await ipcMain.invoke('db:get-device-id'), 'device-1');
  assert.deepEqual(await ipcMain.invoke('db:history-list'), [
    { id: 'h-1', isTestRecord: false },
    { id: 'h-2', isTestRecord: true },
  ]);
  assert.deepEqual(await ipcMain.invoke('db:history-latest-id'), { success: true, id: 'h-1' });
  assert.deepEqual(await ipcMain.invoke('db:history-clear'), { success: true });
  assert.equal(statsReads.length, 1);
  assert.deepEqual(await ipcMain.invoke('db:history-upsert', { id: 'x' }), { success: true, data: { id: 'x', saved: true } });
  assert.deepEqual(await ipcMain.invoke('db:history-stats'), { total: 2 });
  assert.deepEqual(await ipcMain.invoke('test:get-latest-history'), { success: true, data: { id: 'h-1', isTestRecord: false } });
  assert.deepEqual(await ipcMain.invoke('test:generate-test-records', { count: 2 }), { success: true, count: 2 });
  const generatedWrite = writes.find((items) => items[0]?.isTestRecord);
  assert.equal(Boolean(generatedWrite), true);
  assert.match(generatedWrite[0].id, /^test-record-/);
  assert.deepEqual(generatedWrite[0], {
    id: generatedWrite[0].id,
    mode: 'Dictate',
    status: 'completed',
    rawText: 'test raw 1',
    refinedText: 'test refined 1',
    durationMs: 1000,
    textLength: 16,
    isTestRecord: true,
    normalized: true,
  });
  assert.deepEqual(await ipcMain.invoke('test:clear-test-records'), { success: true });
});

test('registerSettingsIpcHandlers 注册设置通道', async () => {
  const ipcMain = createFakeIpcMain();
  let stored = { theme: 'light' };
  let reloads = 0;

  registerSettingsIpcHandlers({
    ipcMain,
    readLocalSettings: () => stored,
    writeLocalSettings: (settings) => {
      stored = settings;
      return settings;
    },
    reloadVoiceServerConfig: async () => {
      reloads += 1;
      return { success: true };
    },
  });

  assert.deepEqual(await ipcMain.invoke('settings:get'), { theme: 'light' });
  assert.deepEqual(await ipcMain.invoke('settings:update', { language: 'zh' }), { theme: 'light', language: 'zh' });
  assert.equal(reloads, 0);
  assert.deepEqual(await ipcMain.invoke('settings:reload-llm-backend'), { success: true });
  assert.equal(reloads, 1);
});

test('registerDictionaryIpcHandlers 注册词典通道', async () => {
  const ipcMain = createFakeIpcMain();
  const calls = [];
  const changes = [];
  const repository = {
    readDictionaryEntries: () => ['entry'],
    createEntry: (payload) => {
      calls.push(['create', payload]);
      return payload;
    },
    updateEntry: (payload) => {
      calls.push(['update', payload]);
      return payload;
    },
    deleteEntry: (id) => {
      calls.push(['delete', id]);
      return true;
    },
    readDictionaryCandidates: () => ['candidate'],
    promoteCandidate: (id) => {
      calls.push(['promote', id]);
      return true;
    },
    ignoreCandidate: (id) => {
      calls.push(['ignore', id]);
      return true;
    },
    readPromptDictionaryTerms: () => ['term'],
  };

  registerDictionaryIpcHandlers({
    ipcMain,
    dictionaryRepository: repository,
    emitDictionaryChanged: (payload) => changes.push(payload),
  });

  assert.deepEqual(await ipcMain.invoke('dictionary:list'), ['entry']);
  assert.deepEqual(await ipcMain.invoke('dictionary:create', { id: 1 }), { id: 1 });
  assert.deepEqual(await ipcMain.invoke('dictionary:update', { id: 1, status: 'disabled' }), { id: 1, status: 'disabled' });
  assert.equal(await ipcMain.invoke('dictionary:delete', 'dict-1'), true);
  assert.deepEqual(await ipcMain.invoke('dictionary:candidates-list'), ['candidate']);
  assert.equal(await ipcMain.invoke('dictionary:candidate-promote', 'candidate-1'), true);
  assert.equal(await ipcMain.invoke('dictionary:candidate-ignore', 'candidate-2'), true);
  assert.deepEqual(await ipcMain.invoke('dictionary:prompt-terms'), ['term']);
  assert.deepEqual(calls[0], ['create', { id: 1 }]);
  assert.deepEqual(changes.map((item) => item.reason), [
    'manual-create',
    'manual-update',
    'manual-delete',
    'candidate-promote',
    'candidate-ignore',
  ]);
});

test('registerDictionaryIpcHandlers 写入失败时不广播词典变更', async () => {
  const ipcMain = createFakeIpcMain();
  const changes = [];

  registerDictionaryIpcHandlers({
    ipcMain,
    emitDictionaryChanged: (payload) => changes.push(payload),
    dictionaryRepository: {
      readDictionaryEntries: () => [],
      createEntry: () => ({ success: false, code: 'dictionary_entry_invalid' }),
      updateEntry: () => ({ success: false, code: 'dictionary_entry_not_found' }),
      deleteEntry: () => ({ success: true }),
      readDictionaryCandidates: () => [],
      promoteCandidate: () => ({ success: false, code: 'dictionary_candidate_not_found' }),
      ignoreCandidate: () => ({ success: true }),
      readPromptDictionaryTerms: () => [],
    },
  });

  await ipcMain.invoke('dictionary:create', {});
  await ipcMain.invoke('dictionary:update', { id: 'missing' });
  await ipcMain.invoke('dictionary:candidate-promote', 'missing');

  assert.deepEqual(changes, []);
});

test('registerAudioIpcHandlers 注册音频通道', async () => {
  const ipcMain = createFakeIpcMain();
  let muted = false;

  registerAudioIpcHandlers({
    ipcMain,
    callVoiceFlowBackend: async (payload) => ({ success: true, payload }),
    checkVoiceServerReady: async () => ({ success: true }),
    ensureVoiceServer: async () => ({ success: true, ensured: true }),
    muteBackgroundSessionsForRecording: async () => {
      muted = true;
      return { success: true };
    },
    restoreMutedBackgroundSessions: async () => {
      muted = false;
      return { success: true };
    },
    isMuted: () => muted,
  });

  assert.deepEqual(await ipcMain.invoke('audio:ai-voice-flow', { foo: 'bar' }), { success: true, payload: { foo: 'bar' } });
  assert.deepEqual(await ipcMain.invoke('audio:ensure-voice-server'), { success: true, ensured: true });
  assert.deepEqual(await ipcMain.invoke('audio:is-muted'), { success: true, isMuted: false });
  await ipcMain.invoke('audio:mute');
  assert.deepEqual(await ipcMain.invoke('audio:is-muted'), { success: true, isMuted: true });
  await ipcMain.invoke('audio:unmute');
  assert.deepEqual(await ipcMain.invoke('audio:is-muted'), { success: true, isMuted: false });
});

test('registerFocusedContextIpcHandlers 注册焦点上下文通道', async () => {
  const ipcMain = createFakeIpcMain();
  registerFocusedContextIpcHandlers({
    ipcMain,
    clipboard: {},
    readFocusedInfo: async () => ({ success: true, title: 'A' }),
    readSelectedTextByClipboard: async () => ({ success: true, text: 'clip' }),
    readSelectionSnapshot: async () => ({ success: true, text: 'snap' }),
    isSameFocusedContext: () => true,
  });

  assert.deepEqual(await ipcMain.invoke('focused-context:get-last-focused-info'), { success: true, title: 'A' });
  assert.deepEqual(await ipcMain.invoke('focused-context:get-selected-text'), { success: true, text: 'clip' });
  assert.deepEqual(await ipcMain.invoke('focused-context:get-selection-snapshot'), { success: true, text: 'snap' });
  assert.deepEqual(await ipcMain.invoke('focused-context:is-current-focus', { title: 'A' }), {
    success: true,
    same: true,
    currentFocusInfo: { success: true, title: 'A' },
  });
});

test('registerFileIpcHandlers 注册文件通道', async () => {
  const ipcMain = createFakeIpcMain();
  const writes = [];

  registerFileIpcHandlers({
    ipcMain,
    fs: {
      mkdirSync: () => undefined,
      existsSync: () => false,
      writeFileSync: (filePath, content) => writes.push([filePath, content]),
    },
    shell: {
      openPath: async (filePath) => {
        writes.push(['open', filePath]);
        return '';
      },
    },
    dialog: {
      showOpenDialog: async (...args) => {
        const options = args.at(-1);
        writes.push(['dialog', options.defaultPath]);
        return { canceled: false, filePaths: ['D:\\Models\\FunASR'] };
      },
    },
    localDataDir: () => 'D:\\data',
    logFilePath: () => 'D:\\data\\recording.log',
    recordingsDir: () => 'D:\\data\\recordings',
    calculateDirectorySize: () => 42,
  });

  assert.equal(await ipcMain.invoke('file:save-recording-log', { hello: 'world' }), true);
  assert.equal(await ipcMain.invoke('file:open-log'), true);
  assert.deepEqual(await ipcMain.invoke('file:read-recordings-size'), { success: true, size: 42 });
  assert.deepEqual(await ipcMain.invoke('file:choose-directory', { defaultPath: 'D:\\Models' }), {
    success: true,
    canceled: false,
    path: 'D:\\Models\\FunASR',
  });
  assert.equal(writes.length > 0, true);
});

test('registerPermissionIpcHandlers 注册权限和更新兼容通道', async () => {
  const ipcMain = createFakeIpcMain();
  const loginSettings = [];

  registerPermissionIpcHandlers({
    ipcMain,
    app: {
      setLoginItemSettings: (settings) => loginSettings.push(settings),
    },
    processExecPath: 'D:\\SpeakMore.exe',
  });

  assert.equal(await ipcMain.invoke('permission:request'), true);
  assert.equal(await ipcMain.invoke('permission:update-auto-launch', { enable: true }), true);
  assert.deepEqual(loginSettings, [{ openAtLogin: true, path: 'D:\\SpeakMore.exe' }]);
  assert.equal(await ipcMain.invoke('updater:check-for-update'), null);
});

test('registerCompatIpcHandlers 注册本地兼容桩通道', async () => {
  const ipcMain = createFakeIpcMain();
  const sent = [];
  const appCalls = [];
  const localStores = {
    'app-settings': {
      preferredLanguage: 'zh',
    },
  };

  registerCompatIpcHandlers({
    ipcMain,
    localStores,
    defaultLanguage: 'en',
    handleStoreUse: () => ({ ok: true }),
    sendToMain: (channel, payload) => sent.push(['main', channel, payload]),
    sendToFloatingBar: (channel, payload) => sent.push(['bar', channel, payload]),
    app: {
      relaunch: () => appCalls.push('relaunch'),
      exit: () => appCalls.push('exit'),
    },
  });

  assert.deepEqual(await ipcMain.invoke('store:use', {}), { ok: true });
  assert.equal(await ipcMain.invoke('i18n:get-language'), 'zh');
  assert.equal(await ipcMain.invoke('i18n:set-language'), true);
  assert.equal(localStores['app-settings'].preferredLanguage, 'en');
  assert.deepEqual(sent[0], ['main', 'i18n:language-changed', { lng: 'en' }]);
  assert.deepEqual(await ipcMain.invoke('rsa:get-config'), { publicKey: '', enabled: false });
  assert.equal(ipcMain.handles.has('troubleshooting:get-system-info'), false);
  await ipcMain.invoke('app:restart');
  assert.deepEqual(appCalls, ['relaunch', 'exit']);
});
