const test = require('node:test');
const assert = require('node:assert/strict');
const { createHistoryRepository } = require('./history-repository');

function createMemoryJsonStore(initialFiles = {}) {
  const files = { ...initialFiles };
  return {
    files,
    readJsonFile: (fileName, fallback) => (Object.hasOwn(files, fileName) ? files[fileName] : fallback),
    writeJsonFile: (fileName, value) => {
      files[fileName] = value;
      return value;
    },
  };
}

test('createHistoryRepository 在统计文件缺失时从历史迁移累计统计', () => {
  const store = createMemoryJsonStore({
    'history.json': [
      {
        id: 'audio-1',
        mode: 'Dictate',
        status: 'completed',
        rawText: '',
        refinedText: '你好',
        durationMs: 1200,
        textLength: 2,
      },
    ],
  });
  const repository = createHistoryRepository(store);

  const stats = repository.readHistoryStats();

  assert.equal(stats.completedCount, 1);
  assert.equal(stats.totalDurationMs, 1200);
  assert.deepEqual(store.files['history-stats.json'].countedHistoryIds, ['audio-1']);
});

test('createHistoryRepository upsert 历史时同步写入列表和累计统计', () => {
  const store = createMemoryJsonStore();
  const repository = createHistoryRepository(store);

  const item = repository.upsertHistoryItem({
    id: 'audio-2',
    mode: 'Translate',
    status: 'completed',
    rawText: 'hello',
    refinedText: '你好',
    durationMs: 2000,
    textLength: 2,
  });

  assert.equal(item.id, 'audio-2');
  assert.equal(store.files['history.json'][0].id, 'audio-2');
  assert.equal(store.files['history-stats.json'].completedCount, 1);
  assert.equal(repository.readHistoryStatsForDashboard().totalTextLength, 2);
});
