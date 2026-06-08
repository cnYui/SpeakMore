function registerMeetingNoteIpcHandlers({
  ipcMain,
  meetingNoteRepository,
  emitMeetingNotesChanged = () => undefined,
} = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('ipcMain is required');
  }
  if (!meetingNoteRepository || typeof meetingNoteRepository.readMeetingNotes !== 'function') {
    throw new Error('meetingNoteRepository is required');
  }

  function emitChanged(reason, payload = {}) {
    emitMeetingNotesChanged({
      reason,
      ...payload,
      changedAt: new Date().toISOString(),
    });
  }

  ipcMain.handle('meeting-note:list', () => meetingNoteRepository.readMeetingNotes());
  ipcMain.handle('meeting-note:get', (_, id) => {
    const note = meetingNoteRepository.getMeetingNote(String(id || ''));
    return note ? { success: true, data: note } : { success: false, code: 'meeting_note_not_found', data: null };
  });
  ipcMain.handle('meeting-note:upsert', (_, payload = {}) => {
    const note = meetingNoteRepository.upsertNote(payload || {});
    emitChanged('upsert', { note });
    return { success: Boolean(note), data: note };
  });
  ipcMain.handle('meeting-note:delete', (_, id) => {
    const result = meetingNoteRepository.deleteNote(String(id || ''));
    if (result.success) emitChanged('delete', { id });
    return result;
  });
}

module.exports = {
  registerMeetingNoteIpcHandlers,
};
