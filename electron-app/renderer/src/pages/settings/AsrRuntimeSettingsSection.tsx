import { useEffect, useState } from 'react'
import { Box, Button, Chip, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import { useI18n, type TranslationKey } from '../../i18n'
import { ipcClient } from '../../services/ipc'
import { getVoiceModelStatus, type VoiceModelStatus } from '../../services/modelSetupStore'
import { type AsrDeviceMode, type LocalSettings } from '../../services/settingsStore'
import { bodyTextSx, helperTextSx, sectionTitleSx } from '../../uiTokens'

type AsrRuntimeSettingsSectionProps = {
  settings: LocalSettings
  updateSettings: (next: LocalSettings) => Promise<void>
}

const rowSx = {
  display: 'grid',
  alignItems: 'center',
  gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) auto' },
  gap: 2,
  padding: '12px 0',
  borderBottom: '1px solid rgba(119,119,119,0.08)',
}

const sectionTitle = { ...sectionTitleSx, mt: 3, mb: 1 }

function normalizeMode(value: string | null): AsrDeviceMode | null {
  if (value === 'default' || value === 'mps' || value === 'cuda' || value === 'cpu') return value
  return null
}

type RuntimeDeviceOption = {
  value: AsrDeviceMode
  labelKey: TranslationKey
}

function getRuntimeDeviceOptions(platform: string): RuntimeDeviceOption[] {
  const accelerator: RuntimeDeviceOption | null = platform === 'darwin'
    ? { value: 'mps' as const, labelKey: 'settings.asrRuntime.mps' }
    : platform === 'win32'
      ? { value: 'cuda' as const, labelKey: 'settings.asrRuntime.cuda' }
      : null
  return [
    { value: 'default', labelKey: 'settings.asrRuntime.default' },
    ...(accelerator ? [accelerator] : []),
    { value: 'cpu', labelKey: 'settings.asrRuntime.cpu' },
  ]
}

function formatDeviceStatus(status: VoiceModelStatus | null) {
  if (!status?.device) return ''
  const requested = status.requested_device && status.requested_device !== status.device
    ? ` / ${status.requested_device}`
    : ''
  return `${status.device}${requested}`
}

export default function AsrRuntimeSettingsSection({
  settings,
  updateSettings,
}: AsrRuntimeSettingsSectionProps) {
  const { t } = useI18n()
  const [modelStatus, setModelStatus] = useState<VoiceModelStatus | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const deviceOptions = getRuntimeDeviceOptions(ipcClient.platform())
  const selectedMode = deviceOptions.some((option) => option.value === settings.asrDeviceMode)
    ? settings.asrDeviceMode
    : 'default'

  const refreshStatus = async () => {
    setIsRefreshing(true)
    try {
      setModelStatus(await getVoiceModelStatus(settings.modelCacheDir))
    } finally {
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    void refreshStatus()
  }, [settings.modelCacheDir])

  const deviceStatus = formatDeviceStatus(modelStatus)
  const fallbackReason = modelStatus?.fallback_reason || ''

  return (
    <>
      <Typography sx={sectionTitle}>{t('settings.asrRuntime.title')}</Typography>
      <Box sx={rowSx}>
        <Box>
          <Typography sx={bodyTextSx}>{t('settings.asrRuntime.mode')}</Typography>
          <Typography sx={{ ...helperTextSx, color: 'text.secondary', mt: 0.5 }}>
            {t('settings.asrRuntime.restartRequired')}
          </Typography>
          <Typography sx={{ ...helperTextSx, color: 'text.secondary', mt: 0.5 }}>
            {t('settings.asrRuntime.devModeHint')}
          </Typography>
        </Box>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={selectedMode}
          onChange={(_, value) => {
            const mode = normalizeMode(value)
            if (!mode || mode === settings.asrDeviceMode) return
            void updateSettings({ ...settings, asrDeviceMode: mode })
          }}
          sx={{ justifySelf: { xs: 'start', sm: 'end' }, flexWrap: 'wrap' }}
        >
          {deviceOptions.map((option) => (
            <ToggleButton key={option.value} value={option.value}>{t(option.labelKey)}</ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>
      <Box sx={{ ...rowSx, borderBottom: 'none' }}>
        <Box>
          <Typography sx={bodyTextSx}>{t('settings.asrRuntime.currentDevice')}</Typography>
          {fallbackReason ? (
            <Typography sx={{ ...helperTextSx, color: 'warning.main', mt: 0.5 }}>
              {t('settings.asrRuntime.fallbackReason')}：{fallbackReason}
            </Typography>
          ) : null}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifySelf: { xs: 'start', sm: 'end' }, flexWrap: 'wrap' }}>
          <Chip
            size="small"
            label={deviceStatus || t('settings.asrRuntime.unavailable')}
            color={fallbackReason ? 'warning' : 'default'}
          />
          <Button
            variant="outlined"
            size="small"
            startIcon={<RefreshIcon />}
            onClick={() => void refreshStatus()}
            disabled={isRefreshing}
          >
            {t('settings.asrRuntime.refresh')}
          </Button>
        </Box>
      </Box>
    </>
  )
}
