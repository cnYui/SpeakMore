/**
 * 语音历史持久化副作用
 *
 * 需要把完成结果写入本地历史时看这里。
 */
import { useEffect, useRef } from 'react'
import { saveVoiceHistory, saveVoiceHistoryRetryAudio, VOICE_HISTORY_UPDATED_EVENT } from '../services/historyStore'
import { subscribeVoiceSession } from '../services/recorder'

export function useVoiceHistoryPersistence() {
  const savedAudioIds = useRef(new Set<string>())

  useEffect(() => {
    return subscribeVoiceSession((voiceSession) => {
      if (!voiceSession.audioId) return
      if (voiceSession.mode === 'MeetingNotes') return
      if (voiceSession.status !== 'completed' && voiceSession.status !== 'error') return
      if (savedAudioIds.current.has(voiceSession.audioId)) return

      const audioId = voiceSession.audioId
      savedAudioIds.current.add(audioId)
      const retryAudioWavBase64 = voiceSession.retryAudioWavBase64 || ''
      const retryableMode = voiceSession.mode === 'Dictate' || voiceSession.mode === 'Translate'
      const isError = voiceSession.status === 'error'
      void saveVoiceHistory({
        id: audioId,
        createdAt: new Date().toISOString(),
        mode: voiceSession.mode,
        status: voiceSession.status === 'completed' ? 'completed' : 'error',
        rawText: voiceSession.rawText,
        refinedText: voiceSession.refinedText,
        errorCode: voiceSession.error?.code,
        errorMessage: voiceSession.error?.message || voiceSession.error?.detail || '',
        hasRetryAudio: false,
        retryable: isError && retryableMode && Boolean(voiceSession.rawText),
        durationMs: voiceSession.durationMs,
        textLength: voiceSession.textLength,
      }).then(async (savedItem) => {
        if (!savedItem) {
          savedAudioIds.current.delete(audioId)
          return
        }

        if (isError && retryableMode && retryAudioWavBase64) {
          await saveVoiceHistoryRetryAudio(audioId, retryAudioWavBase64)
        }

        window.dispatchEvent(new Event(VOICE_HISTORY_UPDATED_EVENT))
      }).catch(() => {
        savedAudioIds.current.delete(audioId)
      })
    })
  }, [])
}
