/**
 * 音频设置区块
 *
 * 需要选择麦克风、测试输入音量或控制录音音频行为时看这里。
 */
import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, IconButton, LinearProgress, MenuItem, Select, Switch, Typography } from '@mui/material'
import MicIcon from '@mui/icons-material/Mic'
import RefreshIcon from '@mui/icons-material/Refresh'
import StopIcon from '@mui/icons-material/Stop'
import VolumeUpIcon from '@mui/icons-material/VolumeUp'
import { type LocalSettings } from '../../services/settingsStore'
import { useI18n, type TranslationKey } from '../../i18n'
import { getAudioStreamForDevice, stopStreamTracks } from '../../services/voice/audioCapture'
import { cleanupAudioLevelMonitoring, startAudioLevelMonitoring } from '../../services/voice/audioLevelMonitor'
import { captionTextSx, helperTextSx, itemTitleSx, sectionTitleSx } from '../../uiTokens'

type AudioDevice = { deviceId: string; label?: string }

type AudioSettingsSectionProps = {
  settings: LocalSettings
  devices: AudioDevice[]
  refreshDevices: () => Promise<void>
  updateSettings: (next: LocalSettings) => Promise<void>
}

const rowSx = {
  display: 'grid',
  gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) auto' },
  alignItems: 'center',
  gap: 1.5,
  padding: '12px 0',
  borderBottom: '1px solid rgba(119,119,119,0.08)',
}

const testPanelSx = {
  bgcolor: 'rgba(119,119,119,0.06)',
  borderRadius: '8px',
  p: 2,
  mt: 1.5,
}

const sectionTitle = { ...sectionTitleSx, mt: 3, mb: 1 }

const audioToggleItems = [
  {
    key: 'interactionSoundsEnabled',
    title: 'settings.audio.interactionSounds',
    description: 'settings.audio.interactionSoundsHint',
  },
  {
    key: 'muteBackgroundAudioDuringRecording',
    title: 'settings.audio.muteBackgroundAudio',
    description: 'settings.audio.muteBackgroundAudioHint',
  },
  {
    key: 'showActiveMicrophoneHint',
    title: 'settings.audio.showActiveMicrophone',
    description: 'settings.audio.showActiveMicrophoneHint',
  },
  {
    key: 'remindOnNewAudioDevice',
    title: 'settings.audio.newDeviceReminder',
    description: 'settings.audio.newDeviceReminderHint',
  },
] as const

type AudioToggleKey = typeof audioToggleItems[number]['key']

function getDeviceLabel(device: AudioDevice | undefined, fallback: string) {
  if (!device) return fallback
  return device.label || `${fallback} ${device.deviceId}`
}

export default function AudioSettingsSection({
  settings,
  devices,
  refreshDevices,
  updateSettings,
}: AudioSettingsSectionProps) {
  const { t } = useI18n()
  const [isTesting, setIsTesting] = useState(false)
  const [testLevel, setTestLevel] = useState(0)
  const [testError, setTestError] = useState('')
  const testStreamRef = useRef<MediaStream | null>(null)

  const selectedDevice = devices.find((device) => device.deviceId === settings.selectedAudioDeviceId)
  const selectedDeviceText = settings.selectedAudioDeviceId === 'default'
    ? t('settings.audio.autoDetect')
    : getDeviceLabel(selectedDevice, t('settings.inputDevice'))

  const stopMicrophoneTest = () => {
    cleanupAudioLevelMonitoring()
    stopStreamTracks(testStreamRef.current)
    testStreamRef.current = null
    setIsTesting(false)
    setTestLevel(0)
  }

  useEffect(() => () => stopMicrophoneTest(), [])

  const startMicrophoneTest = async () => {
    setTestError('')
    stopMicrophoneTest()

    try {
      const stream = await getAudioStreamForDevice(settings.selectedAudioDeviceId)
      testStreamRef.current = stream
      setIsTesting(true)
      startAudioLevelMonitoring(stream, setTestLevel)
      void refreshDevices()
    } catch (error) {
      setTestError(error instanceof Error ? error.message : String(error))
    }
  }

  const updateToggle = (key: AudioToggleKey, checked: boolean) => {
    void updateSettings({ ...settings, [key]: checked })
  }

  return (
    <>
      <Typography sx={sectionTitle}>{t('settings.audio.title')}</Typography>
      <Box sx={rowSx}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={itemTitleSx}>{t('settings.microphone')}</Typography>
          <Typography sx={{ ...helperTextSx, color: 'text.secondary', mt: 0.3 }}>
            {selectedDeviceText}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifySelf: { xs: 'stretch', sm: 'end' }, flexWrap: 'wrap' }}>
          <IconButton
            aria-label={t('settings.audio.refreshDevices')}
            onClick={() => void refreshDevices()}
            size="small"
            sx={{ border: '1px solid rgba(119,119,119,0.16)' }}
          >
            <RefreshIcon fontSize="small" />
          </IconButton>
          <Select
            size="small"
            value={settings.selectedAudioDeviceId}
            onChange={(event) => void updateSettings({ ...settings, selectedAudioDeviceId: String(event.target.value) })}
            sx={{ minWidth: { xs: 0, sm: 260 }, flex: { xs: '1 1 220px', sm: '0 1 320px' }, maxWidth: '100%' }}
          >
            <MenuItem value="default">{t('settings.audio.autoDetect')}</MenuItem>
            {devices.map((device) => (
              <MenuItem key={device.deviceId} value={device.deviceId}>
                {getDeviceLabel(device, t('settings.inputDevice'))}
              </MenuItem>
            ))}
          </Select>
        </Box>
      </Box>

      <Box sx={testPanelSx}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={itemTitleSx}>{t('settings.audio.microphoneTest')}</Typography>
            <Typography sx={{ ...helperTextSx, color: 'text.secondary', mt: 0.3 }}>
              {isTesting ? t('settings.audio.microphoneTesting') : t('settings.audio.microphoneTestHint')}
            </Typography>
          </Box>
          <Button
            variant="outlined"
            startIcon={isTesting ? <StopIcon /> : <MicIcon />}
            onClick={() => {
              if (isTesting) stopMicrophoneTest()
              else void startMicrophoneTest()
            }}
            sx={{ borderRadius: '8px', whiteSpace: 'nowrap' }}
          >
            {isTesting ? t('settings.audio.stopTest') : t('settings.audio.startTest')}
          </Button>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mt: 1.5 }}>
          <VolumeUpIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
          <LinearProgress
            variant="determinate"
            value={Math.round(testLevel * 100)}
            sx={{ flex: 1, height: 8, borderRadius: 999, bgcolor: 'rgba(119,119,119,0.14)' }}
          />
          <Typography sx={{ ...captionTextSx, width: 42, color: 'text.secondary', textAlign: 'right' }}>
            {Math.round(testLevel * 100)}%
          </Typography>
        </Box>
        {testError ? (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {testError}
          </Alert>
        ) : null}
      </Box>

      <Box sx={{ mt: 1.5 }}>
        {audioToggleItems.map((item) => (
          <Box key={item.key} sx={rowSx}>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={itemTitleSx}>{t(item.title as TranslationKey)}</Typography>
              <Typography sx={{ ...helperTextSx, color: 'text.secondary', mt: 0.3 }}>
                {t(item.description as TranslationKey)}
              </Typography>
            </Box>
            <Switch
              checked={settings[item.key]}
              onChange={(event) => updateToggle(item.key, event.target.checked)}
              sx={{ justifySelf: { xs: 'start', sm: 'end' } }}
            />
          </Box>
        ))}
      </Box>
    </>
  )
}
