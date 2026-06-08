import { useEffect, useState } from 'react'
import { Box, Button, Chip, Typography } from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import SettingsIcon from '@mui/icons-material/Settings'
import { useI18n } from '../../i18n'
import {
  getMacOSAccessibilityStatus,
  isMacOSRuntime,
  openMacOSAccessibilitySettings,
  type MacOSAccessibilityStatus,
} from '../../services/macosPermissions'
import { bodyTextSx, helperTextSx, sectionTitleSx } from '../../uiTokens'

const rowSx = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 2,
  padding: '12px 0',
  borderBottom: '1px solid rgba(119,119,119,0.08)',
}

const sectionTitle = { ...sectionTitleSx, mt: 3, mb: 1 }

export default function MacOSPermissionSection() {
  const { t } = useI18n()
  const [status, setStatus] = useState<MacOSAccessibilityStatus | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const refresh = async () => {
    setIsRefreshing(true)
    try {
      setStatus(await getMacOSAccessibilityStatus())
    } finally {
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    if (!isMacOSRuntime()) return
    void refresh()
  }, [])

  useEffect(() => {
    if (!isMacOSRuntime()) return undefined

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const refreshWhenFocused = () => {
      void refresh()
    }

    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('focus', refreshWhenFocused)

    return () => {
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('focus', refreshWhenFocused)
    }
  }, [])

  if (!isMacOSRuntime()) return null

  const trusted = status?.trusted === true
  const statusLabel = trusted ? t('settings.macosAccessibility.trusted') : t('settings.macosAccessibility.missing')

  return (
    <>
      <Typography sx={sectionTitle}>{t('settings.macosPermissions')}</Typography>
      <Box sx={rowSx}>
        <Box>
          <Typography sx={bodyTextSx}>{t('settings.macosAccessibility')}</Typography>
          <Typography sx={{ ...helperTextSx, color: 'text.secondary', mt: 0.5 }}>
            {trusted
              ? t('settings.macosAccessibility.readyHint')
              : t('settings.macosAccessibility.missingHint')}
          </Typography>
        </Box>
        <Chip
          size="small"
          label={statusLabel}
          color={trusted ? 'success' : 'warning'}
        />
      </Box>
      <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={() => void refresh()}
          disabled={isRefreshing}
        >
          {t('settings.macosAccessibility.refresh')}
        </Button>
        {!trusted ? (
          <Button
            variant="contained"
            startIcon={<SettingsIcon />}
            onClick={() => void openMacOSAccessibilitySettings()}
          >
            {t('settings.macosAccessibility.openSettings')}
          </Button>
        ) : null}
      </Box>
    </>
  )
}
