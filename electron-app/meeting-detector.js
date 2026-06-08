const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000;
const DEFAULT_VISIBLE_MS = 15000;

const BROWSER_PROCESSES = new Set(['chrome', 'msedge', 'edge', 'firefox', 'brave', 'opera', 'arc']);
const SELF_PROCESSES = new Set(['speakmore', 'typeless', 'electron']);

const GENERIC_MEETING_KEYWORDS = [
  'meeting', 'meet', 'call', 'huddle', 'webinar', 'voice chat', 'voice channel',
  '会议', '通话', '语音', '视频会议', '正在会议', '加入会议', '等待会议', '会议中',
];

const NEGATIVE_TITLE_KEYWORDS = [
  'settings', 'preferences', 'download', 'install', 'pricing', 'help', 'docs', 'history',
  '设置', '下载', '安装', '官网', '帮助', '历史记录', '通讯录', '联系人', '消息列表',
];

const MEETING_PROFILES = [
  {
    id: 'feishu',
    label: 'Feishu',
    processNames: ['feishu', 'lark'],
    titleKeywords: ['feishu meeting', 'lark meeting', '飞书会议', '会议', '通话', 'meeting', 'call'],
  },
  {
    id: 'dingtalk',
    label: 'DingTalk',
    processNames: ['dingtalk', 'dingding'],
    titleKeywords: ['钉钉会议', '视频会议', '会议', '通话', 'meeting', 'call'],
  },
  {
    id: 'wxwork',
    label: 'WeCom',
    processNames: ['wxwork', 'wecom', '企业微信'],
    titleKeywords: ['企业微信会议', '会议', '通话', '语音', '视频'],
  },
  {
    id: 'tencent_meeting',
    label: 'Tencent Meeting',
    processNames: ['wemeetapp', 'tencentmeeting', 'voovmeeting', '腾讯会议'],
    titleKeywords: ['腾讯会议', 'voov meeting', 'wemeet', 'meeting'],
    dedicatedMeetingApp: true,
  },
  {
    id: 'netease_meeting',
    label: 'NetEase Meeting',
    processNames: ['neteasemeeting', '网易会议'],
    titleKeywords: ['网易会议', 'meeting'],
    dedicatedMeetingApp: true,
  },
  {
    id: 'zoom',
    label: 'Zoom',
    processNames: ['zoom', 'zoom meetings'],
    titleKeywords: ['zoom meeting', 'meeting', 'webinar'],
    dedicatedMeetingApp: true,
  },
  {
    id: 'teams',
    label: 'Microsoft Teams',
    processNames: ['teams', 'msteams', 'ms-teams'],
    titleKeywords: ['microsoft teams', 'teams meeting', 'meeting', 'call'],
  },
  {
    id: 'google_meet',
    label: 'Google Meet',
    processNames: [],
    titleKeywords: ['google meet', 'meet.google.com', 'meet -', '正在共享 meet'],
    browserOnly: true,
  },
  {
    id: 'webex',
    label: 'Webex',
    processNames: ['webex', 'ciscowebexstart'],
    titleKeywords: ['webex', 'meeting'],
    dedicatedMeetingApp: true,
  },
  {
    id: 'slack_huddle',
    label: 'Slack Huddle',
    processNames: ['slack'],
    titleKeywords: ['huddle', 'call', 'meeting', '语音'],
  },
  {
    id: 'discord',
    label: 'Discord',
    processNames: ['discord'],
    titleKeywords: ['voice connected', 'voice channel', 'call', 'stage', '语音'],
  },
  {
    id: 'telegram',
    label: 'Telegram',
    processNames: ['telegram'],
    titleKeywords: ['voice chat', 'call', 'group call', '语音', '通话'],
  },
  {
    id: 'wechat',
    label: 'WeChat',
    processNames: ['wechat', 'weixin'],
    titleKeywords: ['语音通话', '视频通话', '通话中'],
  },
  {
    id: 'qq',
    label: 'QQ',
    processNames: ['qq', 'qqnt'],
    titleKeywords: ['语音通话', '视频通话', '通话中'],
  },
];

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeToken(value) {
  return normalizeText(value).toLowerCase().replace(/\.exe$/, '');
}

function keywordMatch(text, keywords) {
  const normalized = normalizeText(text).toLowerCase();
  return keywords.find((keyword) => normalized.includes(String(keyword).toLowerCase())) || '';
}

function processNameFromIdentifier(value) {
  const identifier = normalizeToken(value);
  if (!identifier) return '';
  const parts = identifier.split(/[\\/]/);
  return parts[parts.length - 1] || identifier;
}

