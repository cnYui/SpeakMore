/**
 * 语言设置区块
 *
 * 需要调整界面语言或翻译目标语言时看这里。
 */
import { Box, MenuItem, Select, Typography } from '@mui/material'
import { useI18n, type TranslationKey } from '../../i18n'
import {
  TRANSLATION_TARGET_LANGUAGES,
  type InterfaceLanguage,
  type LocalSettings,
} from '../../services/settingsStore'
import { typo } from '../../uiTokens'

type LanguageSettingsSectionProps = {
  settings: LocalSettings
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

export default function LanguageSettingsSection({ settings, updateSettings }: LanguageSettingsSectionProps) {
  const { setLanguage, t } = useI18n()

  return (
    <>
      <Typography sx={sectionTitle}>{t('settings.language')}</Typography>
      <Box sx={rowSx}>
        <Typography>{t('settings.interfaceLanguage')}</Typography>
        <Select
          size="small"
          value={settings.preferredLanguage}
          onChange={(event) => {
            const preferredLanguage = String(event.target.value) as InterfaceLanguage
            setLanguage(preferredLanguage)
            void updateSettings({ ...settings, preferredLanguage })
          }}
          sx={{ minWidth: 240 }}
        >
          <MenuItem value="zh-CN">{t('settings.zhCn')}</MenuItem>
          <MenuItem value="en-US">{t('settings.enUs')}</MenuItem>
        </Select>
      </Box>
      <Box sx={rowSx}>
        <Typography>{t('settings.translationTargetLanguage')}</Typography>
        <Select
          size="small"
          value={settings.translationTargetLanguage}
          onChange={(event) => void updateSettings({
            ...settings,
            translationTargetLanguage: String(event.target.value),
          })}
          sx={{ minWidth: 240 }}
        >
          {TRANSLATION_TARGET_LANGUAGES.map((language) => (
            <MenuItem key={language.id} value={language.id}>
              {t(`settings.translationTarget.${language.id}` as TranslationKey)}
            </MenuItem>
          ))}
        </Select>
      </Box>
    </>
  )
}
