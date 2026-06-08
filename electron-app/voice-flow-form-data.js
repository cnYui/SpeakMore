const crypto = require('crypto');

function normalizeVoiceMode(mode) {
  const normalized = String(mode || 'transcript').toLowerCase();
  if (normalized === 'dictate' || normalized === 'dictation') return 'transcript';
  if (normalized === 'ask' || normalized === 'ask_anything') return 'ask_anything';
  if (normalized === 'translate' || normalized === 'translation') return 'translation';
  if (normalized === 'custom' || normalized === 'custom_command' || normalized === 'custom-command') return 'custom_command';
  if (normalized === 'meeting' || normalized === 'meeting_notes' || normalized === 'meeting-notes') return 'meeting_notes';
  return 'transcript';
}

function bufferFromVoicePayload(payload = {}) {
  const candidates = [
    payload.arrayBuffer,
    payload.audioBuffer,
    payload.buffer,
    payload.data,
    payload.audio,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (Buffer.isBuffer(candidate)) return candidate;
    if (candidate instanceof ArrayBuffer) return Buffer.from(candidate);
    if (ArrayBuffer.isView(candidate)) {
      return Buffer.from(candidate.buffer, candidate.byteOffset, candidate.byteLength);
    }
    if (candidate.type === 'Buffer' && Array.isArray(candidate.data)) {
      return Buffer.from(candidate.data);
    }
    if (typeof candidate === 'string') {
      return Buffer.from(candidate, 'base64');
    }
  }

  return null;
}

function appendJsonFormField(formData, name, value, fallback = {}) {
  if (typeof value === 'string') {
    formData.append(name, value || JSON.stringify(fallback));
    return;
  }
  formData.append(name, JSON.stringify(value || fallback));
}

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return typeof value === 'object' ? value : fallback;
}

function buildVoiceFlowParameters(payload = {}, {
  buildCurrentLlmRequestConfig = () => ({}),
  normalizeLlmRequestConfig = (value) => value || null,
} = {}) {
  const parameters = parseJsonObject(payload.parameters);
  const audioContext = parseJsonObject(payload.audioContext || payload.audio_context);
  const modeConfig = parseJsonObject(payload.modeConfig || payload.mode_config);

  const selectedText = (
    parameters.selected_text
    || payload.selectedText
    || payload.selected_text
    || audioContext.selected_text
    || audioContext.selectedText
    || ''
  );
  const outputLanguage = (
    parameters.output_language
    || payload.outputLanguage
    || payload.output_language
    || modeConfig.output_language
    || modeConfig.outputLanguage
    || ''
  );

  return {
    ...parameters,
    llm: normalizeLlmRequestConfig(parameters.llm) || buildCurrentLlmRequestConfig(),
    ...(selectedText ? { selected_text: selectedText } : {}),
    ...(outputLanguage ? { output_language: outputLanguage } : {}),
  };
}

function buildVoiceFlowFormData(payload = {}, options = {}) {
  const audioBuffer = bufferFromVoicePayload(payload);
  if (!audioBuffer || audioBuffer.length === 0) {
    throw new Error('缺少音频数据');
  }

  const mimeType = payload.mimeType || payload.contentType || 'audio/webm;codecs=opus';
  const extension = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('wav') ? 'wav' : 'webm';
  const audioId = payload.audioId || payload.audio_id || crypto.randomUUID();
  const formData = new FormData();
  const audioBlob = new Blob([audioBuffer], { type: mimeType });

  formData.append('audio_file', audioBlob, `${audioId}.${extension}`);
  formData.append('audio_id', audioId);
  formData.append('mode', normalizeVoiceMode(payload.mode));
  appendJsonFormField(formData, 'audio_context', payload.audioContext || payload.audio_context);
  appendJsonFormField(formData, 'audio_metadata', payload.audioMetadata || payload.audio_metadata);
  appendJsonFormField(formData, 'parameters', buildVoiceFlowParameters(payload, options));
  formData.append('is_retry', String(Boolean(payload.isRetry || payload.is_retry)));
  formData.append('device_name', payload.deviceName || payload.device_name || '');
  formData.append('user_over_time', String(payload.userOverTime || payload.user_over_time || ''));
  formData.append('send_time', String(Date.now()));

  return formData;
}

module.exports = {
  normalizeVoiceMode,
  bufferFromVoicePayload,
  appendJsonFormField,
  parseJsonObject,
  buildVoiceFlowParameters,
  buildVoiceFlowFormData,
};
