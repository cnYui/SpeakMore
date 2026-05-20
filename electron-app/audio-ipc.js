function registerAudioIpcHandlers({
  ipcMain,
  callVoiceFlowBackend,
  checkVoiceServerReady,
  muteBackgroundSessionsForRecording,
  restoreMutedBackgroundSessions,
  isMuted,
} = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('ipcMain is required');
  }
  if (typeof callVoiceFlowBackend !== 'function') {
    throw new Error('callVoiceFlowBackend is required');
  }
  if (typeof checkVoiceServerReady !== 'function') {
    throw new Error('checkVoiceServerReady is required');
  }
  if (typeof muteBackgroundSessionsForRecording !== 'function' || typeof restoreMutedBackgroundSessions !== 'function') {
    throw new Error('muteBackgroundSessionsForRecording and restoreMutedBackgroundSessions are required');
  }
  if (typeof isMuted !== 'function') {
    throw new Error('isMuted is required');
  }

  ipcMain.handle('audio:opus-compress-by-buffer', (_, payload = {}) => ({
    success: false,
    arrayBuffer: payload.arrayBuffer || null,
    message: '本地兼容层未启用 opus 压缩',
  }));
  ipcMain.handle('audio:opus-compress-by-audio-id', () => ({ success: false, message: '本地兼容层未启用 opus 压缩' }));
  ipcMain.handle('audio:clean-opus-audio-file', () => true);
  ipcMain.handle('audio:ai-voice-flow', async (_, payload = {}) => {
    try {
      return await callVoiceFlowBackend(payload);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        aborted: false,
        debug: null,
        detail,
        code: 'voice_flow_failed',
        paywall: null,
        web_metadata: null,
        external_action: null,
        error: detail,
      };
    }
  });
  ipcMain.handle('audio:abort-ai-voice-flow-request', () => true);
  ipcMain.handle('audio:get-devices-async', () => ({ success: true, devices: [], message: 'no devices in shim' }));
  ipcMain.handle('audio:check-voice-server-ready', async () => checkVoiceServerReady());
  ipcMain.handle('audio:ensure-voice-server', async () => checkVoiceServerReady());
  ipcMain.handle('audio:mute-background-sessions', async () => muteBackgroundSessionsForRecording());
  ipcMain.handle('audio:restore-background-sessions', async () => restoreMutedBackgroundSessions());
  ipcMain.handle('audio:is-muted', () => ({ success: true, isMuted: isMuted() }));
  ipcMain.handle('audio:mute', async () => muteBackgroundSessionsForRecording());
  ipcMain.handle('audio:unmute', async () => restoreMutedBackgroundSessions());
}

module.exports = {
  registerAudioIpcHandlers,
};
