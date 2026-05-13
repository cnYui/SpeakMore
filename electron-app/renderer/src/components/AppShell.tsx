import { useEffect, useState } from 'react'
import { Box, Typography } from '@mui/material'
import Sidebar from './Sidebar'
import Dashboard from '../pages/Dashboard'
import History from '../pages/History'
import Settings from '../pages/Settings'
import Diagnostics from '../pages/Diagnostics'
import { type Page } from '../navigation'
import { ipcClient } from '../services/ipc'
import { loadSettings } from '../services/settingsStore'

export default function AppShell() {
  const [page, setPage] = useState<Page>('home')

  useEffect(() => {
    const settings = loadSettings()
    ipcClient.invoke('page:set-floating-bar-enabled', { enabled: settings.showFloatingBar }).catch(() => undefined)
  }, [])

  const content = {
    home: <Dashboard />,
    history: <History />,
    settings: <Settings />,
    diagnostics: <Diagnostics />,
  }

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
    </Box>
  )
}
