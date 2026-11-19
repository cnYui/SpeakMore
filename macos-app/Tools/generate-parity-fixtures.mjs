// 用 Electron 版现有的 JS / TS 实现生成“期望值”，写入 Swift 包的测试夹具。
// Swift 的 SpeakMoreCoreTests 用同样的输入跑原生实现并和这里的输出比对，保证两个版本的规则一致。
//
// 运行（在 electron-app/renderer 目录，因为要用它的 tsx 加载 .ts 源文件）：
//   cd electron-app/renderer && node --import tsx ../../macos-app/Tools/generate-parity-fixtures.mjs
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const require = createRequire(import.meta.url);
const electronApp = path.join(root, 'electron-app');

const settingsStore = require(path.join(electronApp, 'settings-store.js'));
const historyStats = require(path.join(electronApp, 'history-stats-store.js'));
const dictionaryStore = require(path.join(electronApp, 'dictionary-store.js'));
const { createDictionaryRepository } = require(path.join(electronApp, 'dictionary-repository.js'));
const { calculateDashboardPersonalization } = await import(
  pathToFileURL(path.join(electronApp, 'renderer', 'src', 'services', 'dashboardPersonalization.ts')).href
);
const { selectRecentDashboardResults } = await import(
  pathToFileURL(path.join(electronApp, 'renderer', 'src', 'services', 'recentDashboardResults.ts')).href
);
const { splitDictionaryAliases } = await import(
  pathToFileURL(path.join(electronApp, 'renderer', 'src', 'services', 'dictionaryForm.ts')).href
);

// ---- 个性化分数 ----
const personalizationInputs = [
  { totalDurationMs: 0, totalTextLength: 0, activeDictionaryCount: 0 },
  { totalDurationMs: 600000, totalTextLength: 1000, activeDictionaryCount: 5 },
  { totalDurationMs: 3600000, totalTextLength: 50000, activeDictionaryCount: 100 },
  { totalDurationMs: 7200000, totalTextLength: 123456, activeDictionaryCount: 321 },
  { totalDurationMs: 123456789, totalTextLength: 2500000, activeDictionaryCount: 1500 },
  { totalDurationMs: 99999999999999, totalTextLength: 99999999999, activeDictionaryCount: 99999 },
  { totalDurationMs: -5, totalTextLength: -5, activeDictionaryCount: -5 },
  { totalDurationMs: 1, totalTextLength: 1, activeDictionaryCount: 1 },
];
const personalization = personalizationInputs.map((input) => ({
  input,
  expected: calculateDashboardPersonalization(input),
}));

// ---- 历史与统计（含各种脏数据）----
const historyRaw = [
  { id: 'h1', createdAt: '2026-11-19T01:00:00.000Z', mode: 'Dictate', status: 'completed', rawText: '你好世界', refinedText: '你好，世界。', durationMs: 4200, textLength: 6 },
  { id: 'h2', createdAt: '2026-11-19T01:01:00.000Z', mode: 'Ask', status: 'completed', rawText: '今天天气', refinedText: '今天天气怎么样？', durationMs: 3000 },
  { id: 'h3', createdAt: '2026-11-19T01:02:00.000Z', mode: 'Translate', status: 'completed', rawText: 'hello', refinedText: '', durationMs: '1500' },
  { id: 'h4', createdAt: '2026-11-19T01:03:00.000Z', mode: 'Weird', status: 'error', rawText: '', refinedText: '', errorCode: 'llm_api_key_missing', durationMs: 800 },
  { id: 'h5', createdAt: '2026-11-19T01:04:00.000Z', mode: 'Dictate', status: 'completed', rawText: '  ', refinedText: '   ', durationMs: 100 },
  { id: 'h6', createdAt: '2026-11-19T01:05:00.000Z', mode: 'Dictate', status: 'completed', rawText: '表情😀测试👨‍👩‍👧', refinedText: '', durationMs: 60000 },
  { id: 'h7', createdAt: '2026-11-19T01:06:00.000Z', mode: 'Dictate', status: 'completed', rawText: 'abc', refinedText: 'ABC 润色', durationMs: -10, textLength: 'x' },
  { id: 'h8', createdAt: '2026-11-19T01:07:00.000Z', status: 'weird', rawText: 'no mode', durationMs: 2500.5 },
  { id: 'h1', createdAt: '2026-11-19T01:08:00.000Z', mode: 'Dictate', status: 'completed', rawText: '重复 id', refinedText: '', durationMs: 999 },
];
const historyNormalized = historyRaw.map((item) => historyStats.normalizeHistoryItem(item));
const persistedStats = historyStats.createHistoryStatsFromItems(historyRaw);
const history = {
  raw: historyRaw,
  normalized: historyNormalized,
  stats: persistedStats,
  dashboard: historyStats.calculateHistoryStatsForDashboard(persistedStats),
  recent: selectRecentDashboardResults(historyNormalized),
  recentLimit1: selectRecentDashboardResults(historyNormalized, 1),
};

