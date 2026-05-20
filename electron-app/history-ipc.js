const { MAX_HISTORY_ITEMS } = require('./history-stats-store');

function registerHistoryIpcHandlers({
  ipcMain,
  getDeviceId = () => '',
  readHistoryItems,
  writeHistoryItems,
  readHistoryStats,
  readHistoryStatsForDashboard,
  upsertHistoryItem,
  normalizeHistoryItem = (value) => value,
} = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('ipcMain is required');
  }
  if (typeof readHistoryItems !== 'function' || typeof writeHistoryItems !== 'function') {
    throw new Error('readHistoryItems and writeHistoryItems are required');
  }
  if (typeof readHistoryStats !== 'function' || typeof readHistoryStatsForDashboard !== 'function') {
    throw new Error('history stats readers are required');
  }
  if (typeof upsertHistoryItem !== 'function') {
    throw new Error('upsertHistoryItem is required');
  }

  ipcMain.handle('db:get-device-id', () => getDeviceId());
  ipcMain.handle('db:history-list', (_, cursor, limit) => {
    const items = readHistoryItems();
    if (cursor !== undefined || limit !== undefined) {
      const start = Math.max(0, Number(cursor) || 0);
      const size = Math.max(1, Number(limit) || items.length || 1);
      const data = items.slice(start, start + size);
      return { data, total: items.length, hasMore: start + size < items.length };
    }
    return items;
  });
  ipcMain.handle('db:history-latest-id', () => {
    const latest = readHistoryItems()[0];
    return latest ? { success: true, id: latest.id } : { success: false, id: '' };
  });
  ipcMain.handle('db:history-latest-id-for-error-tracking', () => {
    const latest = readHistoryItems()[0];
    return latest ? { success: true, id: latest.id } : { success: false, reason: 'empty' };
  });
  ipcMain.handle('db:history-latest', () => {
    const latest = readHistoryItems()[0];
    return latest ? { success: true, data: latest } : { success: false, data: null, error: 'empty' };
  });
  ipcMain.handle('db:history-get', (_, id) => {
    const item = readHistoryItems().find((historyItem) => historyItem.id === id);
    return item ? { success: true, data: item } : { success: false, error: 'not_found' };
  });
  ipcMain.handle('db:history-clear', () => {
    readHistoryStats();
    writeHistoryItems([]);
    return { success: true };
  });
  ipcMain.handle('db:history-delete', (_, id) => {
    readHistoryStats();
    writeHistoryItems(readHistoryItems().filter((historyItem) => historyItem.id !== id));
    return { success: true };
  });
  ipcMain.handle('db:history-delete-by-duration', () => ({ success: true }));
  ipcMain.handle('db:history-save-audio', () => ({ success: true }));
  ipcMain.handle('db:history-upsert', (_, history) => ({ success: true, data: upsertHistoryItem(history || {}) }));
  ipcMain.handle('db:history-upsert-client-metadata', () => ({ success: true }));
  ipcMain.handle('db:history-trigger-history-cleanup', () => ({ success: true }));
  ipcMain.handle('db:history-trigger-disk-cleanup', () => ({ success: true }));
  ipcMain.handle('db:history-stats', () => readHistoryStatsForDashboard());
  ipcMain.handle('test:get-latest-history', () => {
    const latest = readHistoryItems()[0] || null;
    return { success: Boolean(latest), data: latest };
  });
  ipcMain.handle('test:generate-test-records', (_, payload = {}) => {
    const count = Math.max(1, Number(payload?.count) || 3);
    const records = Array.from({ length: count }, (_, index) => normalizeHistoryItem({
      id: `test-record-${Date.now()}-${index}`,
      mode: 'Dictate',
      status: 'completed',
      rawText: `test raw ${index + 1}`,
      refinedText: `test refined ${index + 1}`,
      durationMs: 1000 * (index + 1),
      textLength: 16,
      isTestRecord: true,
    }));
    writeHistoryItems([...records, ...readHistoryItems()].slice(0, MAX_HISTORY_ITEMS));
    return { success: true, count: records.length };
  });
  ipcMain.handle('test:clear-test-records', () => {
    writeHistoryItems(readHistoryItems().filter((item) => !item.isTestRecord));
    return { success: true };
  });
}

module.exports = {
  registerHistoryIpcHandlers,
};
