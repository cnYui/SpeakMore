const {
  MAX_HISTORY_ITEMS,
  normalizeHistoryItem,
  normalizeHistoryStats,
  createHistoryStatsFromItems,
  calculateHistoryStatsForDashboard,
  upsertHistoryItemWithStats,
} = require('./history-stats-store');

function createHistoryRepository({
  readJsonFile,
  writeJsonFile,
  historyFileName = 'history.json',
  statsFileName = 'history-stats.json',
} = {}) {
  if (typeof readJsonFile !== 'function') {
    throw new Error('readJsonFile is required');
  }
  if (typeof writeJsonFile !== 'function') {
    throw new Error('writeJsonFile is required');
  }

  function readHistoryItems() {
    const value = readJsonFile(historyFileName, []);
    if (!Array.isArray(value)) return [];
    return value.map(normalizeHistoryItem).slice(0, MAX_HISTORY_ITEMS);
  }

  function writeHistoryItems(items) {
    return writeJsonFile(historyFileName, items.map(normalizeHistoryItem).slice(0, MAX_HISTORY_ITEMS));
  }

  function isPersistedHistoryStats(value) {
    return Boolean(value)
      && typeof value === 'object'
      && !Array.isArray(value)
      && Array.isArray(value.countedHistoryIds);
  }

  function readHistoryStats() {
    const value = readJsonFile(statsFileName, null);
    if (isPersistedHistoryStats(value)) return normalizeHistoryStats(value);

    const migrated = createHistoryStatsFromItems(readHistoryItems());
    writeHistoryStats(migrated);
    return migrated;
  }

  function writeHistoryStats(stats) {
    return writeJsonFile(statsFileName, normalizeHistoryStats(stats));
  }

  function readHistoryStatsForDashboard() {
    return calculateHistoryStatsForDashboard(readHistoryStats());
  }

  function upsertHistoryItem(item) {
    const result = upsertHistoryItemWithStats(readHistoryItems(), readHistoryStats(), item);
    writeHistoryItems(result.items);
    writeHistoryStats(result.stats);
    return result.items[0];
  }

  return {
    readHistoryItems,
    writeHistoryItems,
    readHistoryStats,
    writeHistoryStats,
    readHistoryStatsForDashboard,
    upsertHistoryItem,
  };
}

module.exports = {
  createHistoryRepository,
};
