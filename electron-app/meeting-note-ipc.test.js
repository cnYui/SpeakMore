const test = require('node:test');
const assert = require('node:assert/strict');
const { registerMeetingNoteIpcHandlers } = require('./meeting-note-ipc');

function createFakeIpcMain() {
  const handles = new Map();
  return {
    handle(channel, handler) {
      handles.set(channel, handler);
    },
    invoke(channel, ...args) {
      const handler = handles.get(channel);
      if (!handler) throw new Error(`missing handler: ${channel}`);
      return handler({}, ...args);
    },
  };
}

test('registerMeetingNoteIpcHandlers wires local note CRUD channels', async () => {
  const ipcMain = createFakeIpcMain();
  const changes = [];
  let notes = [{ id: 'meeting-1', title: 'Planning' }];

  registerMeetingNoteIpcHandlers({
    ipcMain,
    meetingNoteRepository: {
      readMeetingNotes: () => notes,
      getMeetingNote: (id) => notes.find((note) => note.id === id) || null,
      upsertNote: (payload) => {
        notes = [{ ...notes[0], ...payload }];
        return notes[0];
      },
      deleteNote: (id) => {
        notes = notes.filter((note) => note.id !== id);
        return { success: true };
      },
    },
    emitMeetingNotesChanged: (payload) => changes.push(payload),
  });

  assert.deepEqual(await ipcMain.invoke('meeting-note:list'), [{ id: 'meeting-1', title: 'Planning' }]);
  assert.deepEqual(await ipcMain.invoke('meeting-note:get', 'meeting-1'), {
    success: true,
    data: { id: 'meeting-1', title: 'Planning' },
  });
  assert.deepEqual(await ipcMain.invoke('meeting-note:get', 'missing'), {
    success: false,
    code: 'meeting_note_not_found',
    data: null,
  });
  assert.deepEqual(await ipcMain.invoke('meeting-note:upsert', { id: 'meeting-1', summary: 'Done' }), {
    success: true,
    data: { id: 'meeting-1', title: 'Planning', summary: 'Done' },
  });
  assert.equal(changes[0].reason, 'upsert');
  assert.deepEqual(await ipcMain.invoke('meeting-note:delete', 'meeting-1'), { success: true });
  assert.equal(changes[1].reason, 'delete');
});
