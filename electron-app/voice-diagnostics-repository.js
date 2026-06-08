const crypto = require('crypto');

const MAX_DIAGNOSTIC_SESSIONS = 50;
const MAX_ERROR_DETAIL_LENGTH = 500;
const ALLOWED_STATUSES = new Set(['completed', 'error', 'cancelled']);
const ALLOWED_MODES = new Set(['Dictate', 'Ask', 'Translate', 'CustomCommand', 'MeetingNotes']);

function createDiagnosticId() {
  return `voice_diag_${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')}`;
}

function normalizeString(value, maxLength = 200) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : undefined;
}

function normalizeIsoString(value, fallback = '') {
  const normalized = normalizeString(value, 80);
  if (!normalized) return fallback;
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? new Date(time).toISOString() : fallback;
}

function normalizeEvent(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const event = value;
  const name = normalizeString(event.name, 80);
  if (!name) return null;
  const normalized = {
    name,
    at: normalizeIsoString(event.at, new Date().toISOString()),
    offsetMs: normalizeNumber(event.offsetMs) ?? 0,
  };
  const status = normalizeString(event.status, 40);
  if (status) normalized.status = status;
  const detailCode = normalizeString(event.detailCode, 120);
  if (detailCode) normalized.detailCode = detailCode;
  return normalized;
}

function normalizeMetrics(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const metricKeys = [
    'startupMs',
    'readyMs',
    'socketMs',
    'microphoneMs',
    'parametersMs',
    'firstTranscriptionMs',
    'firstPartialTranscriptionMs',
    'firstStableTranscriptionMs',
    'firstTranslationPendingMs',
    'firstPreviewTranslationMs',
    'firstCommitTranslationMs',
    'firstTranslationMs',
    'lastAsrLatencyMs',
    'asrBacklogMs',
    'asrRtf',
    'lastTranslationLatencyMs',
    'finalRefineMs',
  ];
  return metricKeys.reduce((next, key) => {
    const metric = normalizeNumber(source[key]);
    if (metric !== undefined) next[key] = metric;
    return next;
  }, {});
}

function normalizeAudioQuality(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value;
  const numericKeys = [
    'average_rms',
    'peak',
    'clipping_ratio',
    'speech_frame_ratio',
    'low_volume_ratio',
    'estimated_noise_floor',
  ];
  const next = numericKeys.reduce((quality, key) => {
    const metric = normalizeNumber(source[key]);
    if (metric !== undefined) quality[key] = metric;
    return quality;
  }, {});
  if (Array.isArray(source.hints)) {
    const hints = source.hints
      .map((item) => normalizeString(item, 80))
      .filter(Boolean)
      .slice(0, 12);
    if (hints.length) next.hints = hints;
  }
  return Object.keys(next).length ? next : null;
}

function normalizeDiagnosticSession(value = {}, fallback = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const base = fallback && typeof fallback === 'object' ? fallback : {};
  const now = new Date().toISOString();
  const startedAt = normalizeIsoString(source.startedAt ?? base.startedAt, now);
  const endedAt = normalizeIsoString(source.endedAt ?? base.endedAt, now);
  const mode = ALLOWED_MODES.has(source.mode) ? source.mode : ALLOWED_MODES.has(base.mode) ? base.mode : 'Dictate';
  const status = ALLOWED_STATUSES.has(source.status) ? source.status : ALLOWED_STATUSES.has(base.status) ? base.status : 'error';
  const events = (Array.isArray(source.events) ? source.events : Array.isArray(base.events) ? base.events : [])
    .map((event) => normalizeEvent(event))
    .filter(Boolean)
    .slice(-120);
  const audioQuality = normalizeAudioQuality(source.audioQuality ?? base.audioQuality);

  return {
    id: normalizeString(source.id ?? base.id, 120) || createDiagnosticId(),
    audioId: normalizeString(source.audioId ?? base.audioId, 120),
    mode,
    status,
    startedAt,
    endedAt,
    durationMs: normalizeNumber(source.durationMs ?? base.durationMs) ?? Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
    events,
    metrics: normalizeMetrics(source.metrics ?? base.metrics),
    ...(audioQuality ? { audioQuality } : {}),
    ...(normalizeString(source.errorCode ?? base.errorCode, 120) ? { errorCode: normalizeString(source.errorCode ?? base.errorCode, 120) } : {}),
    ...(normalizeString(source.errorDetail ?? base.errorDetail, MAX_ERROR_DETAIL_LENGTH)
      ? { errorDetail: normalizeString(source.errorDetail ?? base.errorDetail, MAX_ERROR_DETAIL_LENGTH) }
      : {}),
  };
}

function normalizeDiagnosticSessions(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((item) => normalizeDiagnosticSession(item))
    .sort((a, b) => String(b.endedAt || b.startedAt).localeCompare(String(a.endedAt || a.startedAt)))
    .slice(0, MAX_DIAGNOSTIC_SESSIONS);
}

function createVoiceDiagnosticsRepository({
  readJsonFile,
  writeJsonFile,
  fileName = 'voice-diagnostics.json',
} = {}) {
  if (typeof readJsonFile !== 'function') {
    throw new Error('readJsonFile is required');
  }
  if (typeof writeJsonFile !== 'function') {
    throw new Error('writeJsonFile is required');
  }

  function readDiagnosticSessions() {
    return normalizeDiagnosticSessions(readJsonFile(fileName, []));
  }

  function writeDiagnosticSessions(sessions) {
    return writeJsonFile(fileName, normalizeDiagnosticSessions(sessions));
  }

  function saveDiagnosticSession(payload = {}) {
    const sessions = readDiagnosticSessions();
    const id = normalizeString(payload.id, 120);
    const audioId = normalizeString(payload.audioId, 120);
    const existing = sessions.find((session) => (id && session.id === id) || (audioId && session.audioId === audioId));
    const nextSession = normalizeDiagnosticSession(payload, existing || {});
    const nextSessions = existing
      ? sessions.map((session) => (session.id === existing.id ? nextSession : session))
      : [nextSession, ...sessions];
    writeDiagnosticSessions(nextSessions);
    return nextSession;
  }

  function clearDiagnosticSessions() {
    writeDiagnosticSessions([]);
    return { success: true };
  }

  return {
    readDiagnosticSessions,
    writeDiagnosticSessions,
    saveDiagnosticSession,
    clearDiagnosticSessions,
  };
}

module.exports = {
  MAX_DIAGNOSTIC_SESSIONS,
  normalizeDiagnosticSession,
  normalizeDiagnosticSessions,
  createVoiceDiagnosticsRepository,
};