function normalizeWindowCandidate(value = {}, source = 'visible_window') {
  const appInfo = value.appInfo && typeof value.appInfo === 'object' ? value.appInfo : {};
  const metadata = appInfo.app_metadata && typeof appInfo.app_metadata === 'object' ? appInfo.app_metadata : {};
  const appIdentifier = normalizeText(value.appIdentifier ?? value.app_identifier ?? appInfo.app_identifier);
  const processName = normalizeText(
    value.processName
      ?? value.process_name
      ?? appInfo.app_name
      ?? processNameFromIdentifier(appIdentifier),
  );
  const processId = Number(
    value.processId
      ?? value.process_id
      ?? metadata.process_id
      ?? 0,
  );
  const windowTitle = normalizeText(value.windowTitle ?? value.window_title ?? appInfo.window_title);
  const hwnd = normalizeText(value.hwnd ?? value.foreground_hwnd ?? metadata.hwnd);

  return {
    appName: normalizeText(value.appName ?? value.app_name ?? appInfo.app_name) || processName,
    appIdentifier: appIdentifier || (processName ? `${processName}.exe` : ''),
    processName,
    processId: Number.isFinite(processId) ? processId : 0,
    windowTitle,
    hwnd,
    focused: source === 'focused',
    source,
  };
}

function normalizeAudioSession(value = {}) {
  const processId = Number(value.processId ?? value.ProcessId ?? value.process_id ?? 0);
  return {
    processId: Number.isFinite(processId) ? processId : 0,
    processName: normalizeText(value.processName ?? value.ProcessName ?? value.process_name),
    displayName: normalizeText(value.displayName ?? value.DisplayName ?? value.display_name),
  };
}

function matchProfile(candidate) {
  const processName = normalizeToken(candidate.processName || candidate.appIdentifier);
  const title = candidate.windowTitle;
  const isBrowser = BROWSER_PROCESSES.has(processName);

  for (const profile of MEETING_PROFILES) {
    if (profile.browserOnly && !isBrowser) continue;
    if (!profile.browserOnly && profile.processNames.some((name) => normalizeToken(name) === processName)) {
      return profile;
    }
    if (isBrowser && keywordMatch(title, profile.titleKeywords)) {
      return profile;
    }
  }

  return null;
}

function audioSessionMatches(candidate, profile, audioSessions = []) {
  const processName = normalizeToken(candidate.processName);
  const profileProcessNames = new Set((profile?.processNames || []).map(normalizeToken));
  return audioSessions.some((session) => {
    const normalized = normalizeAudioSession(session);
    if (candidate.processId && normalized.processId === candidate.processId) return true;
    const sessionProcessName = normalizeToken(normalized.processName);
    if (sessionProcessName && sessionProcessName === processName) return true;
    if (sessionProcessName && profileProcessNames.has(sessionProcessName)) return true;
    const display = normalized.displayName.toLowerCase();
    return Boolean(profile?.label && display.includes(profile.label.toLowerCase()));
  });
}

function getWindowKey(candidate) {
  return [
    normalizeToken(candidate.appIdentifier || candidate.processName),
    candidate.hwnd || '',
    candidate.windowTitle || '',
  ].join('|');
}

function evaluateMeetingCandidate(candidate, { audioSessions = [] } = {}) {
  const processName = normalizeToken(candidate.processName || candidate.appIdentifier);
  if (!processName || SELF_PROCESSES.has(processName)) return null;

  const profile = matchProfile(candidate);
  const title = candidate.windowTitle;
  const negativeKeyword = keywordMatch(title, NEGATIVE_TITLE_KEYWORDS);
  const profileTitleKeyword = profile ? keywordMatch(title, profile.titleKeywords) : '';
  const genericTitleKeyword = keywordMatch(title, GENERIC_MEETING_KEYWORDS);
  const hasAudioSession = audioSessionMatches(candidate, profile, audioSessions);

  let score = candidate.focused ? 1 : 0;
  const sourceSignals = [];
  if (profile) {
    score += profile.browserOnly ? 0 : 3;
    sourceSignals.push(`profile:${profile.id}`);
    if (profile.dedicatedMeetingApp) score += 2;
  }
  if (profile?.browserOnly) {
    score += 5;
    sourceSignals.push('browser_meeting_title');
  }
  if (profileTitleKeyword) {
    score += 3;
    sourceSignals.push(`title:${profileTitleKeyword}`);
  } else if (genericTitleKeyword) {
    score += 2;
    sourceSignals.push(`title:${genericTitleKeyword}`);
  }
  if (hasAudioSession) {
    score += 2;
    sourceSignals.push('active_audio_session');
  }
  if (!title) score -= 1;
  if (negativeKeyword) {
    score -= 5;
    sourceSignals.push(`negative:${negativeKeyword}`);
  }

  if (score < 5) return null;

  return {
    appName: profile?.label || candidate.appName || candidate.processName || 'Meeting',
    appIdentifier: candidate.appIdentifier,
    windowTitle: candidate.windowTitle,
    confidence: score >= 8 ? 'high' : 'medium',
    score,
    sourceSignals,
    windowKey: getWindowKey(candidate),
  };
}

