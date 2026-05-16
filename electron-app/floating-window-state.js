const ACTIVE_VOICE_STATUSES = new Set(['connecting', 'recording', 'stopping', 'transcribing']);
const TERMINAL_VOICE_STATUSES = new Set(['completed', 'cancelled']);

function getVoiceStatus(state) {
  return state && typeof state.status === 'string' ? state.status : 'idle';
}

function isActiveVoiceState(state) {
  return ACTIVE_VOICE_STATUSES.has(getVoiceStatus(state));
}

function isTerminalVoiceState(state) {
  return TERMINAL_VOICE_STATUSES.has(getVoiceStatus(state));
}

function isErrorVoiceState(state) {
  return getVoiceStatus(state) === 'error';
}

function shouldShowShortcutHint(state) {
  if (!state) return true;
  if (isActiveVoiceState(state)) return false;
  if (isErrorVoiceState(state)) return false;
  if (isTerminalVoiceState(state) && state.visible !== false) return false;
  return true;
}

module.exports = {
  isActiveVoiceState,
  isTerminalVoiceState,
  isErrorVoiceState,
  shouldShowShortcutHint,
};
