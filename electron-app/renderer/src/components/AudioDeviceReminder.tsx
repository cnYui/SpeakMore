/**
 * 新麦克风提醒
 *
 * 需要监听系统音频输入设备变化并询问是否切换时看这里。
 */
import { useEffect, useRef, useState } from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import MicIcon from '@mui/icons-material/Mic'
import { useI18n } from '../i18n'
import { ipcClient } from '../services/ipc'
import { saveSettings, type LocalSettings } from '../services/settingsStore'

type AudioDeviceReminderProps = {
  settings: LocalSettings
  onSettingsChange: (settings: LocalSettings) => void
}

type AudioInputDevice = {
  deviceId: string
  label: string
}

async function listAudioInputDevices(): Promise<AudioInputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((device) => device.kind === 'audioinput' && device.deviceId && device.deviceId !== 'default')
    .map((device) => ({
      deviceId: device.deviceId,
      label: device.label,
    }))
}

export default function AudioDeviceReminder({ settings, onSettingsChange }: AudioDeviceReminderProps) {
  const { t } = useI18n()
  const [pendingDevice, setPendingDevice] = useState<AudioInputDevice | null>(null)
  const knownDeviceIdsRef = useRef<Set<string>>(new Set())
  const settingsRef = useRef(settings)

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    let disposed = false

    const refreshKnownDevices = async () => {
      try {
        const devices = await listAudioInputDevices()
        if (disposed) return
        knownDeviceIdsRef.current = new Set(devices.map((device) => device.deviceId))
      } catch {
        knownDeviceIdsRef.current = new Set()
      }
    }

    void refreshKnownDevices()
    if (!navigator.mediaDevices?.addEventListener) return () => {
      disposed = true
    }

    const handleDeviceChange = async () => {
      try {
        const devices = await listAudioInputDevices()
        if (disposed) return
        const knownDeviceIds = knownDeviceIdsRef.current
        const addedDevice = devices.find((device) => !knownDeviceIds.has(device.deviceId))
        knownDeviceIdsRef.current = new Set(devices.map((device) => device.deviceId))

        if (!addedDevice || !settingsRef.current.remindOnNewAudioDevice) return
        setPendingDevice(addedDevice)
        void ipcClient.invoke('page:open-hub').catch(() => undefined)
      } catch {
        // 设备变化监听只负责提醒，不影响主录音链路。
      }
    }

    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange)
    return () => {
      disposed = true
      navigator.mediaDevices.removeEventListener?.('devicechange', handleDeviceChange)
    }
  }, [])

  const handleSwitch = async () => {
    if (!pendingDevice) return
    const saved = await saveSettings({
      ...settingsRef.current,
      selectedAudioDeviceId: pendingDevice.deviceId,
    })
    onSettingsChange(saved)
    setPendingDevice(null)
  }

  return (
    <Dialog open={Boolean(pendingDevice)} onClose={() => setPendingDevice(null)} maxWidth="xs" fullWidth>
      <DialogTitle>{t('settings.newAudioDevice.title')}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
          <MicIcon sx={{ mt: 0.4 }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography>{t('settings.newAudioDevice.message')}</Typography>
            <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.8, wordBreak: 'break-word' }}>
              {pendingDevice?.label || `${t('settings.inputDevice')} ${pendingDevice?.deviceId || ''}`}
            </Typography>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setPendingDevice(null)}>{t('settings.newAudioDevice.keep')}</Button>
        <Button variant="contained" onClick={() => void handleSwitch()}>{t('settings.newAudioDevice.switch')}</Button>
      </DialogActions>
    </Dialog>
  )
}
