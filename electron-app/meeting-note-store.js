const crypto = require('crypto');
const MEETING_LIVE_TARGET_LANGUAGES = require('../shared/meeting-live-target-languages.json');
const MEETING_NOTE_TARGET_LANGUAGES = require('../shared/meeting-note-target-languages.json');

const MEETING_NOTE_STATUSES = new Set(['draft', 'recording', 'processing', 'completed', 'error']);
const MEETING_NOTE_SOURCES = new Set(['manual', 'recording', 'import']);
const MEETING_AUDIO_SOURCES = new Set(['microphone', 'system', 'microphone_system']);
const MEETING_TRANSLATION_TARGETS = new Set([
  'off',
  ...MEETING_LIVE_TARGET_LANGUAGES.map((language) => language.id),
  ...MEETING_NOTE_TARGET_LANGUAGES.map((language) => language.id),
]);
const MAX_MEETING_TITLE_LENGTH = 120;
const MAX_MEETING_TEXT_LENGTH = 2_000_000;
const MAX_STRUCTURED_TEXT_LENGTH = 20000;
const MAX_STRUCTURED_ITEMS = 200;

function createMeetingNoteId() {
  return `meeting_${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')}`;
}

function normalizeText(value, maxLength = MAX_MEETING_TEXT_LENGTH) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeOptionalString(value, maxLength = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeStructuredItem(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value;
  const text = normalizeOptionalString(source.text, MAX_STRUCTURED_TEXT_LENGTH);
  if (!text) return null;
  const item = { text };
  const id = normalizeOptionalString(source.id, 120);
  const itemSource = normalizeOptionalString(source.source, 240);
  if (id) item.id = id;
  if (itemSource) item.source = itemSource;
  return item;
}

function normalizeStructuredTopic(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value;
  const title = normalizeOptionalString(source.title, 240);
  const summary = normalizeOptionalString(source.summary, MAX_STRUCTURED_TEXT_LENGTH);
  if (!title && !summary) return null;
  return {
    ...(normalizeOptionalString(source.id, 120) ? { id: normalizeOptionalString(source.id, 120) } : {}),
    title,
    summary,
    segmentIndexes: Array.isArray(source.segmentIndexes)
      ? source.segmentIndexes.map((item) => Math.max(0, Number(item) || 0)).filter((item) => item > 0).slice(0, MAX_STRUCTURED_ITEMS)
      : [],
  };
}

function normalizeTranscriptSegment(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value;
  const text = normalizeOptionalString(source.text, MAX_STRUCTURED_TEXT_LENGTH);
  if (!text) return null;
  const segment = {
    index: Math.max(1, Number(source.index) || 1),
    text,
  };
  const contentLevel = normalizeOptionalString(source.contentLevel, 80);
  if (contentLevel) segment.contentLevel = contentLevel;
  return segment;
}

function normalizeStructuredItems(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => normalizeStructuredItem(item))
    .filter(Boolean)
    .slice(0, MAX_STRUCTURED_ITEMS);
}

function normalizeMeetingStructuredResult(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value;
  return {
    version: Math.max(1, Number(source.version) || 1),
    scenario: normalizeOptionalString(source.scenario, 240) || 'general_meeting_or_voice_note',
    scenarios: Array.isArray(source.scenarios)
      ? source.scenarios.map((item) => normalizeOptionalString(item, 120)).filter(Boolean).slice(0, 20)
      : [],
    contentLevel: normalizeOptionalString(source.contentLevel, 80) || 'limited',
    summary: normalizeOptionalString(source.summary, MAX_STRUCTURED_TEXT_LENGTH),
    topics: (Array.isArray(source.topics) ? source.topics : [])
      .map((item) => normalizeStructuredTopic(item))
      .filter(Boolean)
      .slice(0, MAX_STRUCTURED_ITEMS),
    decisions: normalizeStructuredItems(source.decisions),
    actionItems: normalizeStructuredItems(source.actionItems),
    scheduleItems: normalizeStructuredItems(source.scheduleItems),
    risks: normalizeStructuredItems(source.risks),
    questions: normalizeStructuredItems(source.questions),
    followUps: normalizeStructuredItems(source.followUps),
    transcriptSegments: (Array.isArray(source.transcriptSegments) ? source.transcriptSegments : [])
      .map((item) => normalizeTranscriptSegment(item))
      .filter(Boolean)
      .slice(0, MAX_STRUCTURED_ITEMS),
    source: normalizeOptionalString(source.source, 80) || 'unknown',
    partialSuccess: source.partialSuccess === true,
    summaryError: normalizeOptionalString(source.summaryError, 1000),
  };
}

