function normalizeSelectedTextResult(value) {
  if (typeof value === 'string') {
    return { success: Boolean(value.trim()), text: value.trim(), source: 'legacy' };
  }

  if (!value || typeof value !== 'object') {
    return { success: false, text: '', source: 'unknown', reason: 'invalid_result' };
  }

  const text = typeof value.text === 'string' ? value.text.trim() : '';
  return {
    success: Boolean(value.success) && Boolean(text),
    text: Boolean(value.success) ? text : '',
    source: typeof value.source === 'string' ? value.source : 'unknown',
    ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
  };
}

function normalizeUiaSelectionResult(value) {
  if (!value || typeof value !== 'object') {
    return { success: false, text: '', source: 'none', confidence: 'none', reason: 'invalid_result' };
  }

  const text = typeof value.text === 'string' ? value.text.trim() : '';
  const isConfirmed = value.success === true
    && value.source === 'uia'
    && value.confidence === 'confirmed'
    && Boolean(text);

  if (!isConfirmed) {
    return {
      success: false,
      text: '',
      source: 'none',
      confidence: 'none',
      reason: typeof value.reason === 'string' ? value.reason : 'empty',
    };
  }

  return {
    success: true,
    text,
    source: 'uia',
    confidence: 'confirmed',
  };
}

function createEmptyFocusedInfo() {
  return {
    appInfo: {
      app_name: '',
      app_identifier: '',
      window_title: '',
      app_type: 'native_app',
      app_metadata: {},
      browser_context: null,
    },
    elementInfo: {
      role: '',
      focused: false,
      editable: true,
      selected: false,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    },
  };
}

function normalizeFocusedInfo(value) {
  if (!value || typeof value !== 'object') return createEmptyFocusedInfo();

  const appInfo = value.appInfo && typeof value.appInfo === 'object' ? value.appInfo : {};
  const elementInfo = value.elementInfo && typeof value.elementInfo === 'object' ? value.elementInfo : {};

  return {
    appInfo: {
      app_name: typeof appInfo.app_name === 'string' ? appInfo.app_name : '',
      app_identifier: typeof appInfo.app_identifier === 'string' ? appInfo.app_identifier : '',
      window_title: typeof appInfo.window_title === 'string' ? appInfo.window_title : '',
      app_type: typeof appInfo.app_type === 'string' ? appInfo.app_type : 'native_app',
      app_metadata: appInfo.app_metadata && typeof appInfo.app_metadata === 'object' ? appInfo.app_metadata : {},
      browser_context: appInfo.browser_context ?? null,
    },
    elementInfo: {
      role: typeof elementInfo.role === 'string' ? elementInfo.role : '',
      focused: Boolean(elementInfo.focused),
      editable: elementInfo.editable !== false,
      selected: Boolean(elementInfo.selected),
      bounds: elementInfo.bounds && typeof elementInfo.bounds === 'object'
        ? elementInfo.bounds
        : { x: 0, y: 0, width: 0, height: 0 },
    },
  };
}

function normalizeFocusedTextTargetResult(value) {
  if (!value || typeof value !== 'object') {
    return {
      success: false,
      source: 'none',
      confidence: 'none',
      reason: 'invalid_result',
      valuePattern: false,
      textPattern: false,
      isReadOnly: false,
      controlType: '',
    };
  }

  const source = typeof value.source === 'string' ? value.source : 'none';
  const confidence = typeof value.confidence === 'string' ? value.confidence : 'none';
  const reason = typeof value.reason === 'string' ? value.reason : 'text_target_unavailable';
  const valuePattern = Boolean(value.value_pattern ?? value.valuePattern);
  const textPattern = Boolean(value.text_pattern ?? value.textPattern);
  const isReadOnly = Boolean(value.is_read_only ?? value.isReadOnly);
  const controlType = typeof value.control_type === 'string'
    ? value.control_type
    : typeof value.controlType === 'string'
      ? value.controlType
      : '';

  return {
    success: Boolean(value.success) && source === 'uia' && confidence === 'confirmed' && !isReadOnly && (valuePattern || textPattern),
    source: Boolean(value.success) ? source : 'none',
    confidence: Boolean(value.success) ? confidence : 'none',
    reason,
    valuePattern,
    textPattern,
    isReadOnly,
    controlType,
  };
}

function getWindowHandle(focusedInfo) {
  return String(focusedInfo?.appInfo?.app_metadata?.hwnd || '');
}

function isSameFocusedContext(previous, current) {
  const normalizedPrevious = normalizeFocusedInfo(previous);
  const normalizedCurrent = normalizeFocusedInfo(current);
  const previousHwnd = getWindowHandle(normalizedPrevious);
  const currentHwnd = getWindowHandle(normalizedCurrent);

  if (previousHwnd || currentHwnd) return Boolean(previousHwnd && previousHwnd === currentHwnd);

  return normalizedPrevious.appInfo.app_identifier === normalizedCurrent.appInfo.app_identifier
    && normalizedPrevious.appInfo.window_title === normalizedCurrent.appInfo.window_title;
}

module.exports = {
  createEmptyFocusedInfo,
  getWindowHandle,
  isSameFocusedContext,
  normalizeFocusedInfo,
  normalizeFocusedTextTargetResult,
  normalizeSelectedTextResult,
  normalizeUiaSelectionResult,
};
