const test = require('node:test');
const assert = require('node:assert/strict');
const { registerShortcutCommandIpcHandlers } = require('./shortcut-command-ipc');

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

test('registerShortcutCommandIpcHandlers wires list upsert delete and status channels', async () => {
  const ipcMain = createFakeIpcMain();
  const changes = [];
  let commands = [{ id: 'voice_input', enabled: true }];
  let registrations = 0;

  registerShortcutCommandIpcHandlers({
    ipcMain,
    shortcutCommandRepository: {
      readShortcutCommands: () => commands,
      upsertCommand: (payload) => {
        commands = [{ ...commands[0], ...payload }];
        return commands[0];
      },
      deleteCommand: (id) => {
        commands = commands.filter((command) => command.id !== id);
        return { success: true, commands };
      },
    },
    shortcutCommandRegistrar: {
      registerAll: () => {
        registrations += 1;
        return { voice_input: { status: 'fixed' } };
      },
      getRegistrationStatus: () => ({ voice_input: { status: 'fixed' } }),
    },
    emitShortcutCommandsChanged: (payload) => changes.push(payload),
  });

  assert.deepEqual(await ipcMain.invoke('shortcut-command:list'), [{ id: 'voice_input', enabled: true }]);
  assert.deepEqual(await ipcMain.invoke('shortcut-command:registration-status'), { voice_input: { status: 'fixed' } });
  assert.deepEqual(await ipcMain.invoke('shortcut-command:upsert', { id: 'voice_input', enabled: false }), {
    success: true,
    data: { id: 'voice_input', enabled: false },
  });
  assert.equal(registrations, 1);
  assert.equal(changes[0].reason, 'upsert');

  assert.deepEqual(await ipcMain.invoke('shortcut-command:delete', 'voice_input'), { success: true });
  assert.equal(registrations, 2);
  assert.equal(changes[1].reason, 'delete');
});
