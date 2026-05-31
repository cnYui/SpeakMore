const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FLOATING_BAR_COMPLETED_HIDE_DELAY_MS,
  createFloatingWindowController,
} = require('./floating-window-controller');
const {
  isActiveVoiceState,
  isErrorVoiceState,
  isTerminalVoiceState,
  shouldShowShortcutHint,
} = require('./floating-window-state');

function createControllerHarness(overrides = {}) {
  const calls = [];
  const timers = [];
  const controller = createFloatingWindowController({
    isActiveVoiceState,
    isErrorVoiceState,
    isTerminalVoiceState,
    shouldShowShortcutHint,
    showFloatingBar: () => calls.push(['show-bar']),
    hideFloatingBar: () => calls.push(['hide-bar']),
    showFloatingPanel: (payload) => calls.push(['show-panel', payload]),
    hideFloatingPanel: () => calls.push(['hide-panel']),
    sendToMain: (channel, payload) => calls.push(['main', channel, payload]),
    sendToFloatingBar: (channel, payload) => calls.push(['bar', channel, payload]),
    sendToFloatingPanel: (channel, payload) => calls.push(['panel', channel, payload]),
    setTimer: (callback, delay) => {
      timers.push({ callback, delay });
      return `timer-${timers.length}`;
    },
    clearTimer: (timer) => calls.push(['clear-timer', timer]),
    ...overrides,
  });

  return { calls, controller, timers };
}

test('completed 语音状态会显示悬浮条并在延迟后隐藏', () => {
  const { calls, controller, timers } = createControllerHarness();

  controller.handleVoiceState({ status: 'completed', visible: true });

  assert.deepEqual(calls, [
    ['bar', 'voice-state', { status: 'completed', visible: true }],
    ['show-bar'],
  ]);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, FLOATING_BAR_COMPLETED_HIDE_DELAY_MS);
  assert.deepEqual(controller.getLastVoiceState(), { status: 'completed', visible: true });

  timers[0].callback();

  assert.deepEqual(calls.at(-1), ['hide-bar']);
  assert.equal(controller.getLastVoiceState(), null);
});

test('active 语音状态会隐藏悬浮面板并显示悬浮条', () => {
  const { calls, controller } = createControllerHarness();

  controller.handleFloatingPanelEvent({ visible: true, type: 'free-ask-result', text: '答案' });
  controller.handleVoiceState({ status: 'recording', visible: true });

  assert.deepEqual(calls, [
    ['hide-bar'],
    ['show-panel', { visible: true, type: 'free-ask-result', text: '答案' }],
    ['panel', 'floating-panel', { visible: true, type: 'free-ask-result', text: '答案' }],
    ['bar', 'voice-state', { status: 'recording', visible: true }],
    ['hide-panel'],
    ['show-bar'],
  ]);
  assert.equal(controller.getFloatingPanelType(), null);
});

test('浮窗面板关闭后会清除可见状态', () => {
  const { calls, controller } = createControllerHarness();

  controller.handleFloatingPanelEvent({ visible: true, type: 'shortcut-hint' });
  calls.length = 0;
  controller.handleFloatingPanelClosed();
  controller.updateFloatingBarVisibility([{ code: 'RightAlt', isKeydown: true }]);

  assert.deepEqual(calls, [['show-bar']]);
  assert.equal(controller.getFloatingPanelType(), null);
});

test('shortcut hint 在不该显示时会恢复当前语音悬浮条状态', () => {
  const { calls, controller, timers } = createControllerHarness();

  controller.handleVoiceState({ status: 'completed', visible: true });
  calls.length = 0;
  timers.length = 0;

  controller.handleFloatingPanelEvent({ visible: true, type: 'shortcut-hint' });

  assert.deepEqual(calls, [
    ['hide-panel'],
    ['clear-timer', 'timer-1'],
    ['show-bar'],
  ]);
  assert.equal(timers.length, 1);
  assert.equal(controller.getFloatingPanelType(), null);
});

test('Escape 会按 active voice、panel visible、default 三种优先级处理', () => {
  const first = createControllerHarness();
  first.controller.handleVoiceState({ status: 'recording', visible: true });
  first.calls.length = 0;
  first.controller.handleEscapeKeydown();
  assert.deepEqual(first.calls, [['main', 'voice-cancel-requested', undefined]]);

  const second = createControllerHarness();
  second.controller.handleFloatingPanelEvent({ visible: true, type: 'free-ask-result' });
  second.calls.length = 0;
  second.controller.handleEscapeKeydown();
  assert.deepEqual(second.calls, [['hide-panel']]);
  assert.equal(second.controller.getFloatingPanelType(), null);

  const third = createControllerHarness();
  third.controller.handleEscapeKeydown();
  assert.deepEqual(third.calls, [['main', 'voice-cancel-requested', undefined]]);
});

test('Escape 会关闭正在显示的粒子悬浮条错误状态', () => {
  const { calls, controller } = createControllerHarness();

  controller.handleVoiceState({ status: 'error', visible: true, errorMessage: '未填写 API Key' });
  calls.length = 0;
  controller.handleEscapeKeydown();

  assert.deepEqual(calls, [['hide-bar']]);
  assert.equal(controller.getLastVoiceState(), null);
});

test('悬浮面板可见时按键状态不会主动显示悬浮条', () => {
  const { calls, controller } = createControllerHarness();

  controller.handleFloatingPanelEvent({ visible: true, type: 'shortcut-hint' });
  calls.length = 0;
  controller.updateFloatingBarVisibility([{ code: 'RightAlt', isKeydown: true }]);

  assert.deepEqual(calls, []);
});
