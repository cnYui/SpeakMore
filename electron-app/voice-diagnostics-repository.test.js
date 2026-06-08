const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createVoiceDiagnosticsRepository,
  normalizeDiagnosticSession,
} = require('./voice-diagnostics-repository');

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

test('voice diagnostics repository keeps only recent 50 sessions', () => {
  const store = createMemoryJsonStore();
  const repository = createVoiceDiagnosticsRepository(store);

  for (let index = 0; index < 55; index += 1) {
    repository.saveDiagnosticSession({
      id: `diag-${index}`,
      audioId: `audio-${index}`,
      mode: 'Dictate',
      status: 'completed',
      startedAt: new Date(2026, 0, 1, 0, index).toISOString(),
      endedAt: new Date(2026, 0, 1, 0, index, 1).toISOString(),
      durationMs: 1000,
    });
  }

  const sessions = repository.readDiagnosticSessions();
  assert.equal(sessions.length, 50);
  assert.equal(sessions[0].id, 'diag-54');
  assert.equal(sessions.at(-1).id, 'diag-5');
});

test('normalizeDiagnosticSession strips speech text fields and arbitrary event payload', () => {
  const session = normalizeDiagnosticSession({
    id: 'diag-1',
    audioId: 'audio-1',
    mode: 'MeetingNotes',
    status: 'error',
    rawText: 'spoken body',
    refinedText: 'final body',
    translationText: 'translation body',
    transcript: 'transcript body',
    summary: 'summary body',
    metrics: { startupMs: 20, firstPartialTranscriptionMs: 35, asrBacklogMs: 120, asrRtf: 0.42, lastTranslationLatencyMs: 380, rawText: 'nope' },
    events: [{
      name: 'first_transcription',
      at: '2026-01-01T00:00:00.000Z',
      offsetMs: 100,
      text: 'must not save',
      detailCode: 'ok',
    }],
    audioQuality: {
      average_rms: 0.12,
      hints: ['low_volume'],
      rawText: 'nope',
    },
  });
  const serialized = JSON.stringify(session);

  assert.equal(session.mode, 'MeetingNotes');
  assert.equal(session.status, 'error');
  assert.equal(session.metrics.startupMs, 20);
  assert.equal(session.metrics.firstPartialTranscriptionMs, 35);
  assert.equal(session.metrics.asrBacklogMs, 120);
  assert.equal(session.metrics.asrRtf, 0.42);
  assert.equal(session.metrics.lastTranslationLatencyMs, 380);
  assert.deepEqual(session.events[0], {
    name: 'first_transcription',
    at: '2026-01-01T00:00:00.000Z',
    offsetMs: 100,
    detailCode: 'ok',
  });
  assert.equal(session.audioQuality.average_rms, 0.12);
  assert.deepEqual(session.audioQuality.hints, ['low_volume']);
  assert.equal(serialized.includes('spoken body'), false);
  assert.equal(serialized.includes('final body'), false);
  assert.equal(serialized.includes('translation body'), false);
  assert.equal(serialized.includes('transcript body'), false);
  assert.equal(serialized.includes('summary body'), false);
  assert.equal(serialized.includes('must not save'), false);
});
