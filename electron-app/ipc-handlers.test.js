const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
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

function createMemoryFs() {
  const files = new Map();
  const dirs = new Set();

  return {
    files,
    mkdirSync(dirPath) {
      dirs.add(path.resolve(dirPath));
    },
    writeFileSync(filePath, content) {
      files.set(path.resolve(filePath), Buffer.from(content));
    },
    readFileSync(filePath) {
      return files.get(path.resolve(filePath));
    },
    existsSync(targetPath) {
      const resolved = path.resolve(targetPath);
      return files.has(resolved) || dirs.has(resolved);
    },
    unlinkSync(filePath) {
      files.delete(path.resolve(filePath));
    },
    readdirSync(dirPath) {
      const resolvedDir = path.resolve(dirPath);
      return Array.from(files.keys())
        .filter((filePath) => path.dirname(filePath) === resolvedDir)
        .map((filePath) => path.basename(filePath));
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

test('registerHistoryIpcHandlers 会保存失败重试音频并在删除和清空时清理', async () => {
  const ipcMain = createFakeIpcMain();
  const memoryFs = createMemoryFs();
  let items = [{
    id: 'history-1',
    mode: 'Dictate',
    status: 'error',
    rawText: '',
    refinedText: '',
    durationMs: 1000,
    textLength: 0,
  }];

  registerHistoryIpcHandlers({
    ipcMain,
    fs: memoryFs,
    localDataDir: () => 'C:\\SpeakMoreData',
    readHistoryItems: () => items,
    writeHistoryItems: (nextItems) => {
      items = nextItems;
    },
    readHistoryStats: () => ({ countedHistoryIds: [] }),
    readHistoryStatsForDashboard: () => ({}),
    upsertHistoryItem: (item) => item,
    normalizeHistoryItem: (item) => item,
  });

  const wavBase64 = Buffer.from('RIFFxxxxWAVE').toString('base64');
  const saved = await ipcMain.invoke('db:history-save-audio', { id: 'history-1', wavBase64 });

  assert.equal(saved.success, true);
  assert.equal(items[0].hasRetryAudio, true);
  assert.equal(memoryFs.files.size, 1);

  assert.deepEqual(await ipcMain.invoke('db:history-delete', 'history-1'), { success: true });
  assert.equal(memoryFs.files.size, 0);

  items = [{ id: 'history-1', mode: 'Dictate', status: 'error', rawText: '', refinedText: '' }];
  await ipcMain.invoke('db:history-save-audio', { id: 'history-1', wavBase64 });
  assert.equal(memoryFs.files.size, 1);

  assert.deepEqual(await ipcMain.invoke('db:history-clear'), { success: true });
  assert.deepEqual(items, []);
  assert.equal(memoryFs.files.size, 0);
});

test('registerHistoryIpcHandlers 重试时优先使用保存的音频并更新同一条记录', async () => {
  const ipcMain = createFakeIpcMain();
  const memoryFs = createMemoryFs();
  const voiceFlowCalls = [];
  let items = [{
    id: 'history-voice',
    mode: 'Translate',
    status: 'error',
    rawText: '',
    refinedText: '',
    hasRetryAudio: true,
    retryable: true,
    durationMs: 1000,
    textLength: 0,
  }];

  registerHistoryIpcHandlers({
    ipcMain,
    fs: memoryFs,
    localDataDir: () => 'C:\\SpeakMoreData',
    buildCurrentLlmRequestConfig: () => ({ provider_id: 'deepseek' }),
    callVoiceFlowBackend: async (payload) => {
      voiceFlowCalls.push(payload);
      return { success: true, refine_text: 'translated again', user_prompt: '你好' };
    },
    callTextRefineBackend: async () => {
      throw new Error('text refine should not be used');
    },
    readLocalSettings: () => ({ translationTargetLanguage: 'en' }),
    readHistoryItems: () => items,
    writeHistoryItems: (nextItems) => {
      items = nextItems;
    },
    readHistoryStats: () => ({ countedHistoryIds: [] }),
    readHistoryStatsForDashboard: () => ({}),
    upsertHistoryItem: (item) => {
      items = [item, ...items.filter((historyItem) => historyItem.id !== item.id)];
      return item;
    },
    normalizeHistoryItem: (item) => item,
  });

  await ipcMain.invoke('db:history-save-audio', {
    id: 'history-voice',
    wavBase64: Buffer.from('RIFFxxxxWAVE').toString('base64'),
  });
  const result = await ipcMain.invoke('db:history-retry', 'history-voice');

  assert.equal(result.success, true);
  assert.equal(voiceFlowCalls.length, 1);
  assert.equal(voiceFlowCalls[0].mode, 'translation');
  assert.equal(voiceFlowCalls[0].parameters.output_language, 'en');
  assert.equal(items[0].status, 'completed');
  assert.equal(items[0].refinedText, 'translated again');
  assert.equal(items[0].hasRetryAudio, false);
  assert.equal(memoryFs.files.size, 0);
});

test('registerHistoryIpcHandlers 没有重试音频时使用 rawText 重新处理', async () => {
  const ipcMain = createFakeIpcMain();
  const textRefineCalls = [];
  let items = [{
    id: 'history-text',
    mode: 'Dictate',
    status: 'error',
    rawText: 'hello raw',
    refinedText: '',
    retryable: true,
    durationMs: 1000,
    textLength: 9,
  }];

  registerHistoryIpcHandlers({
    ipcMain,
    buildCurrentLlmRequestConfig: () => ({ provider_id: 'deepseek' }),
    callVoiceFlowBackend: async () => {
      throw new Error('voice flow should not be used');
    },
    callTextRefineBackend: async (payload) => {
      textRefineCalls.push(payload);
      return { success: true, refine_text: 'hello refined', user_prompt: 'hello raw' };
    },
    readHistoryItems: () => items,
    writeHistoryItems: (nextItems) => {
      items = nextItems;
    },
    readHistoryStats: () => ({ countedHistoryIds: [] }),
    readHistoryStatsForDashboard: () => ({}),
    upsertHistoryItem: (item) => {
      items = [item, ...items.filter((historyItem) => historyItem.id !== item.id)];
      return item;
    },
    normalizeHistoryItem: (item) => item,
  });

  const result = await ipcMain.invoke('db:history-retry', 'history-text');

  assert.equal(result.success, true);
  assert.equal(textRefineCalls.length, 1);
  assert.equal(textRefineCalls[0].mode, 'transcript');
  assert.equal(textRefineCalls[0].text, 'hello raw');
  assert.equal(items[0].status, 'completed');
  assert.equal(items[0].refinedText, 'hello refined');
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
  registerPermissionIpcHandlers({
    ipcMain,
    app: {},
    processPlatform: 'win32',
  });

  assert.equal(await ipcMain.invoke('permission:request'), true);
  assert.deepEqual(await ipcMain.invoke('permission:update-auto-launch', { enable: true }), {
    success: true,
    skipped: true,
    enabled: true,
    code: 'auto_launch_dev_skipped',
  });
  assert.equal(await ipcMain.invoke('updater:check-for-update'), null);
});

test('registerPermissionIpcHandlers 注册 macOS 权限诊断通道', async () => {
  const ipcMain = createFakeIpcMain();
  const calls = [];
  registerPermissionIpcHandlers({
    ipcMain,
    app: {},
    processPlatform: 'darwin',
    macosPlatformCapabilities: {
      getAccessibilityStatus: async () => ({ success: true, trusted: true }),
      openAccessibilitySettings: async () => ({ success: true, reason: 'opened' }),
      getDiagnostics: async (options) => {
        calls.push(options);
        return { success: true, options };
      },
    },
  });

  assert.deepEqual(await ipcMain.invoke('permission:macos-accessibility-status'), { success: true, trusted: true });
  assert.deepEqual(await ipcMain.invoke('permission:open-macos-accessibility-settings'), { success: true, reason: 'opened' });
  assert.deepEqual(await ipcMain.invoke('permission:macos-platform-diagnostics', { includeClipboard: true }), {
    success: true,
    options: { includeClipboard: true, includeEventInjection: false },
  });
  assert.deepEqual(calls, [{ includeClipboard: true, includeEventInjection: false }]);
});

test('registerPermissionIpcHandlers 优先使用 macOS App 自身辅助功能授权状态', async () => {
  const ipcMain = createFakeIpcMain();
  let helperCalls = 0;
  registerPermissionIpcHandlers({
    ipcMain,
    processPlatform: 'darwin',
    systemPreferences: {
      isTrustedAccessibilityClient: () => true,
    },
    macosPlatformCapabilities: {
      getAccessibilityStatus: async () => {
        helperCalls += 1;
        return { success: true, trusted: false };
      },
    },
  });

  assert.deepEqual(await ipcMain.invoke('permission:macos-accessibility-status'), {
    success: true,
    source: 'electron_system_preferences',
    confidence: 'confirmed',
    trusted: true,
    reason: 'accessibility_trusted',
  });
  assert.equal(helperCalls, 0);
});

test('registerPermissionIpcHandlers 在 Electron 授权状态读取失败时回退 helper', async () => {
  const ipcMain = createFakeIpcMain();
  registerPermissionIpcHandlers({
    ipcMain,
    processPlatform: 'darwin',
    systemPreferences: {
      isTrustedAccessibilityClient: () => {
        throw new Error('status failed');
      },
    },
    macosPlatformCapabilities: {
      getAccessibilityStatus: async () => ({ success: true, trusted: true, reason: 'helper_trusted' }),
    },
  });

  assert.deepEqual(await ipcMain.invoke('permission:macos-accessibility-status'), {
    success: true,
    trusted: true,
    reason: 'helper_trusted',
  });
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
