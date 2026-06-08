import { useEffect, useMemo, useState } from 'react'
import { Box } from '@mui/material'
import AudioDeviceReminder from './AudioDeviceReminder'
import Sidebar from './Sidebar'
import Dashboard from '../pages/Dashboard'
import Dictionary from '../pages/Dictionary'
import Shortcuts from '../pages/Shortcuts'
import MeetingNotes, { type MeetingAutoStartRequest } from '../pages/MeetingNotes'
import Settings from '../pages/Settings'
import { type Page } from '../navigation'
import { I18nProvider } from '../i18n'
import {
  defaultSettings,
  loadSettings,
  subscribeSettingsChanges,
  type InterfaceLanguage,
  type LocalSettings,
} from '../services/settingsStore'
import { disposeRecorder } from '../services/recorder'
import { ipcClient } from '../services/ipc'
import { useGlobalShortcutBridge } from './useGlobalShortcutBridge'
import { useVoiceHistoryPersistence } from './useVoiceHistoryPersistence'

export default function AppShell() {
  const [page, setPage] = useState<Page>('home')
  const [language, setLanguage] = useState<InterfaceLanguage>(defaultSettings.preferredLanguage)
  const [appSettings, setAppSettings] = useState<LocalSettings>(defaultSettings)
  const [meetingAutoStartRequest, setMeetingAutoStartRequest] = useState<MeetingAutoStartRequest | null>(null)
  useGlobalShortcutBridge()
  useVoiceHistoryPersistence()

  useEffect(() => {
    let cancelled = false

    loadSettings()
      .then((settings) => {
        if (!cancelled) {
          setAppSettings(settings)
          setLanguage(settings.preferredLanguage)
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => subscribeSettingsChanges((settings) => {
    setAppSettings(settings)
    setLanguage(settings.preferredLanguage)
  }), [])

  useEffect(() => {
    return () => {
      disposeRecorder()
    }
  }, [])

  useEffect(() => ipcClient.on('meeting:auto-start-recording', (_event, payload) => {
    const request = payload && typeof payload === 'object'
      ? payload as Partial<MeetingAutoStartRequest>
      : {}
    setMeetingAutoStartRequest({
      requestId: request.requestId || `${Date.now()}`,
      appName: request.appName,
      appIdentifier: request.appIdentifier,
      windowTitle: request.windowTitle,
      audioSource: request.audioSource,
      targetLanguage: request.targetLanguage,
    })
    setPage('meetingNotes')
  }), [])

  const content = useMemo(() => ({
    home: <Dashboard />,
    dictionary: <Dictionary />,
    shortcuts: <Shortcuts />,
    meetingNotes: (
      <MeetingNotes
        autoStartRequest={meetingAutoStartRequest}
        onAutoStartConsumed={(requestId) => {
          setMeetingAutoStartRequest((current) => current?.requestId === requestId ? null : current)
        }}
      />
    ),
    settings: <Settings />,
  }), [meetingAutoStartRequest])

  return (
    <I18nProvider language={language} setLanguage={setLanguage}>
      <Box sx={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <AudioDeviceReminder settings={appSettings} onSettingsChange={setAppSettings} />
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
              minWidth: 0,
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
    </I18nProvider>
  )
}
