const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocalCompatState } = require('./local-compat-state');

function createState() {
  const sent = [];
  const state = createLocalCompatState({
    defaultLanguage: 'zh-CN',
    defaultTranslationTargetLanguage: 'ja',
    sendToMain: (channel, payload) => sent.push(['main', channel, payload]),
    sendToFloatingBar: (channel, payload) => sent.push(['bar', channel, payload]),
  });

  return { sent, state };
}

test('createLocalCompatState 初始化旧兼容 store 和本地用户默认值', () => {
  const { state } = createState();

  assert.deepEqual(state.localStores['app-onboarding'], {
    isCompleted: true,
    onboardingIsCompleted: true,
    onboardingStep: null,
    onboardingMaxReachedStep: null,
  });
  assert.deepEqual(state.localStores['app-settings'].keyboardShortcut, {
    pushToTalk: 'RightAlt',
    handlesFreeMode: 'RightAlt+Space',
    pasteLastTranscript: 'LeftCtrl+RightShift+V',
    translationMode: 'RightAlt+RightShift',
  });
  assert.equal(state.localStores['app-settings'].preferredLanguage, 'zh-CN');
  assert.equal(state.localStores['app-settings'].translationTargetLanguage, 'ja');
  assert.equal(state.localStores['app-settings'].enabledMuteBackgroundAudio, true);
  assert.deepEqual(state.localStores['app-storage'], {});
  assert.deepEqual(state.getLocalUser(), {
    user_id: 'local-user',
    client_user_id: 'local-user',
    email: 'local@typeless.local',
    name: 'SpeakMore',
    plan: 'pro',
    subscription: {
      plan: 'pro',
      status: 'active',
    },
  });
});

test('syncLocalSettingsToLegacyStore 同步设置到旧 app-settings store', () => {
  const { state } = createState();

  state.syncLocalSettingsToLegacyStore({
    launchAtSystemStartup: true,
    translationTargetLanguage: 'en',
    selectedAudioDeviceId: 'mic-1',
  });

  assert.equal(state.localStores['app-settings'].launchAtSystemStartup, true);
  assert.equal(state.localStores['app-settings'].translationTargetLanguage, 'en');
  assert.equal(state.localStores['app-settings'].selectedMicrophoneDevice, 'mic-1');

  state.syncLocalSettingsToLegacyStore({
    launchAtSystemStartup: false,
    translationTargetLanguage: 'ja',
    selectedAudioDeviceId: 'default',
  });

  assert.equal(state.localStores['app-settings'].launchAtSystemStartup, false);
  assert.equal(state.localStores['app-settings'].translationTargetLanguage, 'ja');
  assert.equal(state.localStores['app-settings'].selectedMicrophoneDevice, null);
});

test('handleStoreUse 保持 get-all、get、set、delete 行为和设置更新广播', () => {
  const { sent, state } = createState();

  assert.equal(state.handleStoreUse({}, { action: 'get', store: 'app-settings', key: 'preferredLanguage' }), 'zh-CN');
  assert.deepEqual(state.handleStoreUse({}, { action: 'get-all', store: 'app-storage' }), {});
  assert.equal(state.handleStoreUse({}, {
    action: 'set',
    store: 'app-settings',
    key: 'preferredLanguage',
    value: 'en',
  }), 'en');
  assert.equal(state.localStores['app-settings'].preferredLanguage, 'zh-CN');
  assert.deepEqual(sent, [
    ['main', 'app-settings-updated', {}],
    ['bar', 'app-settings-updated', {}],
  ]);

  assert.equal(state.handleStoreUse({}, {
    action: 'set',
    store: 'app-storage',
    key: 'token',
    value: 'abc',
  }), 'abc');
  assert.equal(state.localStores['app-storage'].token, 'abc');
  assert.equal(state.handleStoreUse({}, { action: 'delete', store: 'app-storage', key: 'token' }), true);
  assert.equal(state.localStores['app-storage'].token, undefined);
  assert.equal(state.handleStoreUse({}, { action: 'get', store: 'missing', key: 'x' }), null);
  assert.equal(state.handleStoreUse({}, { action: 'unknown', store: 'app-settings' }), null);
});

test('本地用户状态更新后按原 channel 广播用户和角色状态', () => {
  const { sent, state } = createState();
  const nextUser = {
    user_id: 'u-1',
    client_user_id: 'u-1',
    email: 'u@example.com',
    name: 'User',
    plan: 'team',
    subscription: {
      plan: 'team',
      status: 'trialing',
    },
  };

  state.setLocalUser(nextUser);
  state.emitUserStateChange();
  state.emitUserRoleChange();

  assert.equal(state.getLocalUser(), nextUser);
  assert.deepEqual(sent, [
    ['main', 'user-state-change', nextUser],
    ['main', 'user-role-change', {
      plan: 'team',
      subscription: {
        plan: 'team',
        status: 'trialing',
      },
    }],
  ]);
});
