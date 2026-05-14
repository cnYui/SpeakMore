const crypto = require('crypto');

const MAX_HISTORY_ITEMS = 200;
const MAX_COUNTED_HISTORY_IDS = 5000;
const HAND_TYPED_CHARS_PER_MINUTE = 60;

function countTextLength(text) {
  return String(text || '').trim().length;
}

function normalizeHistoryItem(item = {}) {
  const refinedText = String(item.refinedText || '');
  const rawText = String(item.rawText || '');
  const finalText = refinedText || rawText;

  return {
    id: String(item.id || crypto.randomUUID()),
    createdAt: String(item.createdAt || new Date().toISOString()),
    mode: ['Dictate', 'Ask', 'Translate'].includes(item.mode) ? item.mode : 'Dictate',
    status: item.status === 'error' ? 'error' : 'completed',
    rawText,
    refinedText,
    isTestRecord: Boolean(item.isTestRecord),
    errorCode: item.errorCode ? String(item.errorCode) : undefined,
    durationMs: Math.max(0, Number(item.durationMs) || 0),
    textLength: Math.max(0, Number(item.textLength) || countTextLength(finalText)),
  };
}

function createEmptyHistoryStats() {
  return {
    schemaVersion: 1,
    completedCount: 0,
    totalDurationMs: 0,
    totalTextLength: 0,
    countedHistoryIds: [],
  };
}

function normalizeHistoryStats(value = {}) {
  const fallback = createEmptyHistoryStats();
  const countedHistoryIds = Array.isArray(value.countedHistoryIds)
    ? value.countedHistoryIds.map(String).filter(Boolean).slice(0, MAX_COUNTED_HISTORY_IDS)
    : [];

  return {
    ...fallback,
    schemaVersion: 1,
    completedCount: Math.max(0, Number(value.completedCount) || 0),
    totalDurationMs: Math.max(0, Number(value.totalDurationMs) || 0),
    totalTextLength: Math.max(0, Number(value.totalTextLength) || 0),
    countedHistoryIds,
  };
}

function updateHistoryStatsForItem(stats, item) {
  const normalizedStats = normalizeHistoryStats(stats);
  const normalizedItem = normalizeHistoryItem(item);

  if (normalizedItem.status !== 'completed') return normalizedStats;
  if (normalizedStats.countedHistoryIds.includes(normalizedItem.id)) return normalizedStats;

  return {
    ...normalizedStats,
    completedCount: normalizedStats.completedCount + 1,
    totalDurationMs: normalizedStats.totalDurationMs + normalizedItem.durationMs,
    totalTextLength: normalizedStats.totalTextLength + normalizedItem.textLength,
    countedHistoryIds: [normalizedItem.id, ...normalizedStats.countedHistoryIds].slice(0, MAX_COUNTED_HISTORY_IDS),
  };
}

function createHistoryStatsFromItems(items = []) {
  return items
    .map(normalizeHistoryItem)
    .reduce((stats, item) => updateHistoryStatsForItem(stats, item), createEmptyHistoryStats());
}

function calculateHistoryStatsForDashboard(stats) {
  const normalizedStats = normalizeHistoryStats(stats);
  const totalMinutes = normalizedStats.totalDurationMs / 60000;
  const averageCharsPerMinute = totalMinutes > 0 ? Math.round(normalizedStats.totalTextLength / totalMinutes) : 0;
  const savedMinutes = Math.max((normalizedStats.totalTextLength / HAND_TYPED_CHARS_PER_MINUTE) - totalMinutes, 0);

  return {
    totalCount: normalizedStats.completedCount,
    completedCount: normalizedStats.completedCount,
    totalDurationMs: normalizedStats.totalDurationMs,
    totalTextLength: normalizedStats.totalTextLength,
    averageCharsPerMinute,
    savedMs: Math.round(savedMinutes * 60000),
  };
}

function upsertHistoryItemWithStats(items, stats, item) {
  const normalized = normalizeHistoryItem(item);
  const remaining = Array.isArray(items)
    ? items.map(normalizeHistoryItem).filter((historyItem) => historyItem.id !== normalized.id)
    : [];

  return {
    items: [normalized, ...remaining].slice(0, MAX_HISTORY_ITEMS),
    stats: updateHistoryStatsForItem(stats, normalized),
  };
}

module.exports = {
  MAX_HISTORY_ITEMS,
  MAX_COUNTED_HISTORY_IDS,
  HAND_TYPED_CHARS_PER_MINUTE,
  normalizeHistoryItem,
  createEmptyHistoryStats,
  normalizeHistoryStats,
  createHistoryStatsFromItems,
  updateHistoryStatsForItem,
  calculateHistoryStatsForDashboard,
  upsertHistoryItemWithStats,
};