function normalizeMeetingNote(value = {}, fallback = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const base = fallback && typeof fallback === 'object' ? fallback : {};
  const now = new Date().toISOString();
  const title = normalizeOptionalString(source.title ?? base.title, MAX_MEETING_TITLE_LENGTH);
  const transcript = normalizeText(source.transcript ?? base.transcript);
  const translationText = normalizeText(source.translationText ?? base.translationText);
  const summary = normalizeText(source.summary ?? base.summary);
  const status = MEETING_NOTE_STATUSES.has(source.status) ? source.status : base.status || 'draft';
  const sourceType = MEETING_NOTE_SOURCES.has(source.source) ? source.source : base.source || 'manual';
  const audioSource = MEETING_AUDIO_SOURCES.has(source.audioSource) ? source.audioSource : base.audioSource || 'microphone';
  const targetLanguage = MEETING_TRANSLATION_TARGETS.has(source.targetLanguage) ? source.targetLanguage : base.targetLanguage || 'off';
  const importFile = source.importFile && typeof source.importFile === 'object' && !Array.isArray(source.importFile)
    ? source.importFile
    : base.importFile || null;
  const structuredResult = normalizeMeetingStructuredResult(source.structuredResult ?? base.structuredResult);

  return {
    id: typeof source.id === 'string' && source.id.trim() ? source.id.trim() : base.id || createMeetingNoteId(),
    title: title || 'Untitled Meeting',
    status,
    source: sourceType,
    transcript,
    translationText,
    summary,
    structuredResult,
    audioSource,
    targetLanguage,
    showOriginal: typeof source.showOriginal === 'boolean' ? source.showOriginal : base.showOriginal !== false,
    showTranslation: typeof source.showTranslation === 'boolean' ? source.showTranslation : base.showTranslation !== false,
    durationMs: Math.max(0, Number(source.durationMs ?? base.durationMs) || 0),
    importFile: importFile ? {
      name: normalizeOptionalString(importFile.name, 240),
      size: Math.max(0, Number(importFile.size) || 0),
      type: normalizeOptionalString(importFile.type, 120),
    } : null,
    createdAt: normalizeOptionalString(source.createdAt ?? base.createdAt, 80) || now,
    updatedAt: normalizeOptionalString(source.updatedAt ?? base.updatedAt, 80) || now,
    error: normalizeOptionalString(source.error ?? base.error, 1000),
  };
}

function normalizeMeetingNotes(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((item) => normalizeMeetingNote(item))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function upsertMeetingNote(notes, payload = {}) {
  const existing = normalizeMeetingNotes(notes);
  const id = typeof payload.id === 'string' && payload.id.trim() ? payload.id.trim() : '';
  const current = id ? existing.find((note) => note.id === id) : null;
  const nextNote = normalizeMeetingNote({
    ...current,
    ...payload,
    id: current?.id || id || undefined,
    updatedAt: new Date().toISOString(),
  }, current || {});
  const nextNotes = current
    ? existing.map((note) => (note.id === current.id ? nextNote : note))
    : [nextNote, ...existing];
  return normalizeMeetingNotes(nextNotes);
}

function deleteMeetingNote(notes, id) {
  return normalizeMeetingNotes(notes).filter((note) => note.id !== id);
}

module.exports = {
  MEETING_NOTE_STATUSES,
  MEETING_NOTE_SOURCES,
  MEETING_AUDIO_SOURCES,
  MEETING_TRANSLATION_TARGETS,
  normalizeMeetingNote,
  normalizeMeetingNotes,
  normalizeMeetingStructuredResult,
  upsertMeetingNote,
  deleteMeetingNote,
};
