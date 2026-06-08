/**
 * 应用行为设置区块
 *
 * 需要控制开机启动、悬浮胶囊或主窗口关闭行为时看这里。
 */
import { Alert, Box, Switch, Typography } from '@mui/material'
import { useI18n, type TranslationKey } from '../../i18n'
import { type LocalSettings } from '../../services/settingsStore'
import { helperTextSx, itemTitleSx, sectionTitleSx } from '../../uiTokens'

type ApplicationBehaviorSettingsSectionProps = {
  settings: LocalSettings
  settingsSaveMessage: string
  updateSettings: (next: LocalSettings) => Promise<void>
}

const sectionTitle = { ...sectionTitleSx, mt: 4, mb: 1 }

const behaviorPanelSx = {
  bgcolor: 'rgba(119,119,119,0.06)',
  borderRadius: '8px',
  p: 2,
  mb: 1.5,
}

const behaviorItems = [
  {
    key: 'launchAtSystemStartup',
    title: 'settings.appBehavior.launchAtStartup',
    description: 'settings.appBehavior.launchAtStartupHint',
  },
  {
    key: 'meetingDetectionEnabled',
    title: 'settings.appBehavior.meetingDetection',
    description: 'settings.appBehavior.meetingDetectionHint',
  },
  {
    key: 'showFloatingBar',
    title: 'settings.appBehavior.floatingBar',
    description: 'settings.appBehavior.floatingBarHint',
  },
  {
    key: 'hideMainWindowOnClose',
    title: 'settings.appBehavior.hideOnClose',
    description: 'settings.appBehavior.hideOnCloseHint',
  },
] as const

type BehaviorToggleKey = typeof behaviorItems[number]['key']

export default function ApplicationBehaviorSettingsSection({
  settings,
  settingsSaveMessage,
  updateSettings,
}: ApplicationBehaviorSettingsSectionProps) {
  const { t } = useI18n()

  const updateToggle = (key: BehaviorToggleKey, checked: boolean) => {
    void updateSettings({ ...settings, [key]: checked })
  }

  return (
    <>
      <Typography sx={sectionTitle}>{t('settings.appBehavior.title')}</Typography>
      {settingsSaveMessage ? (
        <Alert severity="info" sx={{ mb: 1.5 }}>
          {t(settingsSaveMessage as TranslationKey)}
        </Alert>
      ) : null}
      {behaviorItems.map((item) => (
        <Box key={item.key} sx={behaviorPanelSx}>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: 1.5, alignItems: 'start' }}>
            <Switch
              checked={settings[item.key]}
              onChange={(event) => updateToggle(item.key, event.target.checked)}
              sx={{ mt: -0.5 }}
            />
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={itemTitleSx}>{t(item.title as TranslationKey)}</Typography>
              <Typography sx={{ ...helperTextSx, color: 'text.secondary', mt: 0.6 }}>
                {t(item.description as TranslationKey)}
              </Typography>
            </Box>
          </Box>
        </Box>
      ))}
    </>
  )
}
