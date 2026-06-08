const test = require('node:test');
const assert = require('node:assert/strict');
const {
  deleteMeetingNote,
  MEETING_TRANSLATION_TARGETS,
  normalizeMeetingNote,
  upsertMeetingNote,
} = require('./meeting-note-store');

test('normalizeMeetingNote creates safe local meeting note defaults', () => {
  const note = normalizeMeetingNote({
    title: '  Weekly sync  ',
    status: 'unknown',
    source: 'import',
    transcript: ' transcript ',
    summary: ' summary ',
    durationMs: -1,
  });

  assert.match(note.id, /^meeting_/);
  assert.equal(note.title, 'Weekly sync');
  assert.equal(note.status, 'draft');
  assert.equal(note.source, 'import');
  assert.equal(note.transcript, 'transcript');
  assert.equal(note.summary, 'summary');
  assert.equal(note.durationMs, 0);
});

test('normalizeMeetingNote preserves extended meeting translation targets', () => {
  const note = normalizeMeetingNote({
    title: 'Live translation',
    targetLanguage: 'fr',
  });

  assert.equal(MEETING_TRANSLATION_TARGETS.has('zh'), true);
  assert.equal(MEETING_TRANSLATION_TARGETS.has('ko'), true);
  assert.equal(MEETING_TRANSLATION_TARGETS.has('es'), true);
  assert.equal(MEETING_TRANSLATION_TARGETS.has('fr'), true);
  assert.equal(MEETING_TRANSLATION_TARGETS.has('de'), true);
  assert.equal(MEETING_TRANSLATION_TARGETS.has('ru'), true);
  assert.equal(MEETING_TRANSLATION_TARGETS.has('pt'), true);
  assert.equal(note.targetLanguage, 'fr');
  assert.equal(normalizeMeetingNote({ targetLanguage: 'ru' }).targetLanguage, 'ru');
  assert.equal(normalizeMeetingNote({ targetLanguage: 'pt' }).targetLanguage, 'pt');
});

test('normalizeMeetingNote preserves structured meeting result for detail cards', () => {
  const note = normalizeMeetingNote({
    title: 'Planning',
    structuredResult: {
      version: 1,
      scenario: 'project_sync',
      scenarios: ['project_sync'],
      contentLevel: 'medium',
      summary: 'Discussed launch plan.',
      decisions: [{ id: 'decision-1', text: 'Ship beta next week.', source: 'decision' }],
      actionItems: [{ id: 'action-1', text: 'Alice follows up with design.', source: 'action' }],
      scheduleItems: [{ id: 'schedule-1', text: 'Review on Friday.', source: 'schedule' }],
      risks: [{ id: 'risk-1', text: 'Budget is tight.', source: 'risk' }],
      questions: [{ id: 'question-1', text: 'Do we need legal review?', source: 'question' }],
      followUps: [{ id: 'follow-1', text: 'Send notes after meeting.', source: 'follow_up' }],
      topics: [{ id: 'topic-1', title: 'Launch', summary: 'Beta launch planning.', segmentIndexes: [1] }],
      transcriptSegments: [{ index: 1, text: 'Alice: ship beta next week.', contentLevel: 'medium' }],
      source: 'recording',
    },
  });

  assert.equal(note.structuredResult.scenario, 'project_sync');
  assert.equal(note.structuredResult.summary, 'Discussed launch plan.');
  assert.equal(note.structuredResult.decisions[0].text, 'Ship beta next week.');
  assert.equal(note.structuredResult.actionItems[0].text, 'Alice follows up with design.');
  assert.equal(note.structuredResult.transcriptSegments[0].text, 'Alice: ship beta next week.');
});

test('upsertMeetingNote updates existing notes and deleteMeetingNote removes them', () => {
  const created = upsertMeetingNote([], {
    id: 'meeting-1',
    title: 'Planning',
    transcript: 'hello',
  });
  const updated = upsertMeetingNote(created, {
    id: 'meeting-1',
    summary: 'summary',
    status: 'completed',
  });
  const deleted = deleteMeetingNote(updated, 'meeting-1');

  assert.equal(created.length, 1);
  assert.equal(updated.length, 1);
  assert.equal(updated[0].title, 'Planning');
  assert.equal(updated[0].summary, 'summary');
  assert.equal(updated[0].status, 'completed');
  assert.deepEqual(deleted, []);
});