function detectMeetingCandidate({
  focusedInfo = null,
  visibleWindows = [],
  audioSessions = [],
} = {}) {
  const candidates = [
    ...(focusedInfo ? [normalizeWindowCandidate(focusedInfo, 'focused')] : []),
    ...(Array.isArray(visibleWindows) ? visibleWindows.map((item) => normalizeWindowCandidate(item)) : []),
  ];

  return candidates
    .map((candidate) => evaluateMeetingCandidate(candidate, { audioSessions }))
    .filter(Boolean)
    .sort((left, right) => right.score - left.score)[0] || null;
}

function createMeetingDetectorService({
  readFocusedInfo = async () => null,
  readVisibleWindows = async () => [],
  listActiveAudioSessions = async () => [],
  readLocalSettings = () => ({ meetingDetectionEnabled: true }),
  isVoiceActive = () => false,
  onDetected = () => undefined,
  onStartRecording = () => undefined,
  onDismiss = () => undefined,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = () => Date.now(),
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  cooldownMs = DEFAULT_COOLDOWN_MS,
  visibleMs = DEFAULT_VISIBLE_MS,
  logger = console,
} = {}) {
  let timer = null;
  let running = false;
  const cooldownByKey = new Map();

  function clearPollTimer() {
    if (!timer) return;
    clearTimer(timer);
    timer = null;
  }

  function markCooldown(payload = {}, durationMs = cooldownMs) {
    const key = payload.windowKey || '';
    if (!key) return;
    cooldownByKey.set(key, now() + durationMs);
  }

  function isCoolingDown(payload) {
    const key = payload?.windowKey || '';
    if (!key) return false;
    const until = cooldownByKey.get(key) || 0;
    if (until <= now()) {
      cooldownByKey.delete(key);
      return false;
    }
    return true;
  }

  async function pollOnce() {
    const settings = readLocalSettings() || {};
    if (settings.meetingDetectionEnabled === false) return null;
    if (isVoiceActive()) return null;

    try {
      const [focusedInfoResult, visibleWindowsResult, audioResult] = await Promise.allSettled([
        readFocusedInfo(),
        readVisibleWindows(),
        listActiveAudioSessions(),
      ]);
      const focusedInfo = focusedInfoResult.status === 'fulfilled' ? focusedInfoResult.value : null;
      const visibleWindows = visibleWindowsResult.status === 'fulfilled' && Array.isArray(visibleWindowsResult.value)
        ? visibleWindowsResult.value
        : [];
      const rawAudioResult = audioResult.status === 'fulfilled' ? audioResult.value : [];
      const audioSessions = Array.isArray(rawAudioResult)
        ? rawAudioResult
        : Array.isArray(rawAudioResult?.activeSessions)
          ? rawAudioResult.activeSessions
          : [];
      for (const result of [focusedInfoResult, visibleWindowsResult, audioResult]) {
        if (result.status === 'rejected') logger.warn?.('[meeting-detector] signal read failed', result.reason);
      }
      const detected = detectMeetingCandidate({ focusedInfo, visibleWindows, audioSessions });
      if (!detected || isCoolingDown(detected)) return null;

      const payload = {
        ...detected,
        visibleMs,
        detectedAt: new Date(now()).toISOString(),
      };
      markCooldown(payload);
      onDetected(payload);
      return payload;
    } catch (error) {
      logger.warn?.('[meeting-detector] poll failed', error);
      return null;
    }
  }

  function scheduleNextPoll() {
    clearPollTimer();
    if (!running) return;
    timer = setTimer(async () => {
      await pollOnce();
      scheduleNextPoll();
    }, pollIntervalMs);
  }

  function start() {
    if (running) return;
    running = true;
    scheduleNextPoll();
  }

  function stop() {
    running = false;
    clearPollTimer();
  }

  function dismiss(payload = {}) {
    markCooldown(payload);
    onDismiss(payload);
  }

  function startRecording(payload = {}) {
    markCooldown(payload);
    onStartRecording(payload);
  }

  return {
    start,
    stop,
    pollOnce,
    dismiss,
    startRecording,
    markCooldown,
    isCoolingDown,
    isRunning: () => running,
  };
}

module.exports = {
  DEFAULT_COOLDOWN_MS,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_VISIBLE_MS,
  MEETING_PROFILES,
  detectMeetingCandidate,
  evaluateMeetingCandidate,
  normalizeAudioSession,
  normalizeWindowCandidate,
  createMeetingDetectorService,
};
