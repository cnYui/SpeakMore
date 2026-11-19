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

const fixtures = { personalization, history, settings, dictionary };
const outDir = path.join(root, 'macos-app', 'Packages', 'SpeakMoreCore', 'Tests', 'SpeakMoreCoreTests', 'Fixtures');
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'parity.json'), `${JSON.stringify(fixtures, null, 2)}\n`);
console.log('wrote', path.join(outDir, 'parity.json'));
