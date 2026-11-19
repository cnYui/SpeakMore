import { useEffect, useMemo, useState } from 'react'
import { Box } from '@mui/material'
import Sidebar from './Sidebar'
import GlassFilters from './GlassFilters'
import VoiceInputMenu from './VoiceInputMenu'
import Dashboard from '../pages/Dashboard'
import History from '../pages/History'
import Dictionary from '../pages/Dictionary'
import Settings from '../pages/Settings'
import Setup from '../pages/Setup'
import { type Page } from '../navigation'
import { I18nProvider } from '../i18n'
import { defaultSettings, loadSettings, type InterfaceLanguage } from '../services/settingsStore'
import { disposeRecorder } from '../services/recorder'
import { useGlobalShortcutBridge } from './useGlobalShortcutBridge'
import { useVoiceHistoryPersistence } from './useVoiceHistoryPersistence'

export default function AppShell() {
  const [page, setPage] = useState<Page>('setup')
  const [language, setLanguage] = useState<InterfaceLanguage>(defaultSettings.preferredLanguage)
  useGlobalShortcutBridge()
  useVoiceHistoryPersistence()

  useEffect(() => {
    let cancelled = false

    loadSettings()
      .then((settings) => {
        if (!cancelled) setLanguage(settings.preferredLanguage)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return () => {
      disposeRecorder()
    }
  }, [])

  const content = useMemo(() => ({
    setup: <Setup onOpenSettings={() => setPage('settings')} />,
    home: <Dashboard />,
    history: <History />,
    dictionary: <Dictionary />,
    settings: <Settings />,
  }), [])

  return (
    <I18nProvider language={language} setLanguage={setLanguage}>
      <Box sx={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <GlassFilters />
        <Box
          sx={{
            height: 48,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            // 右侧要给系统的最小化 / 最大化 / 关闭按钮（titleBarOverlay）留出位置。
            pl: 2,
            pr: '156px',
            WebkitAppRegion: 'drag',
          }}
        >
          <VoiceInputMenu />
        </Box>

        <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <Sidebar activePage={page} onNavigate={setPage} />
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              // 内容区不再是一整块白底：各页面自己放玻璃卡片，滚动时背景的光斑保持不动。
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
