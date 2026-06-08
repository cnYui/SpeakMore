const test = require('node:test');
const assert = require('node:assert/strict');
const { registerVoiceDiagnosticsIpcHandlers } = require('./voice-diagnostics-ipc');

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

test('registerVoiceDiagnosticsIpcHandlers wires list save and clear channels', async () => {
  const ipcMain = createFakeIpcMain();
  const changes = [];
  let sessions = [{ id: 'diag-1', audioId: 'audio-1', status: 'completed' }];

  registerVoiceDiagnosticsIpcHandlers({
    ipcMain,
    voiceDiagnosticsRepository: {
      readDiagnosticSessions: () => sessions,
      saveDiagnosticSession: (payload) => {
        sessions = [{ ...payload, id: payload.id || 'diag-2' }, ...sessions];
        return sessions[0];
      },
      clearDiagnosticSessions: () => {
        sessions = [];
        return { success: true };
      },
    },
    emitVoiceDiagnosticsChanged: (payload) => changes.push(payload),
  });

  assert.deepEqual(await ipcMain.invoke('voice-diagnostics:list'), [{ id: 'diag-1', audioId: 'audio-1', status: 'completed' }]);
  assert.deepEqual(await ipcMain.invoke('voice-diagnostics:save', { id: 'diag-2', audioId: 'audio-2', status: 'error' }), {
    success: true,
    data: { id: 'diag-2', audioId: 'audio-2', status: 'error' },
  });
  assert.equal(changes[0].reason, 'save');
  assert.deepEqual(await ipcMain.invoke('voice-diagnostics:clear'), { success: true });
  assert.equal(changes[1].reason, 'clear');
});
