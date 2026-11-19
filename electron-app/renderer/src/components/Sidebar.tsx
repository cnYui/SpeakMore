import { Box, Typography, ButtonBase } from '@mui/material'
import HomeIcon from '@mui/icons-material/Home'
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import SettingsIcon from '@mui/icons-material/Settings'
import CloudDownloadIcon from '@mui/icons-material/CloudDownload'
import { pages, type Page } from '../navigation'
import { useI18n } from '../i18n'
import { typo } from '../uiTokens'

const iconByPage: Record<Page, React.ReactNode> = {
  setup: <CloudDownloadIcon sx={{ fontSize: 18 }} />,
  home: <HomeIcon sx={{ fontSize: 18 }} />,
  history: <FormatListBulletedIcon sx={{ fontSize: 18 }} />,
  dictionary: <AutoAwesomeIcon sx={{ fontSize: 18 }} />,
  settings: <SettingsIcon sx={{ fontSize: 18 }} />,
}

const navItems: { labelKey: (typeof pages)[number]['labelKey']; page: Page; icon: React.ReactNode }[] = pages.map((item) => ({
  ...item,
  icon: iconByPage[item.page],
}))

interface Props {
  activePage: Page
  onNavigate: (page: Page) => void
}

export default function Sidebar({ activePage, onNavigate }: Props) {
  const { t } = useI18n()

  return (
    // 悬浮在窗口左侧的玻璃侧边栏（和 macOS 版 Liquid Glass 的浮动侧边栏一致）：四周留边、大圆角。
    <Box
      className="glass"
      sx={{ width: 202, flexShrink: 0, display: 'flex', flexDirection: 'column', p: '12px', m: '0 8px 12px 12px', borderRadius: '24px' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, px: '4px' }}>
        <Typography sx={{ ...typo.heading, color: 'text.primary' }}>SpeakMore</Typography>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {navItems.map((item) => (
          <ButtonBase
            key={item.page}
            // 选中项是带边缘折射的小玻璃块，强调色的图标。
            className={activePage === item.page ? 'glass-lens' : undefined}
            onClick={() => onNavigate(item.page)}
            sx={{
              height: 38,
              px: '12px',
              py: '8px',
              borderRadius: 9999,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              justifyContent: 'flex-start',
              ...(activePage === item.page
                ? { color: 'primary.main' }
                : { '&:hover': { bgcolor: 'rgba(255,255,255,0.5)' } }),
            }}
          >
            {item.icon}
            <Typography sx={{ ...typo.bodyMedium, color: 'text.primary' }}>{t(item.labelKey)}</Typography>
          </ButtonBase>
        ))}
      </Box>

      <Box sx={{ flex: 1 }} />
    </Box>
  )
}