// ---- 设置规范化 ----
const settingsRaw = [
  {},
  { preferredLanguage: 'en-US', translationTargetLanguage: 'ja', asrDeviceMode: 'mps', asrModelId: 'sensevoice-small-int8', modelCacheDir: '  /Users/x/models  ' },
  { preferredLanguage: 'fr', translationTargetLanguage: 'zz', asrDeviceMode: 'gpu', asrModelId: 'whisper', selectedAudioDeviceId: '', modelCacheDir: 42 },
  {
    llm: {
      providerId: 'nope',
      apiKeys: { deepseek: 'sk-test', openai: 123, custom: 'ck' },
      models: { deepseek: '  deepseek-reasoner ', anthropic: '', zai: '   ' },
      providers: [
        { id: 'custom', label: ' My Gateway ', baseUrl: ' https://gw.example.com/v1 ', defaultModel: ' my-model ', authType: 'anthropic' },
        { id: 'openai', baseUrl: 'https://evil.example.com', label: 'Hacked' },
      ],
    },
  },
];
const settings = settingsRaw.map((input) => ({ input, expected: settingsStore.normalizeLocalSettings(input) }));

// ---- 词典：用真实仓库实现跑一段脚本，id 换成词条文本便于比对 ----
const files = new Map();
const repository = createDictionaryRepository({
  readJsonFile: (name, fallback) => (files.has(name) ? JSON.parse(files.get(name)) : fallback),
  writeJsonFile: (name, value) => { files.set(name, JSON.stringify(value)); return value; },
});
const T = (n) => `2026-11-19T0${n}:00:00.000Z`;
repository.writeDictionaryCandidates([
  { id: 'c1', wrong: 'open eye', correct: 'OpenAI', count: 4, status: 'candidate', firstSeenAt: T(1), lastSeenAt: T(2) },
  { id: 'c2', wrong: 'Gemini', correct: 'Gemma', count: 2, status: 'candidate', firstSeenAt: T(1), lastSeenAt: T(2) },
  { id: 'c3', wrong: 'a', correct: 'b', count: 1, status: 'ignored', firstSeenAt: T(1), lastSeenAt: T(1) },
]);
const idOf = (phrase) => repository.readDictionaryEntries().find((entry) => entry.phrase === phrase)?.id;
const steps = [];
steps.push(repository.createEntry({ phrase: '  Claude   Code ', aliases: ['cloud code', 'Cloud Code', 'claude code', ' ', 'clawd'] }, T(1)));
steps.push(repository.createEntry({ phrase: 'claude code', aliases: ['clawd code'] }, T(2)));
steps.push(repository.createEntry({ phrase: 'DeepSeek', aliases: ['deep sick'] }, T(3)));
steps.push(repository.createEntry({ phrase: '   ', aliases: ['x'] }, T(3)));
steps.push(repository.updateEntry({ id: idOf('DeepSeek'), status: 'disabled' }, T(4)));
steps.push(repository.promoteCandidate('c1', T(5)));
steps.push(repository.promoteCandidate('missing', T(5)));
steps.push(repository.ignoreCandidate('c2'));
steps.push(repository.createEntry({ phrase: 'openai', aliases: ['open a i'] }, T(6)));
repository.deleteEntry(idOf('Claude Code'));
const byPhrase = (entries) => entries.map(({ id, ...rest }) => ({ key: rest.phrase, ...rest }));
const dictionary = {
  steps: steps.map((step) => ({ success: step.success, code: step.code ?? null })),
  entries: byPhrase(repository.readDictionaryEntries()),
  candidates: repository.readDictionaryCandidates(),
  aliasSplits: [
    '错误写法, 另一个写法，第三个、第四个;第五个；第六个\n第七个',
    '  a ,A, b ,, ',
    '',
  ].map((input) => ({ input, expected: splitDictionaryAliases(input) })),
};

