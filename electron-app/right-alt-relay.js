function createKeyboardEventFactory(now) {
  const stamp = () => now();

  return {
    rightAltDown: () => ({
      keyCode: 165,
      keyName: 'RightAlt',
      enKeyName: 'RightAlt',
      isKeydown: true,
      isBlocked: false,
      timestamp: stamp(),
    }),
    rightAltUp: () => ({
      keyCode: 165,
      keyName: 'RightAlt',
      enKeyName: 'RightAlt',
      isKeydown: false,
      isBlocked: false,
      timestamp: stamp(),
    }),
    rightShift: (isKeydown) => ({
      keyCode: 161,
      keyName: 'RightShift',
      enKeyName: 'RightShift',
      isKeydown,
      isBlocked: false,
      timestamp: stamp(),
    }),
    space: (isKeydown) => ({
      keyCode: 32,
      keyName: 'Space',
      enKeyName: 'Space',
      isKeydown,
      isBlocked: false,
      timestamp: stamp(),
    }),
  };
}

function createRightAltRelay({ emitKeyboardState, setTimer, clearTimer, now = Date.now }) {
  const keyboardStateByName = new Map();
  const events = createKeyboardEventFactory(now);
  let clearStateTimer = null;
  let restoreStateTimer = null;

  function emit(keys) {
    emitKeyboardState(keys);
  }

  function scheduleClearToEmpty() {
    if (clearStateTimer !== null) clearTimer(clearStateTimer);
    clearStateTimer = setTimer(() => {
      emit([]);
      clearStateTimer = null;
    }, 40);
  }

  function scheduleRestoreActiveState() {
    if (restoreStateTimer !== null) clearTimer(restoreStateTimer);
    restoreStateTimer = setTimer(() => {
      emit(Array.from(keyboardStateByName.values()));
      restoreStateTimer = null;
    }, 40);
  }

  function clearPendingEmptyEmission() {
    if (clearStateTimer === null) return;
    clearTimer(clearStateTimer);
    clearStateTimer = null;
  }

  function clearPendingRestoreEmission() {
    if (restoreStateTimer === null) return;
    clearTimer(restoreStateTimer);
    restoreStateTimer = null;
  }

  function handlePayload(payload) {
    if (!payload || (payload.key !== 'RightAlt' && payload.key !== 'RightShift' && payload.key !== 'Space')) return;

    if (payload.isKeydown) {
      if (payload.key !== 'RightAlt' && !keyboardStateByName.has('RightAlt')) return;

      clearPendingEmptyEmission();
      clearPendingRestoreEmission();

      if (payload.key === 'RightAlt') keyboardStateByName.set('RightAlt', events.rightAltDown());
      if (payload.key === 'RightShift') keyboardStateByName.set('RightShift', events.rightShift(true));
      if (payload.key === 'Space') keyboardStateByName.set('Space', events.space(true));

      emit(Array.from(keyboardStateByName.values()));
      return;
    }

    if (payload.key === 'RightAlt') {
      clearPendingEmptyEmission();
      clearPendingRestoreEmission();
      keyboardStateByName.clear();
      emit([events.rightAltUp(), events.rightShift(false), events.space(false)]);
      scheduleClearToEmpty();
      return;
    }

    if (!keyboardStateByName.has(payload.key)) return;

    clearPendingEmptyEmission();
    clearPendingRestoreEmission();
    keyboardStateByName.delete(payload.key);
    emit([payload.key === 'RightShift' ? events.rightShift(false) : events.space(false)]);
    scheduleRestoreActiveState();
  }

  function dispose() {
    clearPendingEmptyEmission();
    clearPendingRestoreEmission();
  }

  return {
    handlePayload,
    dispose,
  };
}

module.exports = {
  createRightAltRelay,
};
