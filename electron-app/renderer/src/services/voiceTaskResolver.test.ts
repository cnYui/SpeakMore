import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveVoiceTask, type VoiceTask } from './voiceTaskResolver'
import type { FocusedSelectionSnapshot } from './focusedContext'

const focusInfo = {
  appInfo: {
    app_name: 'Notepad',
    app_identifier: 'notepad.exe',
    window_title: 'note.txt',
    app_type: 'native_app',
    app_metadata: { hwnd: '100' },
    browser_context: null,
  },
  elementInfo: {
    role: '',
    focused: true,
    editable: true,
    selected: true,
    bounds: { x: 0, y: 0, width: 0, height: 0 },
  },
}

function reader(snapshot: FocusedSelectionSnapshot) {
  return async () => snapshot
}

function assertTask(actual: VoiceTask, expected: VoiceTask) {
  assert.deepEqual(actual, expected)
}

test('普通听写意图无选区时保持 Dictate 录音粘贴', async () => {
  const task = await resolveVoiceTask('DictateShortcut', reader({ selectedText: '', focusInfo: null }))

  assertTask(task, {
    mode: 'Dictate',
    selectedText: '',
    focusInfo: null,
    delivery: 'paste',
    shouldRecordAudio: true,
  })
})

test('普通听写意图有选区时转为 Translate 选区替换任务', async () => {
  const task = await resolveVoiceTask('DictateShortcut', reader({ selectedText: '你好', focusInfo }))

  assertTask(task, {
    mode: 'Translate',
    selectedText: '你好',
    focusInfo,
    delivery: 'replace-selection',
    shouldRecordAudio: false,
  })
})

test('自由提问意图无选区时录音并展示悬浮结果', async () => {
  const task = await resolveVoiceTask('AskShortcut', reader({ selectedText: '', focusInfo: null }))

  assertTask(task, {
    mode: 'Ask',
    selectedText: '',
    focusInfo: null,
    delivery: 'floating-panel',
    shouldRecordAudio: true,
  })
})

test('自由提问意图有选区时录音并优先替换选区', async () => {
  const task = await resolveVoiceTask('AskShortcut', reader({ selectedText: 'const a = 1', focusInfo }))

  assertTask(task, {
    mode: 'Ask',
    selectedText: 'const a = 1',
    focusInfo,
    delivery: 'replace-selection',
    shouldRecordAudio: true,
  })
})

test('翻译意图有选区时仍录音并把翻译结果粘贴到光标位置', async () => {
  const task = await resolveVoiceTask('TranslateShortcut', reader({ selectedText: '你好', focusInfo }))

  assertTask(task, {
    mode: 'Translate',
    selectedText: '你好',
    focusInfo,
    delivery: 'paste',
    shouldRecordAudio: true,
  })
})

test('翻译意图无选区时保留语音翻译粘贴', async () => {
  const task = await resolveVoiceTask('TranslateShortcut', reader({ selectedText: '', focusInfo: null }))

  assertTask(task, {
    mode: 'Translate',
    selectedText: '',
    focusInfo: null,
    delivery: 'paste',
    shouldRecordAudio: true,
  })
})