// ---- 语音链路 ----
// 渲染进程的 .ts 模块不会在加载时碰浏览器全局，但调用时会用 window.setTimeout，这里放一个可控的假 window。
const pendingTimers = new Map();
let nextTimerId = 1;
globalThis.window = {
  setTimeout: (callback) => { const id = nextTimerId++; pendingTimers.set(id, callback); return id; },
  clearTimeout: (id) => { pendingTimers.delete(id); },
  electronAPI: {},
  addEventListener: () => undefined,
};
const servicesDir = path.join(electronApp, 'renderer', 'src', 'services');
const importTs = (relative) => import(pathToFileURL(path.join(servicesDir, relative)).href);
const voiceTypes = await importTs('voice/voiceTypes.ts');
const voiceSocket = await importTs('voice/voiceSocket.ts');
const shortcutGuard = await importTs('shortcutGuard.ts');
const { createRightAltRelay } = require(path.join(electronApp, 'right-alt-relay.js'));
const audioCapture = await importTs('voice/audioCapture.ts');
const recordingStartup = await importTs('voice/recordingStartup.ts');

// 悬浮胶囊状态映射
const baseSession = { ...voiceTypes.initialVoiceSession };
const floatingSessions = [
  { ...baseSession },
  { ...baseSession, status: 'connecting', audioId: 'a1' },
  { ...baseSession, status: 'recording', mode: 'Ask', inputLevel: 0.42 },
  { ...baseSession, status: 'recording', mode: 'Dictate', inputLevel: 0.2, noticeText: '录音将在 10 秒后自动结束' },
  { ...baseSession, status: 'recording', mode: 'Ask', noticeText: '录音将在 10 秒后自动结束' },
  { ...baseSession, status: 'transcribing', mode: 'Translate', inputLevel: 0.1 },
  { ...baseSession, status: 'cancelled', mode: 'Dictate', inputLevel: 0.3 },
  { ...baseSession, status: 'completed', mode: 'Dictate' },
  { ...baseSession, status: 'error', mode: 'Dictate', error: voiceTypes.createVoiceError('asr_failed') },
  { ...baseSession, status: 'error', mode: 'Translate', error: voiceTypes.createVoiceError('refine_failed') },
  { ...baseSession, status: 'error', mode: 'Dictate', error: voiceTypes.createVoiceError('refine_failed') },
  { ...baseSession, status: 'error', mode: 'Ask', inputLevel: 0.5, error: voiceTypes.createVoiceError('audio_empty') },
];
const floatingBar = floatingSessions.map((session) => ({
  session: { ...session, error: session.error ? { code: session.error.code } : null },
  expected: voiceTypes.toFloatingBarState(session),
}));
const errorMessages = Object.fromEntries([
  'backend_unavailable', 'voice_model_missing', 'llm_api_key_missing', 'websocket_timeout', 'websocket_closed',
  'microphone_permission_denied', 'microphone_unavailable', 'recording_start_failed', 'recording_stop_failed',
  'audio_empty', 'asr_failed', 'refine_failed', 'paste_failed', 'protocol_invalid', 'unknown',
].map((code) => [code, voiceTypes.createVoiceError(code).message]));

