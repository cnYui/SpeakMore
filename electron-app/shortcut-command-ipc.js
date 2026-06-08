function registerShortcutCommandIpcHandlers({
  ipcMain,
  shortcutCommandRepository,
  shortcutCommandRegistrar,
  emitShortcutCommandsChanged = () => undefined,
} = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('ipcMain is required');
  }
  if (!shortcutCommandRepository || typeof shortcutCommandRepository.readShortcutCommands !== 'function') {
    throw new Error('shortcutCommandRepository is required');
  }

  function refreshRegistration() {
    return shortcutCommandRegistrar?.registerAll?.() || {};
  }

  function emitChanged(reason, payload = {}) {
    emitShortcutCommandsChanged({
      reason,
      ...payload,
      registrationStatus: shortcutCommandRegistrar?.getRegistrationStatus?.() || {},
    });
  }

  ipcMain.handle('shortcut-command:list', () => shortcutCommandRepository.readShortcutCommands());
  ipcMain.handle('shortcut-command:registration-status', () => shortcutCommandRegistrar?.getRegistrationStatus?.() || {});
  ipcMain.handle('shortcut-command:upsert', (_, payload = {}) => {
    const command = shortcutCommandRepository.upsertCommand(payload || {});
    refreshRegistration();
    emitChanged('upsert', { command });
    return { success: Boolean(command), data: command };
  });
  ipcMain.handle('shortcut-command:delete', (_, id) => {
    const result = shortcutCommandRepository.deleteCommand(String(id || ''));
    refreshRegistration();
    if (result.success) emitChanged('delete', { id });
    return { success: result.success };
  });
}

module.exports = {
  registerShortcutCommandIpcHandlers,
};
