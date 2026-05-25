import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractCorrectionCandidates,
  isLearnableCorrection,
} from './text-correction-learning.js';

test('extractCorrectionCandidates 提取短词级纠错', () => {
  const candidates = extractCorrectionCandidates(
    '我在使用 client to api 写接口',
    '我在使用 Client2API 写接口',
  );

  assert.deepEqual(candidates, [
    { wrong: 'client to api', correct: 'Client2API' },
  ]);
});

test('extractCorrectionCandidates 提取中文词级替换', () => {
  const candidates = extractCorrectionCandidates(
    '请打开谷歌浏览器',
    '请打开 Chrome 浏览器',
  );

  assert.deepEqual(candidates, [
    { wrong: '谷歌', correct: 'Chrome' },
  ]);
});

test('extractCorrectionCandidates 忽略多处修改', () => {
  const candidates = extractCorrectionCandidates(
    '请打开谷歌浏览器然后搜索天气',
    '请打开 Chrome 浏览器然后搜索新闻',
  );

  assert.deepEqual(candidates, []);
});

test('extractCorrectionCandidates 忽略大段重写', () => {
  const candidates = extractCorrectionCandidates(
    '今天我们讨论这个问题的整体解决方案',
    '我想换一种完全不同的说法来表达',
  );

  assert.deepEqual(candidates, []);
});

test('extractCorrectionCandidates 忽略大小写无意义变化', () => {
  assert.deepEqual(extractCorrectionCandidates('Client2API', 'client2api'), []);
});

test('isLearnableCorrection 过滤整句重写', () => {
  assert.equal(isLearnableCorrection({
    wrong: '今天我们讨论这个问题的整体解决方案',
    correct: '我想换一种完全不同的说法来表达',
  }), false);
});

test('isLearnableCorrection 过滤纯标点和空格变化', () => {
  assert.equal(isLearnableCorrection({ wrong: 'Client2API', correct: 'Client2API。' }), false);
  assert.equal(isLearnableCorrection({ wrong: 'Client 2 API', correct: 'Client2API' }), true);
});

test('extractCorrectionCandidates 忽略无变化文本', () => {
  assert.deepEqual(extractCorrectionCandidates('Claude Code', 'Claude Code'), []);
});
