/**
 * 音频设置区块
 *
 * 需要选择麦克风时看这里。
 */
import { Box, MenuItem, Select, Typography } from '@mui/material'
import { type LocalSettings } from '../../services/settingsStore'
import { useI18n } from '../../i18n'
import { typo } from '../../uiTokens'

type AudioDevice = { deviceId: string; label?: string }

type AudioSettingsSectionProps = {
  settings: LocalSettings
  devices: AudioDevice[]
  updateSettings: (next: LocalSettings) => Promise<void>
}

const rowSx = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 0',
  borderBottom: '1px solid rgba(119,119,119,0.08)',
}

const sectionTitle = { ...typo.heading, mt: 3, mb: 1 }

export default function AudioSettingsSection({ settings, devices, updateSettings }: AudioSettingsSectionProps) {
  const { t } = useI18n()

  return (
    <>
      <Typography sx={sectionTitle}>{t('settings.microphone')}</Typography>
      <Box sx={rowSx}>
        <Select
          size="small"
          value={settings.selectedAudioDeviceId}
          onChange={(event) => void updateSettings({ ...settings, selectedAudioDeviceId: String(event.target.value) })}
          sx={{ minWidth: 240 }}
        >
          <MenuItem value="default">{t('settings.systemDefault')}</MenuItem>
          {devices.map((device) => (
            <MenuItem key={device.deviceId} value={device.deviceId}>
              {device.label || `${t('settings.inputDevice')} ${device.deviceId}`}
            </MenuItem>
          ))}
        </Select>
      </Box>

      {/* 自动启动设置暂时停用，恢复前需要先补系统真实状态读取和失败回滚。 */}
    </>
  )
}
