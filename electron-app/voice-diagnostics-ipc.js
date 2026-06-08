function registerVoiceDiagnosticsIpcHandlers({
  ipcMain,
  voiceDiagnosticsRepository,
  emitVoiceDiagnosticsChanged = () => undefined,
} = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('ipcMain is required');
  }
  if (!voiceDiagnosticsRepository || typeof voiceDiagnosticsRepository.readDiagnosticSessions !== 'function') {
    throw new Error('voiceDiagnosticsRepository is required');
  }

  function emitChanged(reason, payload = {}) {
    emitVoiceDiagnosticsChanged({
      reason,
      ...payload,
      changedAt: new Date().toISOString(),
    });
  }

  ipcMain.handle('voice-diagnostics:list', () => voiceDiagnosticsRepository.readDiagnosticSessions());
  ipcMain.handle('voice-diagnostics:save', (_, payload = {}) => {
    const session = voiceDiagnosticsRepository.saveDiagnosticSession(payload || {});
    emitChanged('save', { session });
    return { success: true, data: session };
  });
  ipcMain.handle('voice-diagnostics:clear', () => {
    const result = voiceDiagnosticsRepository.clearDiagnosticSessions();
    emitChanged('clear');
    return result;
  });
}

module.exports = {
  registerVoiceDiagnosticsIpcHandlers,
};
