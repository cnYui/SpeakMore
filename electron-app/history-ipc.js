const { MAX_HISTORY_ITEMS } = require('./history-stats-store');
const { normalizeVoiceMode } = require('./voice-flow-form-data');
const path = require('path');

const HISTORY_AUDIO_DIR_NAME = 'history-audio';

function sanitizeHistoryAudioId(id) {
  return String(id || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
}

function resolveHistoryAudioDir(localDataDir) {
  const baseDir = typeof localDataDir === 'function' ? String(localDataDir() || '') : '';
  return baseDir ? path.resolve(baseDir, HISTORY_AUDIO_DIR_NAME) : '';
}

function resolveHistoryAudioPath(id, localDataDir) {
  const safeId = sanitizeHistoryAudioId(id);
  const audioDir = resolveHistoryAudioDir(localDataDir);
  if (!safeId || !audioDir) return '';
  return path.resolve(audioDir, `${safeId}.wav`);
}

function decodeAudioPayload(payload = {}) {
  const candidate = payload.wavBase64 || payload.audioBase64 || payload.audio || payload.data || '';
  if (Buffer.isBuffer(candidate)) return candidate;
  if (candidate instanceof ArrayBuffer) return Buffer.from(candidate);
  if (ArrayBuffer.isView(candidate)) {
    return Buffer.from(candidate.buffer, candidate.byteOffset, candidate.byteLength);
  }
  if (candidate && candidate.type === 'Buffer' && Array.isArray(candidate.data)) {
    return Buffer.from(candidate.data);
  }
  if (typeof candidate !== 'string') return null;
  const base64 = candidate.includes(',') ? candidate.split(',').pop() : candidate;
  const buffer = Buffer.from(String(base64 || ''), 'base64');
  return buffer.length > 0 ? buffer : null;
}

function createHistoryAudioAccess({ fs, localDataDir } = {}) {
  const hasFs = fs
    && typeof fs.mkdirSync === 'function'
    && typeof fs.writeFileSync === 'function'
    && typeof fs.readFileSync === 'function';

  function write(id, payload = {}) {
    if (!hasFs) return { success: false, code: 'history_audio_unavailable' };
    const filePath = resolveHistoryAudioPath(id, localDataDir);
    const audioDir = resolveHistoryAudioDir(localDataDir);
    const buffer = decodeAudioPayload(payload);
    if (!filePath || !audioDir || !buffer) return { success: false, code: 'history_audio_invalid' };

    fs.mkdirSync(audioDir, { recursive: true });
    fs.writeFileSync(filePath, buffer);
    return { success: true };
  }

  function read(id) {
    if (!hasFs || typeof fs.existsSync !== 'function') return null;
    const filePath = resolveHistoryAudioPath(id, localDataDir);
    if (!filePath || !fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath);
  }

  function exists(id) {
    if (!hasFs || typeof fs.existsSync !== 'function') return false;
    const filePath = resolveHistoryAudioPath(id, localDataDir);
    return Boolean(filePath && fs.existsSync(filePath));
  }

  function remove(id) {
    if (!fs || typeof fs.existsSync !== 'function' || typeof fs.unlinkSync !== 'function') return;
    const filePath = resolveHistoryAudioPath(id, localDataDir);
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  function clear() {
    if (!fs || typeof fs.existsSync !== 'function' || typeof fs.readdirSync !== 'function' || typeof fs.unlinkSync !== 'function') return;
    const audioDir = resolveHistoryAudioDir(localDataDir);
    if (!audioDir || !fs.existsSync(audioDir)) return;
    for (const name of fs.readdirSync(audioDir)) {
      if (!/\.wav$/i.test(name)) continue;
      const filePath = path.resolve(audioDir, name);
      if (path.dirname(filePath) === audioDir) fs.unlinkSync(filePath);
    }
  }

  return { write, read, exists, remove, clear };
}

function isRetrySupported(item = {}) {
  return item.status === 'error' && (item.mode === 'Dictate' || item.mode === 'Translate');
}

function extractRetryResultText(result = {}, fallbackRawText = '') {
  const data = result.data && typeof result.data === 'object' ? result.data : {};
  const refinedText = String(
    result.refine_text
    || result.refined_text
    || data.refine_text
    || data.refined_text
    || '',
  );
  const rawText = String(result.user_prompt || data.user_prompt || fallbackRawText || '');
  return { refinedText, rawText };
}

function extractRetryError(result = {}) {
  return String(result.detail || result.error || result.message || result.code || '重试失败');
}

function registerHistoryIpcHandlers({
  buildCurrentLlmRequestConfig = () => ({}),
  callTextRefineBackend = null,
  callVoiceFlowBackend = null,
  fs = null,
  ipcMain,
  localDataDir = () => '',
  getDeviceId = () => '',
  readHistoryItems,
  writeHistoryItems,
  readHistoryStats,
  readHistoryStatsForDashboard,
  readLocalSettings = () => ({}),
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

  const historyAudio = createHistoryAudioAccess({ fs, localDataDir });

  function updateHistoryItem(id, updater) {
    let updated = null;
    const nextItems = readHistoryItems().map((item) => {
      if (item.id !== id) return item;
      updated = normalizeHistoryItem(updater(item));
      return updated;
    });
    if (!updated) return null;
    writeHistoryItems(nextItems);
    return updated;
  }

  function buildRetryParameters(item) {
    const settings = readLocalSettings() || {};
    const parameters = { llm: buildCurrentLlmRequestConfig(settings) };
    if (item.mode === 'Translate' && settings.translationTargetLanguage) {
      parameters.output_language = settings.translationTargetLanguage;
    }
    return parameters;
  }

  function markRetryFailure(item, result) {
    const hasRetryAudio = historyAudio.exists(item.id);
    return updateHistoryItem(item.id, (current) => ({
      ...current,
      status: 'error',
      errorCode: result?.code || current.errorCode || 'unknown',
      errorMessage: extractRetryError(result),
      hasRetryAudio,
      retryable: isRetrySupported(current) && Boolean(hasRetryAudio || current.rawText),
    }));
  }

  function markRetrySuccess(item, result) {
    const { refinedText, rawText } = extractRetryResultText(result, item.rawText);
    const finalText = refinedText || rawText;
    const saved = upsertHistoryItem({
      ...item,
      status: 'completed',
      rawText,
      refinedText: finalText,
      errorCode: undefined,
      errorMessage: undefined,
      hasRetryAudio: false,
      retryable: false,
      textLength: finalText.trim().length,
    });
    historyAudio.remove(item.id);
    return saved;
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
    historyAudio.clear();
    return { success: true };
  });
  ipcMain.handle('db:history-delete', (_, id) => {
    readHistoryStats();
    writeHistoryItems(readHistoryItems().filter((historyItem) => historyItem.id !== id));
    historyAudio.remove(id);
    return { success: true };
  });
  ipcMain.handle('db:history-delete-by-duration', () => ({ success: true }));
  ipcMain.handle('db:history-save-audio', (_, payload = {}) => {
    const id = payload?.id || payload?.historyId || '';
    const item = readHistoryItems().find((historyItem) => historyItem.id === id);
    if (!item || !isRetrySupported(item)) return { success: false, code: 'history_not_retryable' };

    const saved = historyAudio.write(id, payload);
    if (!saved.success) return saved;

    const updated = updateHistoryItem(id, (current) => ({
      ...current,
      hasRetryAudio: true,
      retryable: true,
    }));
    return { success: true, data: updated };
  });
  ipcMain.handle('db:history-retry', async (_, id) => {
    const item = readHistoryItems().find((historyItem) => historyItem.id === id);
    if (!item) return { success: false, code: 'history_not_found', detail: '历史记录不存在' };
    if (!isRetrySupported(item)) return { success: false, code: 'history_retry_unsupported', detail: '该记录不支持重试' };

    const parameters = buildRetryParameters(item);
    const audioBuffer = historyAudio.read(item.id);
    let result = null;

    if (audioBuffer && callVoiceFlowBackend) {
      result = await callVoiceFlowBackend({
        audioId: item.id,
        audioBuffer,
        mimeType: 'audio/wav',
        mode: normalizeVoiceMode(item.mode),
        audioContext: { source: 'history_retry' },
        parameters,
        isRetry: true,
      });
    } else if (item.rawText && callTextRefineBackend) {
      result = await callTextRefineBackend({
        text: item.rawText,
        mode: normalizeVoiceMode(item.mode),
        audioContext: { source: 'history_retry' },
        parameters,
        isRetry: true,
      });
    } else {
      return { success: false, code: 'history_retry_source_missing', detail: '没有可用于重试的音频或原始文本' };
    }

    if (!result?.success) {
      const updated = markRetryFailure(item, result || {});
      return {
        success: false,
        code: result?.code || 'history_retry_failed',
        detail: extractRetryError(result || {}),
        data: updated,
      };
    }

    return { success: true, data: markRetrySuccess(item, result) };
  });
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