// WebSocket 消息路由：每条消息在给定上下文下，处理器会收到什么
const messageContexts = {
  active: { audioId: 'a1', rawText: '', ignored: [], cancelled: false, terminal: false },
  withRaw: { audioId: 'a1', rawText: '原始转写', ignored: [], cancelled: false, terminal: false },
  cancelled: { audioId: 'a1', rawText: '', ignored: [], cancelled: true, terminal: false },
  terminal: { audioId: 'a1', rawText: '', ignored: [], cancelled: false, terminal: true },
  ignoredId: { audioId: 'a2', rawText: '', ignored: ['a1'], cancelled: false, terminal: false },
};
const j = (K, V) => JSON.stringify({ K, V });
const messageCases = [
  ['active', j('transcription', { audio_id: 'a1', text: '你好' })],
  ['active', j('transcription', { audio_id: 'a1' })],
  ['active', j('transcription', { audio_id: 'other', text: '旧会话' })],
  ['active', j('audio_processing_completed', { audio_id: 'a1', refined_text: '润色后。' })],
  ['active', j('refine_completed', { audio_id: 'a1', refine_text: '旧字段' })],
  ['active', j('refine_selected_text', { audio_id: 'a1', refined_text: '选区结果' })],
  ['active', j('audio_processing_completed', { audio_id: 'a1' })],
  ['withRaw', j('audio_processing_completed', { audio_id: 'a1' })],
  ['withRaw', j('audio_processing_completed', { audio_id: 'a1', refined_text: '' })],
  ['active', j('transcription_error', { audio_id: 'a1', detail: 'asr 炸了' })],
  ['active', j('audio_processing_error', { audio_id: 'a1', message: '润色炸了' })],
  ['active', j('refine_error', { audio_id: 'a1' })],
  ['active', j('refine_selected_text_error', { audio_id: 'a1', detail: 'x' })],
  ['active', j('error', { code: 503, detail: 'whatever' })],
  ['active', j('error', { code: '503' })],
  ['active', j('error', { detail: '语音模型尚未就绪' })],
  ['active', j('error', { code: 90002, detail: 'Unknown message type' })],
  ['active', j('error', { code: 90002, detail: 'Other' })],
  ['active', j('error', { code: 500, detail: '其它' })],
  ['active', j('important_notification', { audio_id: 'a1', behavior: { interruptSession: true }, detail: '额度用完' })],
  ['active', j('important_notification', { audio_id: 'a1', behavior: { interruptSession: true } })],
  ['active', j('important_notification', { audio_id: 'a1', behavior: { interruptSession: false } })],
  ['active', j('important_notification', { audio_id: 'a1' })],
  ['active', j('session_started', { audio_id: 'a1' })],
  ['active', j('process_mode', {})],
  ['active', JSON.stringify({ V: { text: 'no K' } })],
  ['active', JSON.stringify({ K: 'transcription', V: 'not object' })],
  ['active', JSON.stringify([1, 2])],
  ['active', 'not json at all'],
  ['cancelled', j('transcription', { audio_id: 'a1', text: '取消后' })],
  ['terminal', j('audio_processing_completed', { audio_id: 'a1', refined_text: '迟到的完成' })],
  ['terminal', j('transcription_error', { audio_id: 'a1' })],
  ['terminal', j('transcription', { audio_id: 'a1', text: '终态后仍更新原文' })],
  ['ignoredId', j('transcription', { audio_id: 'a1', text: '被忽略的会话' })],
].map(([contextName, message]) => {
  const context = messageContexts[contextName];
  const received = [];
  voiceSocket.handleVoiceSocketMessage({ data: message }, {
    getCurrentAudioId: () => context.audioId,
    getCurrentRawText: () => context.rawText,
    isIgnoredAudioId: (id) => context.ignored.includes(id),
    isCancelledSession: () => context.cancelled,
    isTerminalSession: () => context.terminal,
    shouldFailOnClose: () => false,
    onRawText: (text) => received.push({ event: 'rawText', text }),
    onFinalText: (text) => received.push({ event: 'finalText', text }),
    onError: (error) => received.push({ event: 'failure', code: error.code }),
    onInterrupt: (detail) => received.push({ event: 'interrupt', detail }),
  });
  return { context: contextName, message, contextValue: context, expected: received.length ? received[0] : { event: 'ignored' } };
});

