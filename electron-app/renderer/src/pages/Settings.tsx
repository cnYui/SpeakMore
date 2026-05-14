import { useEffect, useState } from 'react'
import { Box, Typography, Select, MenuItem, Switch, Button } from '@mui/material'
import { ipcClient } from '../services/ipc'
import { loadSettings, saveSettings, type LocalSettings } from '../services/settingsStore'

const keybindChip = {
  borderRadius: '6px',
  border: '1px solid rgba(119,119,119,0.12)',
  padding: '4px 8px',
  fontSize: '13px',
  display: 'inline-block',
}

const rowSx = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 0',
  borderBottom: '1px solid rgba(119,119,119,0.08)',
}

const sectionTitle = { fontSize: 16, fontWeight: 500, mt: 3, mb: 1 }

function KeyChips({ keys }: { keys: string[] }) {
  return (
    <Box sx={{ display: 'flex', gap: 0.5 }}>
      {keys.map((key) => (
        <Box key={key} component="span" sx={keybindChip}>{key}</Box>
      ))}
    </Box>
  )
}

type AudioDevice = { deviceId: string; label?: string }

export default function Settings() {
  const [settings, setSettings] = useState<LocalSettings>({
    launchAtSystemStartup: false,
    showFloatingBar: true,
    selectedAudioDeviceId: 'default',
  })
  const [devices, setDevices] = useState<AudioDevice[]>([])

  useEffect(() => {
    loadSettings().then(setSettings).catch(() => undefined)
    navigator.mediaDevices.enumerateDevices()
      .then((items) => setDevices(items
        .filter((device) => device.kind === 'audioinput')
        .map((device) => ({ deviceId: device.deviceId, label: device.label }))))
      .catch(() => setDevices([]))
  }, [])

  const updateSettings = async (next: LocalSettings) => {
    setSettings(next)
    setSettings(await saveSettings(next))
  }

  return (
    <Box sx={{ maxWidth: 680, p: 3 }}>
      <Typography sx={{ fontSize: 24, fontWeight: 500, mb: 2 }}>设置</Typography>

      {/* 快捷键 */}
      <Typography sx={sectionTitle}>快捷键</Typography>
      <Box sx={rowSx}>
        <Typography>按下开始和停止语音输入。</Typography>
        <KeyChips keys={['Right Alt']} />
      </Box>
      <Box sx={rowSx}>
        <Typography>按下开始和停止自由提问。</Typography>
        <KeyChips keys={['Right Alt', 'Space']} />
      </Box>
      <Box sx={rowSx}>
        <Typography>按下开始和停止翻译。</Typography>
        <KeyChips keys={['Right Alt', 'Right Shift']} />
      </Box>

      {/* 麦克风 */}
      <Typography sx={sectionTitle}>麦克风</Typography>
      <Box sx={rowSx}>
        <Select
          size="small"
          value={settings.selectedAudioDeviceId}
          onChange={(event) => void updateSettings({ ...settings, selectedAudioDeviceId: String(event.target.value) })}
          sx={{ minWidth: 240 }}
        >
          <MenuItem value="default">系统默认</MenuItem>
          {devices.map((device) => (
            <MenuItem key={device.deviceId} value={device.deviceId}>
              {device.label || `输入设备 ${device.deviceId}`}
            </MenuItem>
          ))}
        </Select>
      </Box>

      {/* 语言 */}
      <Typography sx={sectionTitle}>语言</Typography>
      <Box sx={rowSx}>
        <Typography>简体中文 (zh-CN)</Typography>
      </Box>

      {/* 其他设置 */}
      <Box sx={rowSx}>
        <Typography>开机启动</Typography>
        <Switch
          checked={settings.launchAtSystemStartup}
          onChange={(_event, checked) => {
            ipcClient.invoke('permission:update-auto-launch', { enable: checked }).finally(() => {
              void updateSettings({ ...settings, launchAtSystemStartup: checked })
            })
          }}
        />
      </Box>
      <Box sx={rowSx}>
        <Typography>显示悬浮条</Typography>
        <Switch
          checked={settings.showFloatingBar}
          onChange={(_event, checked) => {
            void updateSettings({ ...settings, showFloatingBar: checked })
            ipcClient.invoke('page:set-floating-bar-enabled', { enabled: checked }).catch(() => undefined)
          }}
        />
      </Box>

      {/* 关于 */}
      <Box sx={{ ...rowSx, mt: 3 }}>
        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>版本 v1.3.0（本地版）</Typography>
        <Button variant="outlined" size="small" disabled>暂未提供更新检查</Button>
      </Box>
    </Box>
  )
}
