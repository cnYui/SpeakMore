import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createVoiceError,
  initialVoiceSession,
  toFloatingBarState,
} from './voiceTypes'

test('audio_empty 会复用取消态的悬浮条展示/隐藏通路', () => {
  const session = {
    ...initialVoiceSession,
    status: 'error' as const,
    error: createVoiceError('audio_empty'),
  }

  const floatingBarState = toFloatingBarState(session)

  assert.equal(session.status, 'error')
  assert.equal(session.error?.code, 'audio_empty')
  assert.equal(session.error?.message, '没有识别到声音')
  assert.equal(floatingBarState.status, 'cancelled')
  assert.equal(floatingBarState.displayText, '没有识别到声音')
})

test('自由提问录音态会给悬浮胶囊提供提问提示文案', () => {
  const session = {
    ...initialVoiceSession,
    status: 'recording' as const,
    mode: 'Ask' as const,
    inputLevel: 0.42,
  }

  const floatingBarState = toFloatingBarState(session)

  assert.equal(floatingBarState.status, 'recording')
  assert.equal(floatingBarState.mode, 'Ask')
  assert.equal(floatingBarState.inputLevel, 0.42)
  assert.equal(floatingBarState.displayText, '请随意提出问题')
})

test('普通听写录音态不覆盖悬浮胶囊默认监听文案', () => {
  const session = {
    ...initialVoiceSession,
    status: 'recording' as const,
    mode: 'Dictate' as const,
  }

  const floatingBarState = toFloatingBarState(session)

  assert.equal(floatingBarState.status, 'recording')
  assert.equal(floatingBarState.mode, 'Dictate')
  assert.equal(floatingBarState.displayText, undefined)
})
