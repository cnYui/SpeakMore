import { Box, ButtonBase, IconButton, Typography } from '@mui/material'
import AppsOutlinedIcon from '@mui/icons-material/AppsOutlined'
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined'
import MenuBookIcon from '@mui/icons-material/MenuBookOutlined'
import NoteAltOutlinedIcon from '@mui/icons-material/NoteAltOutlined'
import PersonOutlineOutlinedIcon from '@mui/icons-material/PersonOutlineOutlined'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import { type Page } from '../navigation'
import { useI18n, type TranslationKey } from '../i18n'
import { navTextSx } from '../uiTokens'

type SidebarItem = {
  labelKey: TranslationKey
  page: Page
  icon: React.ReactNode
}

const primaryItems: SidebarItem[] = [
  { labelKey: 'nav.home', page: 'home', icon: <HomeOutlinedIcon /> },
  { labelKey: 'nav.dictionary', page: 'dictionary', icon: <MenuBookIcon /> },
  { labelKey: 'nav.shortcuts', page: 'shortcuts', icon: <AppsOutlinedIcon /> },
]

const meetingItem: SidebarItem = {
  labelKey: 'nav.meetingNotes',
  page: 'meetingNotes',
  icon: <NoteAltOutlinedIcon />,
}

interface Props {
  activePage: Page
  onNavigate: (page: Page) => void
}

function SidebarNavButton({ item, active, onNavigate }: { item: SidebarItem; active: boolean; onNavigate: (page: Page) => void }) {
  const { t } = useI18n()

  return (
    <ButtonBase
      onClick={() => onNavigate(item.page)}
      sx={{
        width: '100%',
        height: 42,
        px: 1.1,
        borderRadius: '9px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: 1,
        color: active ? '#111827' : '#111827',
        bgcolor: active ? '#e9e9e9' : 'transparent',
        transition: 'background-color 120ms ease',
        '&:hover': {
          bgcolor: active ? '#e9e9e9' : 'rgba(17,17,17,0.04)',
        },
        '& svg': {
          fontSize: 20,
          color: active ? '#111827' : '#70757d',
          strokeWidth: 1.5,
        },
      }}
    >
      {item.icon}
      <Typography sx={navTextSx}>
        {t(item.labelKey)}
      </Typography>
    </ButtonBase>
  )
}

export default function Sidebar({ activePage, onNavigate }: Props) {
  const { t } = useI18n()

  return (
    <Box
      sx={{
        width: 208,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: '#fbfbfb',
        borderRight: '1px solid rgba(17,17,17,0.04)',
        px: 1,
        pt: 1.1,
        pb: 1,
      }}
    >
      <Typography
        sx={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          m: '-1px',
          p: 0,
          overflow: 'hidden',
          clipPath: 'inset(50%)',
          whiteSpace: 'nowrap',
        }}
      >
        SpeakMore
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.7 }}>
        {primaryItems.map((item) => (
          <SidebarNavButton
            key={item.page}
            item={item}
            active={activePage === item.page}
            onNavigate={onNavigate}
          />
        ))}
      </Box>

      <Box sx={{ height: '1px', bgcolor: 'rgba(17,17,17,0.09)', mt: 1.2, mb: 1 }} />
      <SidebarNavButton item={meetingItem} active={activePage === meetingItem.page} onNavigate={onNavigate} />

      <Box sx={{ flex: 1, minHeight: 20 }} />
      <Box sx={{ height: '1px', bgcolor: 'rgba(17,17,17,0.08)', mb: 0.75 }} />

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 0.9 }}>
        <IconButton aria-label="用户" sx={{ color: '#70757d', width: 36, height: 36 }}>
          <PersonOutlineOutlinedIcon sx={{ fontSize: 22 }} />
        </IconButton>
        <IconButton
          aria-label={t('nav.settings')}
          onClick={() => onNavigate('settings')}
          sx={{
            color: activePage === 'settings' ? '#111827' : '#70757d',
            width: 36,
            height: 36,
            bgcolor: activePage === 'settings' ? '#e9e9e9' : 'transparent',
            '&:hover': { bgcolor: 'rgba(17,17,17,0.04)' },
          }}
        >
          <SettingsOutlinedIcon sx={{ fontSize: 22 }} />
        </IconButton>
      </Box>
    </Box>
  )
}
