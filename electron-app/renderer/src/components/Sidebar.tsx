import { Box, Typography, ButtonBase } from '@mui/material'
import HomeIcon from '@mui/icons-material/Home'
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted'
import SettingsIcon from '@mui/icons-material/Settings'
import BugReportIcon from '@mui/icons-material/BugReport'
import { pages, type Page } from '../navigation'

const iconByPage: Record<Page, React.ReactNode> = {
  home: <HomeIcon sx={{ fontSize: 18 }} />,
  history: <FormatListBulletedIcon sx={{ fontSize: 18 }} />,
  settings: <SettingsIcon sx={{ fontSize: 18 }} />,
  diagnostics: <BugReportIcon sx={{ fontSize: 18 }} />,
}

const navItems: { label: string; page: Page; icon: React.ReactNode }[] = pages.map((item) => ({
  ...item,
  icon: iconByPage[item.page],
}))

interface Props {
  activePage: Page
  onNavigate: (page: Page) => void
}

export default function Sidebar({ activePage, onNavigate }: Props) {
  return (
    <Box sx={{ width: 202, flexShrink: 0, display: 'flex', flexDirection: 'column', p: '12px' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography sx={{ fontSize: 16, fontWeight: 500, color: 'text.primary' }}>SpeakMore</Typography>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {navItems.map((item) => (
          <ButtonBase
            key={item.page}
            onClick={() => onNavigate(item.page)}
            sx={{
              height: 36,
              px: '10px',
              py: '8px',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              justifyContent: 'flex-start',
              ...(activePage === item.page
                ? { bgcolor: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }
                : { '&:hover': { bgcolor: 'rgba(119,119,119,0.07)' } }),
            }}
          >
            {item.icon}
            <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'text.primary' }}>{item.label}</Typography>
          </ButtonBase>
        ))}
      </Box>

      <Box sx={{ flex: 1 }} />
    </Box>
  )
}
