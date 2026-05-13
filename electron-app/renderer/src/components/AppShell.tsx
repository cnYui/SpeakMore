import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, IconButton } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import Sidebar from './Sidebar'
import Dashboard from '../pages/Dashboard'
import History from '../pages/History'
import Settings from '../pages/Settings'
import Diagnostics from '../pages/Diagnostics'
import { type Page } from '../navigation'
import { ipcClient } from '../services/ipc'
import { loadSettings } from '../services/settingsStore'
import { disposeRecorder, toggleRecording } from '../services/recorder'
import {
  blockByLongPress,
  closeShortcutHint,
  createInitialShortcutGuardState,
  disposeShortcutGuard,
  reduceShortcutGuard,
} from '../services/shortcutGuard'
import { overlayCardSx, shortcutChipSx } from '../uiTokens'

export default function AppShell() {
  const [page, setPage] = useState<Page>('home')
  const [shortcutGuard, setShortcutGuard] = useState(createInitialShortcutGuardState)
  const shortcutGuardRef = useRef(shortcutGuard)

  useEffect(() => {
    const settings = loadSettings()
    ipcClient.invoke('page:set-floating-bar-enabled', { enabled: settings.showFloatingBar }).catch(() => undefined)
  }, [])

  const handleCloseShortcutHint = useCallback(() => {
    setShortcutGuard((prev) => closeShortcutHint(prev))
  }, [])

  const handleLongPress = useCallback(() => {
    setShortcutGuard((prev) => blockByLongPress(prev))
  }, [])

  useEffect(() => {
    shortcutGuardRef.current = shortcutGuard
  }, [shortcutGuard])

  useEffect(() => {
    return ipcClient.on('global-keyboard', (_event, keys) => {
      let nextMode: 'Dictate' | 'Ask' | 'Translate' | null = null

      setShortcutGuard((prev) => {
        const next = reduceShortcutGuard(prev, keys, handleLongPress)
        if (next.action.type === 'start-recording') nextMode = next.action.mode
        return next.state
      })

      if (nextMode) {
        void toggleRecording(nextMode)
      }
    })
  }, [handleLongPress])

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
      >
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Typeless Local</Typography>
      </Box>

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

      {shortcutGuard.modalVisible && (
        <Box sx={{ position: 'fixed', top: 72, right: 24, zIndex: 1600 }}>
          <Box sx={{ ...overlayCardSx, width: 360, p: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
              <Box>
                <Typography sx={{ fontSize: 16, fontWeight: 500 }}>检测到长按快捷键</Typography>
                <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.75 }}>
                  长按 Right Alt 不会开始语音输入。请短按 Right Alt，或使用 Right Alt + Space / Right Alt + Right Shift。
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 1.5 }}>
                  <Box component="span" sx={shortcutChipSx}>Right Alt</Box>
                  <Box component="span" sx={shortcutChipSx}>Right Alt + Space</Box>
                  <Box component="span" sx={shortcutChipSx}>Right Alt + Right Shift</Box>
                </Box>
              </Box>
              <IconButton size="small" onClick={handleCloseShortcutHint}>
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  )
}
