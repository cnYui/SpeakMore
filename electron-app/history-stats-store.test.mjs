import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyHistoryStats,
  upsertHistoryItemWithStats,
  calculateHistoryStatsForDashboard,
} from './history-stats-store.js';

const completed = (index) => ({
  id: `audio-${index}`,
  createdAt: new Date(2026, 0, 1, 0, 0, index).toISOString(),
  mode: 'Dictate',
  status: 'completed',
  rawText: '',
  refinedText: '你好',
  durationMs: 1000,
  textLength: 2,
});

test('累计统计包含超过 200 条后的旧记录', () => {
  let items = [];
  let stats = createEmptyHistoryStats();

  for (let index = 0; index < 201; index += 1) {
    const result = upsertHistoryItemWithStats(items, stats, completed(index));
    items = result.items;
    stats = result.stats;
  }

  const dashboardStats = calculateHistoryStatsForDashboard(stats);
  assert.equal(items.length, 200);
  assert.equal(dashboardStats.completedCount, 201);
  assert.equal(dashboardStats.totalDurationMs, 201000);
  assert.equal(dashboardStats.totalTextLength, 402);
});

test('重复 upsert 同一个 completed id 不会重复累计', () => {
  let items = [];
  let stats = createEmptyHistoryStats();

  let result = upsertHistoryItemWithStats(items, stats, completed(1));
  items = result.items;
  stats = result.stats;

  result = upsertHistoryItemWithStats(items, stats, { ...completed(1), textLength: 9, refinedText: '重复文本' });
  items = result.items;
  stats = result.stats;

  const dashboardStats = calculateHistoryStatsForDashboard(stats);
  assert.equal(items.length, 1);
  assert.equal(dashboardStats.completedCount, 1);
  assert.equal(dashboardStats.totalTextLength, 2);
});

test('error 记录不会进入累计统计', () => {
  const result = upsertHistoryItemWithStats([], createEmptyHistoryStats(), {
    id: 'audio-error',
    mode: 'Dictate',
    status: 'error',
    rawText: '',
    refinedText: '',
    durationMs: 5000,
    textLength: 10,
    errorCode: 'asr_failed',
  });

  const dashboardStats = calculateHistoryStatsForDashboard(result.stats);
  assert.equal(result.items.length, 1);
  assert.equal(dashboardStats.completedCount, 0);
  assert.equal(dashboardStats.totalDurationMs, 0);
  assert.equal(dashboardStats.totalTextLength, 0);
});

test('清空历史列表不会重置累计统计', () => {
  const result = upsertHistoryItemWithStats([], createEmptyHistoryStats(), completed(1));
  const items = [];
  const dashboardStats = calculateHistoryStatsForDashboard(result.stats);

  assert.equal(items.length, 0);
  assert.equal(dashboardStats.completedCount, 1);
  assert.equal(dashboardStats.totalTextLength, 2);
});
