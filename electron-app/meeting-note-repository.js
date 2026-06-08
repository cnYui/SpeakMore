const {
  deleteMeetingNote,
  normalizeMeetingNotes,
  upsertMeetingNote,
} = require('./meeting-note-store');

function createMeetingNoteRepository({
  readJsonFile,
  writeJsonFile,
  fileName = 'meeting-notes.json',
} = {}) {
  if (typeof readJsonFile !== 'function') {
    throw new Error('readJsonFile is required');
  }
  if (typeof writeJsonFile !== 'function') {
    throw new Error('writeJsonFile is required');
  }

  function readMeetingNotes() {
    return normalizeMeetingNotes(readJsonFile(fileName, []));
  }

  function writeMeetingNotes(notes) {
    return writeJsonFile(fileName, normalizeMeetingNotes(notes));
  }

  function getMeetingNote(id) {
    return readMeetingNotes().find((note) => note.id === id) || null;
  }

  function upsertNote(payload = {}) {
    const notes = upsertMeetingNote(readMeetingNotes(), payload);
    writeMeetingNotes(notes);
    const requestedId = typeof payload.id === 'string' ? payload.id : '';
    return requestedId ? getMeetingNote(requestedId) || notes[0] || null : notes[0] || null;
  }

  function deleteNote(id) {
    const before = readMeetingNotes();
    const next = deleteMeetingNote(before, id);
    writeMeetingNotes(next);
    return { success: next.length !== before.length };
  }

  return {
    readMeetingNotes,
    writeMeetingNotes,
    getMeetingNote,
    upsertNote,
    deleteNote,
  };
}

module.exports = {
  createMeetingNoteRepository,
};
