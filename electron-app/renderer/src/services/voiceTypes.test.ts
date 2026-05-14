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
