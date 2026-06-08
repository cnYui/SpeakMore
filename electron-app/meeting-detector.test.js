const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createMeetingDetectorService,
  detectMeetingCandidate,
} = require('./meeting-detector');

function focusedWindow({
  processName,
  title,
  processId = 0,
  hwnd = '100',
}) {
  return {
    appInfo: {
      app_name: processName,
      app_identifier: `${processName}.exe`,
      window_title: title,
      app_metadata: { hwnd, process_id: processId },
    },
  };
}

test('detectMeetingCandidate 命中飞书会议窗口并返回应用名和信号', () => {
  const detected = detectMeetingCandidate({
    focusedInfo: focusedWindow({ processName: 'Feishu', title: '项目同步会议 - 飞书会议', processId: 10 }),
    audioSessions: [{ processId: 10, processName: 'Feishu' }],
  });

  assert.ok(detected);
  assert.equal(detected.appName, 'Feishu');
  assert.equal(detected.confidence, 'high');
  assert.ok(detected.sourceSignals.includes('profile:feishu'));
  assert.ok(detected.sourceSignals.includes('active_audio_session'));
});

test('detectMeetingCandidate 支持浏览器里的 Google Meet', () => {
  const detected = detectMeetingCandidate({
    focusedInfo: focusedWindow({ processName: 'chrome', title: 'Google Meet - Weekly Standup', processId: 20 }),
  });

  assert.ok(detected);
  assert.equal(detected.appName, 'Google Meet');
  assert.ok(detected.sourceSignals.includes('browser_meeting_title'));
});

test('detectMeetingCandidate 会排除下载和设置等非会议标题', () => {
  const detected = detectMeetingCandidate({
    focusedInfo: focusedWindow({ processName: 'Feishu', title: '飞书会议 下载中心', processId: 30 }),
  });

  assert.equal(detected, null);
});

test('createMeetingDetectorService 在关闭设置或已有录音时不提醒', async () => {
  const detectedPayloads = [];
  const service = createMeetingDetectorService({
    readLocalSettings: () => ({ meetingDetectionEnabled: false }),
    readFocusedInfo: async () => focusedWindow({ processName: 'Zoom', title: 'Zoom Meeting', processId: 40 }),
    onDetected: (payload) => detectedPayloads.push(payload),
  });

  assert.equal(await service.pollOnce(), null);

  const recordingService = createMeetingDetectorService({
    readLocalSettings: () => ({ meetingDetectionEnabled: true }),
    isVoiceActive: () => true,
    readFocusedInfo: async () => focusedWindow({ processName: 'Zoom', title: 'Zoom Meeting', processId: 40 }),
    onDetected: (payload) => detectedPayloads.push(payload),
  });

  assert.equal(await recordingService.pollOnce(), null);
  assert.deepEqual(detectedPayloads, []);
});

test('createMeetingDetectorService 单个信号源失败时仍用可用信号提醒', async () => {
  const detectedPayloads = [];
  const warnings = [];
  const service = createMeetingDetectorService({
    readLocalSettings: () => ({ meetingDetectionEnabled: true }),
    readFocusedInfo: async () => focusedWindow({ processName: 'Zoom', title: 'Zoom Meeting', processId: 41 }),
    readVisibleWindows: async () => {
      throw new Error('visible windows timeout');
    },
    listActiveAudioSessions: async () => ({ activeSessions: [{ processId: 41, processName: 'Zoom' }] }),
    onDetected: (payload) => detectedPayloads.push(payload),
    logger: { warn: (...args) => warnings.push(args) },
  });

  const detected = await service.pollOnce();

  assert.ok(detected);
  assert.equal(detected.appName, 'Zoom');
  assert.equal(detectedPayloads.length, 1);
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][0]), /signal read failed/);
});

test('createMeetingDetectorService 命中后会对同一窗口冷却', async () => {
  let currentNow = 1000;
  const detectedPayloads = [];
  const service = createMeetingDetectorService({
    now: () => currentNow,
    cooldownMs: 10000,
    readLocalSettings: () => ({ meetingDetectionEnabled: true }),
    readFocusedInfo: async () => focusedWindow({ processName: 'Discord', title: 'Voice Connected', processId: 50 }),
    listActiveAudioSessions: async () => ({ activeSessions: [{ processId: 50, processName: 'Discord' }] }),
    onDetected: (payload) => detectedPayloads.push(payload),
  });

  assert.ok(await service.pollOnce());
  assert.equal(await service.pollOnce(), null);

  currentNow += 10001;
  assert.ok(await service.pollOnce());
  assert.equal(detectedPayloads.length, 2);
});

test('createMeetingDetectorService 点击开始录制会回调请求并写入冷却', () => {
  const starts = [];
  const service = createMeetingDetectorService({
    now: () => 1000,
    onStartRecording: (payload) => starts.push(payload),
  });
  const payload = { windowKey: 'feishu|100|meeting' };

  service.startRecording(payload);

  assert.deepEqual(starts, [payload]);
  assert.equal(service.isCoolingDown(payload), true);
});
