import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box } from '@mui/material'
import Sidebar from './Sidebar'
import Dashboard from '../pages/Dashboard'
import History from '../pages/History'
import Settings from '../pages/Settings'
import Diagnostics from '../pages/Diagnostics'
import { type Page } from '../navigation'
import { ipcClient } from '../services/ipc'
import {
  cancelRecording,
  disposeRecorder,
  getVoiceSession,
  subscribeVoiceSession,
  toggleRecordingByShortcut,
} from '../services/recorder'
import { saveVoiceHistory, VOICE_HISTORY_UPDATED_EVENT } from '../services/historyStore'
import { hideFloatingPanel, showShortcutHintPanel } from '../services/floatingPanel'
import {
  blockByLongPress,
  createInitialShortcutGuardState,
  disposeShortcutGuard,
  reduceShortcutGuard,
} from '../services/shortcutGuard'

const CANCELABLE_STATUSES = new Set(['connecting', 'recording', 'stopping', 'transcribing'])

export default function AppShell() {
  const [page, setPage] = useState<Page>('home')
  const [shortcutGuard, setShortcutGuard] = useState(createInitialShortcutGuardState)
  const shortcutGuardRef = useRef(shortcutGuard)
  const shortcutHintMountedRef = useRef(false)
  const savedAudioIds = useRef(new Set<string>())

  const applyShortcutGuard = useCallback((nextGuard: typeof shortcutGuard) => {
    shortcutGuardRef.current = nextGuard
    setShortcutGuard(nextGuard)
  }, [])

  const handleLongPress = useCallback(() => {
    applyShortcutGuard(blockByLongPress(shortcutGuardRef.current))
  }, [applyShortcutGuard])

  useEffect(() => {
    shortcutGuardRef.current = shortcutGuard
  }, [shortcutGuard])

  useEffect(() => {
    if (!shortcutHintMountedRef.current) {
      shortcutHintMountedRef.current = true
      return
    }

    if (shortcutGuard.modalVisible) {
      showShortcutHintPanel()
      return
    }

    hideFloatingPanel()
  }, [shortcutGuard.modalVisible])

  useEffect(() => {
    return ipcClient.on('global-keyboard', (_event, keys) => {
      const next = reduceShortcutGuard(
        shortcutGuardRef.current,
        keys,
        {
          voiceStatus: getVoiceSession().status,
          debugLog: (event, payload) => {
            if (import.meta.env.DEV) {
              console.debug(`[shortcut-debug] ${event}`, payload)
            }
          },
        },
        handleLongPress,
      )
      applyShortcutGuard(next.state)

      if (next.action.type === 'toggle-recording') {
        void toggleRecordingByShortcut(next.action.intent)
      }
    })
  }, [applyShortcutGuard, handleLongPress])

  useEffect(() => {
    return ipcClient.on('voice-cancel-requested', () => {
      if (!CANCELABLE_STATUSES.has(getVoiceSession().status)) return
      cancelRecording()
    })
  }, [])

  useEffect(() => {
    return subscribeVoiceSession((voiceSession) => {
      if (!voiceSession.audioId) return
      if (voiceSession.status !== 'completed' && voiceSession.status !== 'error') return
      if (savedAudioIds.current.has(voiceSession.audioId)) return

      savedAudioIds.current.add(voiceSession.audioId)
      void saveVoiceHistory({
        id: voiceSession.audioId,
        createdAt: new Date().toISOString(),
        mode: voiceSession.mode,
        status: voiceSession.status === 'completed' ? 'completed' : 'error',
        rawText: voiceSession.rawText,
        refinedText: voiceSession.refinedText,
        errorCode: voiceSession.error?.code,
        durationMs: voiceSession.durationMs,
        textLength: voiceSession.textLength,
      }).then((savedItem) => {
        if (!savedItem) {
          savedAudioIds.current.delete(voiceSession.audioId!)
          return
        }

        window.dispatchEvent(new Event(VOICE_HISTORY_UPDATED_EVENT))
      })
    })
  }, [])

  useEffect(() => {
    return () => {
      disposeShortcutGuard(shortcutGuardRef.current)
      disposeRecorder()
    }
  }, [])

  const content = useMemo(() => ({
    home: <Dashboard />,
    history: <History />,
    settings: <Settings />,
    diagnostics: <Diagnostics />,
  }), [])

  return (
    <Box sx={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Box
        sx={{
          height: 48,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          px: 2,
          WebkitAppRegion: 'drag',
        }}
      />

      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Sidebar activePage={page} onNavigate={setPage} />
        <Box
          sx={{
            flex: 1,
            bgcolor: 'background.paper',
            borderRadius: '8px',
            border: '1px solid rgba(119,119,119,0.15)',
            overflow: 'auto',
          }}
        >
          {content[page]}
        </Box>
      </Box>
    </Box>
  )
}