// 快捷键守卫：用真实的 relay + reducer 回放按键序列（relay 的 40 ms 定时器在每步之后立刻执行）
const guardScenarios = {
  dictate: [['RightAlt', true], ['RightAlt', false]],
  ask_space: [['RightAlt', true], ['Space', true], ['RightAlt', false]],
  ask_command: [['RightAlt', true], ['RightCommand', true], ['RightAlt', false]],
  translate: [['RightAlt', true], ['RightCommand', true], ['RightShift', true], ['RightAlt', false]],
  keep_highest: [['RightAlt', true], ['RightShift', true], ['RightShift', false], ['Space', true], ['RightAlt', false]],
  secondary_released_first: [['RightAlt', true], ['Space', true], ['Space', false], ['RightAlt', false]],
  long_press_blocks: [['RightAlt', true], ['LONG_PRESS'], ['RightAlt', false], ['RightAlt', true], ['RightAlt', false]],
  long_press_hint_cleared_by_next_press: [['RightAlt', true], ['LONG_PRESS'], ['RightAlt', false], ['RightAlt', true]],
  recording_skips_long_press: [['RightAlt', true, 'recording'], ['LONG_PRESS'], ['RightAlt', false, 'recording']],
  shift_without_alt: [['RightShift', true], ['RightShift', false], ['RightAlt', true], ['RightAlt', false]],
  auto_repeat: [['RightAlt', true], ['RightAlt', true], ['RightAlt', true], ['RightAlt', false]],
  release_without_press: [['RightAlt', false], ['Space', false]],
  escape_ignored: [['RightAlt', true], ['Escape', true], ['RightAlt', false]],
};
const guardReplays = Object.entries(guardScenarios).map(([name, steps]) => {
  let state = shortcutGuard.createInitialShortcutGuardState();
  let voiceStatus = 'idle';
  let lastAction = { type: 'none' };
  pendingTimers.clear();
  const relayTimers = [];
  const onLongPress = () => { state = shortcutGuard.blockByLongPress(state); };
  const relay = createRightAltRelay({
    emitKeyboardState: (keys) => {
      const next = shortcutGuard.reduceShortcutGuard(state, keys, { voiceStatus }, onLongPress);
      state = next.state;
      if (next.action.type !== 'none') lastAction = next.action;
    },
    setTimer: (callback) => { relayTimers.push(callback); return relayTimers.length; },
    clearTimer: (id) => { relayTimers[id - 1] = null; },
  });
  const recorded = steps.map((step) => {
    lastAction = { type: 'none' };
    if (step[0] === 'LONG_PRESS') {
      for (const callback of [...pendingTimers.values()]) callback();
      pendingTimers.clear();
    } else {
      if (step[2]) voiceStatus = step[2];
      relay.handlePayload({ key: step[0], isKeydown: step[1] });
      // relay 的 40 ms 清空 / 恢复发射，在下一次按键之前就会执行
      while (relayTimers.length) { const callback = relayTimers.shift(); if (callback) callback(); }
    }
    return {
      step,
      action: lastAction.type === 'none' ? 'none' : `toggle:${lastAction.intent}`,
      blocked: state.isBlocked,
      hint: state.modalVisible,
      intent: state.activeIntent,
      down: state.isRightAltDown,
    };
  });
  return { name, steps, recorded };
});

// 音频整理
const wave = (length, amplitude, offset = 0, period = 16) =>
  Array.from({ length }, (_, i) => offset + amplitude * Math.sin((2 * Math.PI * i) / period));
const f32 = (values) => new Float32Array(values);
const fakeBuffer = (channels) => ({
  numberOfChannels: channels.length,
  length: channels[0].length,
  getChannelData: (index) => f32(channels[index]),
});
const conditionInputs = {
  quiet_speech: wave(64, 0.01),
  silence_floor: wave(64, 0.001),
  loud: wave(64, 0.3),
  dc_offset: wave(64, 0.02, 0.05),
  peak_limited: wave(64, 0.03).map((value, i) => (i === 10 ? 0.9 : value)),
  empty: [],
};
const conditioning = Object.fromEntries(Object.entries(conditionInputs).map(([name, input]) => [
  name, { input, expected: Array.from(audioCapture.conditionAudioForAsr(f32(input))) },
]));
const mixCases = {
  mono: [wave(32, 0.2)],
  stereo_both: [wave(32, 0.2), wave(32, 0.2, 0, 8)],
  stereo_one_silent: [wave(32, 0.2), wave(32, 0.001)],
  stereo_zero: [new Array(32).fill(0), new Array(32).fill(0)],
  three_channels: [wave(32, 0.3), wave(32, 0.02), wave(32, 0.25, 0, 4)],
};
const mixing = Object.fromEntries(Object.entries(mixCases).map(([name, channels]) => [
  name, { channels, expected: Array.from(audioCapture.mixAudioBufferToMono(fakeBuffer(channels))) },
]));
const resampleCases = [
  { name: 'down_48k', rate: 48000, input: wave(96, 0.4, 0, 24) },
  { name: 'down_44k1', rate: 44100, input: wave(100, 0.4, 0, 20) },
  { name: 'up_8k', rate: 8000, input: wave(40, 0.4, 0, 10) },
  { name: 'same_16k', rate: 16000, input: wave(20, 0.4, 0, 8) },
  { name: 'short', rate: 48000, input: [0.1, 0.2] },
];
const resampling = resampleCases.map((item) => ({
  ...item, expected: Array.from(audioCapture.resampleToSampleRate(f32(item.input), item.rate, 16000)),
}));
const pcmInputs = [0, 0.5, -0.5001, 1, -1, 1.5, -2, 0.123456, -0.987654, 0.00003];
const pcm16 = { input: pcmInputs, expected: Array.from(audioCapture.encodePcm16(f32(pcmInputs))) };

