const test = require('node:test');
const assert = require('node:assert/strict');
const { createRightAltRelay } = require('./right-alt-relay');

function createHarness() {
  const emissions = [];
  const timers = [];
  let nextTimerId = 1;

  const relay = createRightAltRelay({
    emitKeyboardState(keys) {
      emissions.push(keys.map((key) => ({ keyName: key.keyName, isKeydown: key.isKeydown })));
    },
    setTimer(callback, delay) {
      const timer = { id: nextTimerId, callback, delay, cleared: false };
      nextTimerId += 1;
      timers.push(timer);
      return timer.id;
    },
    clearTimer(id) {
      const timer = timers.find((item) => item.id === id);
      if (timer) timer.cleared = true;
    },
    now: () => 123,
  });

  return { relay, emissions, timers };
}

test('RightAlt 超短点按在 keyup 前就应先发出 keydown', () => {
  const { relay, emissions } = createHarness();

  relay.handlePayload({ key: 'RightAlt', isKeydown: true });
  relay.handlePayload({ key: 'RightAlt', isKeydown: false });

  assert.deepEqual(emissions[0], [{ keyName: 'RightAlt', isKeydown: true }]);
  assert.deepEqual(emissions[1], [
    { keyName: 'RightAlt', isKeydown: false },
    { keyName: 'RightShift', isKeydown: false },
    { keyName: 'Space', isKeydown: false },
  ]);
});

test('RightAlt 按下后再按 Space，应先发 RightAlt，再发带 Space 的当前键态', () => {
  const { relay, emissions } = createHarness();

  relay.handlePayload({ key: 'RightAlt', isKeydown: true });
  relay.handlePayload({ key: 'Space', isKeydown: true });

  assert.deepEqual(emissions[0], [{ keyName: 'RightAlt', isKeydown: true }]);
  assert.deepEqual(emissions[1], [
    { keyName: 'RightAlt', isKeydown: true },
    { keyName: 'Space', isKeydown: true },
  ]);
});

test('没有 RightAlt 时，单独 Space 或 RightShift 不应发任何键态', () => {
  const { relay, emissions } = createHarness();

  relay.handlePayload({ key: 'Space', isKeydown: true });
  relay.handlePayload({ key: 'RightShift', isKeydown: true });

  assert.equal(emissions.length, 0);
});

test('释放 Space 后，应在短延迟后恢复到 RightAlt 单键态', () => {
  const { relay, emissions, timers } = createHarness();

  relay.handlePayload({ key: 'RightAlt', isKeydown: true });
  relay.handlePayload({ key: 'Space', isKeydown: true });
  relay.handlePayload({ key: 'Space', isKeydown: false });

  assert.deepEqual(emissions[2], [{ keyName: 'Space', isKeydown: false }]);

  const restoreTimer = timers.at(-1);
  restoreTimer.callback();

  assert.deepEqual(emissions[3], [{ keyName: 'RightAlt', isKeydown: true }]);
});

test('dispose 会清理挂起的恢复定时器', () => {
  const { relay, timers } = createHarness();

  relay.handlePayload({ key: 'RightAlt', isKeydown: true });
  relay.handlePayload({ key: 'Space', isKeydown: true });
  relay.handlePayload({ key: 'Space', isKeydown: false });

  const restoreTimer = timers.at(-1);
  relay.dispose();

  assert.equal(restoreTimer.cleared, true);
});

test('RightAlt 按下后再按 RightShift，应发出翻译模式需要的当前键态', () => {
  const { relay, emissions } = createHarness();

  relay.handlePayload({ key: 'RightAlt', isKeydown: true });
  relay.handlePayload({ key: 'RightShift', isKeydown: true });

  assert.deepEqual(emissions[1], [
    { keyName: 'RightAlt', isKeydown: true },
    { keyName: 'RightShift', isKeydown: true },
  ]);
});

test('开启 debug logger 时 relay 会记录每次发出的键态', () => {
  const debugEvents = [];
  const relay = createRightAltRelay({
    emitKeyboardState() {},
    setTimer: () => 1,
    clearTimer: () => {},
    now: () => 123,
    debugLog: (event, payload) => debugEvents.push({ event, payload }),
  });

  relay.handlePayload({ key: 'RightAlt', isKeydown: true });

  assert.equal(debugEvents[0].event, 'right-alt-relay:emit');
  assert.deepEqual(debugEvents[0].payload.keys, [{ keyName: 'RightAlt', isKeydown: true }]);
});
