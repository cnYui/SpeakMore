const test = require('node:test');
const assert = require('node:assert/strict');
const { createDictionaryRepository } = require('./dictionary-repository');

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

test('createDictionaryRepository 创建词条并生成 prompt terms', () => {
  const store = createMemoryJsonStore();
  const repository = createDictionaryRepository(store);

  const result = repository.createEntry({
    phrase: 'Client2API',
    aliases: ['client to api'],
  }, '2026-05-20T00:00:00.000Z');

  assert.equal(result.success, true);
  assert.equal(store.files['dictionary.json'][0].phrase, 'Client2API');
  assert.deepEqual(repository.readPromptDictionaryTerms(), [
    { phrase: 'Client2API', aliases: ['client to api'] },
  ]);
});

test('createDictionaryRepository 提升候选词时写入正式词条并标记候选状态', () => {
  const store = createMemoryJsonStore({
    'dictionary-candidates.json': [
      {
        id: 'candidate-1',
        wrong: 'client to api',
        correct: 'Client2API',
        count: 3,
        status: 'candidate',
        firstSeenAt: '2026-05-20T00:00:00.000Z',
        lastSeenAt: '2026-05-20T00:00:00.000Z',
      },
    ],
  });
  const repository = createDictionaryRepository(store);

  const result = repository.promoteCandidate('candidate-1', '2026-05-20T00:01:00.000Z');

  assert.equal(result.success, true);
  assert.equal(result.data.phrase, 'Client2API');
  assert.equal(store.files['dictionary.json'][0].source, 'auto');
  assert.equal(store.files['dictionary-candidates.json'][0].status, 'promoted');
});
