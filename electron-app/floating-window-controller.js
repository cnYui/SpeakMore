const FLOATING_BAR_COMPLETED_HIDE_DELAY_MS = 1000;

function createFloatingWindowController({
  isActiveVoiceState = () => false,
  isErrorVoiceState = () => false,
  isTerminalVoiceState = () => false,
  isFloatingBarEnabled = () => true,
  shouldShowShortcutHint = () => true,
  showFloatingBar = () => undefined,
  hideFloatingBar = () => undefined,
  showFloatingPanel = () => undefined,
  hideFloatingPanel = () => undefined,
  sendToMain = () => undefined,
  sendToFloatingBar = () => undefined,
  sendToFloatingPanel = () => undefined,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let floatingBarCompletedHideTimer = null;
  let floatingPanelVisible = false;
  let floatingPanelType = null;
  let lastVoiceState = null;

  function clearFloatingBarCompletedHideTimer() {
    if (!floatingBarCompletedHideTimer) return;
    clearTimer(floatingBarCompletedHideTimer);
    floatingBarCompletedHideTimer = null;
  }

  function markFloatingPanelVisible(payload = {}) {
    floatingPanelVisible = true;
    floatingPanelType = payload.type || 'shortcut-hint';
    showFloatingPanel(payload);
  }

  function markFloatingPanelHidden() {
    floatingPanelVisible = false;
    floatingPanelType = null;
    hideFloatingPanel();
  }

  function scheduleFloatingBarCompletedHide() {
    floatingBarCompletedHideTimer = setTimer(() => {
      floatingBarCompletedHideTimer = null;
      lastVoiceState = null;
      hideFloatingBar();
    }, FLOATING_BAR_COMPLETED_HIDE_DELAY_MS);
  }

  function renderFloatingBarForVoiceState(payload = {}) {
    if (!isFloatingBarEnabled()) {
      lastVoiceState = payload;
      clearFloatingBarCompletedHideTimer();
      hideFloatingBar();
      return;
    }

    if (isTerminalVoiceState(payload)) {
      clearFloatingBarCompletedHideTimer();
      showFloatingBar();
      scheduleFloatingBarCompletedHide();
      return;
    }

    if (payload.visible || isErrorVoiceState(payload)) {
      clearFloatingBarCompletedHideTimer();
      showFloatingBar();
      return;
    }

    lastVoiceState = null;
    clearFloatingBarCompletedHideTimer();
    hideFloatingBar();
  }

  function updateFloatingBarVisibility(keys) {
    if (floatingPanelVisible) return;
    if (!isFloatingBarEnabled()) {
      hideFloatingBar();
      return;
    }
    const hasActiveKey = Array.isArray(keys) && keys.some((key) => key?.isKeydown);
    if (hasActiveKey) showFloatingBar();
  }

  function handleEscapeKeydown() {
    if (isActiveVoiceState(lastVoiceState)) {
      sendToMain('voice-cancel-requested');
      return;
    }

    if (floatingPanelVisible) {
      markFloatingPanelHidden();
      return;
    }

    if (lastVoiceState && (lastVoiceState.visible || isErrorVoiceState(lastVoiceState) || isTerminalVoiceState(lastVoiceState))) {
      lastVoiceState = null;
      clearFloatingBarCompletedHideTimer();
      hideFloatingBar();
      return;
    }

    sendToMain('voice-cancel-requested');
  }

  function normalizeFloatingPanelPayload(payload = {}) {
    const type = payload.type === 'free-ask-result' ? 'free-ask-result' : 'shortcut-hint';
    return { ...payload, type };
  }

  function handleFloatingPanelEvent(payload = {}) {
    if (payload.visible) {
      const panelPayload = normalizeFloatingPanelPayload(payload);

      if (panelPayload.type === 'shortcut-hint' && !shouldShowShortcutHint(lastVoiceState)) {
        markFloatingPanelHidden();
        renderFloatingBarForVoiceState(lastVoiceState || {});
        return;
      }

      hideFloatingBar();
      markFloatingPanelVisible(panelPayload);
      sendToFloatingPanel('floating-panel', panelPayload);
      return;
    }

    sendToFloatingPanel('floating-panel', { visible: false });
    markFloatingPanelHidden();
  }

  function handleVoiceState(payload = {}) {
    lastVoiceState = payload;
    sendToFloatingBar('voice-state', payload);
    if (floatingPanelVisible && isActiveVoiceState(payload)) markFloatingPanelHidden();
    renderFloatingBarForVoiceState(payload);
  }

  function handleFloatingPanelClosed() {
    floatingPanelVisible = false;
    floatingPanelType = null;
  }

  function dispose() {
    clearFloatingBarCompletedHideTimer();
    floatingPanelVisible = false;
    floatingPanelType = null;
    lastVoiceState = null;
  }

  return {
    dispose,
    handleEscapeKeydown,
    handleFloatingPanelClosed,
    handleFloatingPanelEvent,
    handleVoiceState,
    renderFloatingBarForVoiceState,
    updateFloatingBarVisibility,
    getFloatingPanelType: () => floatingPanelType,
    getLastVoiceState: () => lastVoiceState,
  };
}

module.exports = {
  FLOATING_BAR_COMPLETED_HIDE_DELAY_MS,
  createFloatingWindowController,
};