// start_audio 参数 / 消息
const llmConfig = { provider_id: 'deepseek', base_url: 'https://api.deepseek.com', api_key: 'sk-test', model: 'deepseek-chat', auth_type: 'bearer' };
const terms = [{ phrase: 'Claude Code', aliases: ['cloud code'] }, { phrase: 'DeepSeek', aliases: [] }];
const startAudio = ['Dictate', 'Ask', 'Translate'].flatMap((mode) => [
  { mode, selectedText: '', terms, language: 'en' },
  { mode, selectedText: '选中的文字', terms: [], language: 'ja' },
]).map((item) => {
  const parameters = recordingStartup.getStartAudioParameters(item.mode, item.selectedText, 'pcm16', {
    dictionaryTerms: item.terms,
    llm: llmConfig,
    translationTargetLanguage: item.mode === 'Translate' ? item.language : null,
  });
  return {
    ...item,
    llm: llmConfig,
    expected: {
      type: 'start_audio', audio_id: 'audio-1', mode: voiceTypes.toVoiceFlowMode(item.mode), audio_context: {}, parameters,
    },
  };
});

// prompt 词典
const promptNow = '2026-11-19T00:00:00.000Z';
const day = (n) => new Date(Date.parse(promptNow) - n * 86400000).toISOString();
const promptEntries = [
  { id: 'e1', phrase: 'Alpha', aliases: ['al'], source: 'manual', status: 'active', hitCount: 0, createdAt: day(1), updatedAt: day(1), lastLearnedAt: '' },
  { id: 'e2', phrase: 'Beta', aliases: [], source: 'auto', status: 'active', hitCount: 10, createdAt: day(60), updatedAt: day(60), lastLearnedAt: day(2) },
  { id: 'e3', phrase: 'Gamma', aliases: ['gm', 'ga'], source: 'auto', status: 'active', hitCount: 3, createdAt: day(90), updatedAt: day(90), lastLearnedAt: '' },
  { id: 'e4', phrase: 'Delta', aliases: [], source: 'manual', status: 'disabled', hitCount: 99, createdAt: day(1), updatedAt: day(1), lastLearnedAt: '' },
  { id: 'e5', phrase: 'Epsilon', aliases: [], source: 'manual', status: 'active', hitCount: 5, createdAt: day(5), updatedAt: day(5), lastLearnedAt: '' },
  { id: 'e6', phrase: 'Zeta', aliases: [], source: 'manual', status: 'active', hitCount: 5, createdAt: day(5), updatedAt: day(5), lastLearnedAt: '' },
  { id: 'e7', phrase: 'Eta', aliases: [], source: 'manual', status: 'active', hitCount: 1, createdAt: day(400), updatedAt: day(400), lastLearnedAt: '' },
  { id: 'e8', phrase: 'Theta', aliases: [], source: 'auto', status: 'active', hitCount: 2, createdAt: day(10), updatedAt: day(10), lastLearnedAt: '' },
  { id: 'e9', phrase: 'Iota', aliases: [], source: 'manual', status: 'active', hitCount: 0, createdAt: day(0), updatedAt: day(0), lastLearnedAt: '' },
  { id: 'e10', phrase: 'Kappa', aliases: [], source: 'auto', status: 'active', hitCount: 7, createdAt: day(20), updatedAt: day(20), lastLearnedAt: day(1) },
  { id: 'e11', phrase: 'Lambda', aliases: [], source: 'manual', status: 'active', hitCount: 2, createdAt: day(3), updatedAt: day(3), lastLearnedAt: '' },
  { id: 'e12', phrase: 'Mu', aliases: [], source: 'manual', status: 'active', hitCount: 4, createdAt: day(7), updatedAt: day(7), lastLearnedAt: '' },
];
const promptTerms = [24, 8, 3, 100, 10].map((limit) => ({
  limit,
  expected: dictionaryStore.buildPromptDictionaryTerms(promptEntries, { limit, now: promptNow }),
}));

const voice = {
  errorMessages, floatingBar, messages: messageCases, guardReplays,
  conditioning, mixing, resampling, pcm16, startAudio,
  prompt: { now: promptNow, entries: promptEntries, cases: promptTerms },
};

const fixtures = { personalization, history, settings, dictionary, voice };
const outDir = path.join(root, 'macos-app', 'Packages', 'SpeakMoreCore', 'Tests', 'SpeakMoreCoreTests', 'Fixtures');
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'parity.json'), `${JSON.stringify(fixtures, null, 2)}\n`);
console.log('wrote', path.join(outDir, 'parity.json'));
