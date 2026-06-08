const test = require('node:test');
const assert = require('node:assert/strict');
const { createAudioSessionService } = require('./audio-session-service');

test('createAudioSessionService 在禁用时不调用系统静音命令', async () => {
  let calls = 0;
  const service = createAudioSessionService({
    isEnabled: () => false,
    runAudioSessionControl: async () => {
      calls += 1;
      throw new Error('should not run');
    },
  });

  const result = await service.muteForRecording();

  assert.deepEqual(result, { success: true, mutedSessions: [] });
  assert.equal(service.isMuted(), false);
  assert.equal(calls, 0);
});

test('createAudioSessionService 可以只读列出活跃音频会话且不依赖静音开关', async () => {
  const calls = [];
  const service = createAudioSessionService({
    platform: 'win32',
    isEnabled: () => false,
    runAudioSessionControl: async (action, payload) => {
      calls.push({ action, payload });
      return { success: true, activeSessions: [{ ProcessId: 10, ProcessName: 'Feishu' }] };
    },
  });

  const result = await service.listActiveAudioSessions();

  assert.deepEqual(calls, [{ action: 'list-active-sessions', payload: {} }]);
  assert.deepEqual(result, { success: true, activeSessions: [{ ProcessId: 10, ProcessName: 'Feishu' }] });
  assert.equal(service.isMuted(), false);
});

test('createAudioSessionService 静音后只恢复本轮记录的会话', async () => {
  const calls = [];
  const service = createAudioSessionService({
    platform: 'win32',
    isEnabled: () => true,
    getTypelessProcessIds: () => [100, 200],
    runAudioSessionControl: async (action, payload) => {
      calls.push({ action, payload });
      if (action === 'mute-active-sessions') {
        return { success: true, mutedSessions: [{ id: 'session-1' }] };
      }
      return { success: true, restoredSessions: payload.mutedSessions };
    },
  });

  const muted = await service.muteForRecording();
  const restored = await service.restore();

  assert.equal(muted.success, true);
  assert.equal(service.isMuted(), false);
  assert.deepEqual(restored.restoredSessions, [{ id: 'session-1' }]);
  assert.deepEqual(calls, [
    { action: 'mute-active-sessions', payload: { excludedProcessIds: [100, 200] } },
    { action: 'restore-sessions', payload: { mutedSessions: [{ id: 'session-1' }] } },
  ]);
});

test('createAudioSessionService 重复静音前会先恢复旧会话', async () => {
  const actions = [];
  const service = createAudioSessionService({
    platform: 'win32',
    isEnabled: () => true,
    getTypelessProcessIds: () => [100],
    runAudioSessionControl: async (action, payload) => {
      actions.push(action);
      if (action === 'mute-active-sessions') {
        return { success: true, mutedSessions: [{ id: `session-${actions.length}` }] };
      }
      return { success: true, restoredSessions: payload.mutedSessions };
    },
  });

  await service.muteForRecording();
  await service.muteForRecording();

  assert.deepEqual(actions, ['mute-active-sessions', 'restore-sessions', 'mute-active-sessions']);
  assert.equal(service.isMuted(), true);
});
