/**
 * 语言设置区块
 *
 * 需要调整界面语言或翻译目标语言时看这里。
 */
import { Box, ListSubheader, MenuItem, Select, Typography } from '@mui/material'
import type { MenuProps } from '@mui/material/Menu'
import { useI18n, type TranslationKey } from '../../i18n'
import {
  INTERFACE_LANGUAGES,
  TRANSLATION_TARGET_LANGUAGES,
  type InterfaceLanguage,
  type LocalSettings,
} from '../../services/settingsStore'
import { bodyTextSx, sectionTitleSx } from '../../uiTokens'

type LanguageSettingsSectionProps = {
  settings: LocalSettings
  updateSettings: (next: LocalSettings) => Promise<void>
}

const rowSx = {
  display: 'grid',
  alignItems: 'center',
  gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) auto' },
  gap: 1.5,
  padding: '12px 0',
  borderBottom: '1px solid rgba(119,119,119,0.08)',
}

const sectionTitle = { ...sectionTitleSx, mt: 3, mb: 1 }

const targetLanguageMenuProps: Partial<MenuProps> = {
  slotProps: {
    paper: {
      sx: {
        maxHeight: 520,
        width: 320,
        borderRadius: '10px',
        boxShadow: '0 18px 48px rgba(15,23,42,0.16)',
      },
    },
    list: {
      sx: { py: 0 },
    },
  },
}

const interfaceLanguageMenuProps: Partial<MenuProps> = {
  slotProps: {
    paper: {
      sx: {
        maxHeight: 520,
        width: 300,
        borderRadius: '10px',
        boxShadow: '0 18px 48px rgba(15,23,42,0.16)',
      },
    },
    list: {
      sx: { py: 0.5 },
    },
  },
}

function getTargetLanguageLabel(value: string) {
  const language = TRANSLATION_TARGET_LANGUAGES.find((item) => item.id === value)
  return language?.displayName || language?.label || value
}

export default function LanguageSettingsSection({ settings, updateSettings }: LanguageSettingsSectionProps) {
  const { setLanguage, t } = useI18n()

  return (
    <>
      <Typography sx={sectionTitle}>{t('settings.language')}</Typography>
      <Box sx={rowSx}>
        <Typography sx={bodyTextSx}>{t('settings.interfaceLanguage')}</Typography>
        <Select
          size="small"
          value={settings.preferredLanguage}
          onChange={(event) => {
            const preferredLanguage = String(event.target.value) as InterfaceLanguage
            setLanguage(preferredLanguage)
            void updateSettings({ ...settings, preferredLanguage })
          }}
          sx={{ minWidth: { xs: '100%', sm: 240 }, width: { xs: '100%', sm: 'auto' } }}
          MenuProps={interfaceLanguageMenuProps}
        >
          {INTERFACE_LANGUAGES.map((language) => (
            <MenuItem key={language.id} value={language.id} sx={{ minHeight: 46 }}>
              {t(language.labelKey as TranslationKey)}
            </MenuItem>
          ))}
        </Select>
      </Box>
      <Box sx={rowSx}>
        <Typography sx={bodyTextSx}>{t('settings.translationTargetLanguage')}</Typography>
        <Select
          size="small"
          value={settings.translationTargetLanguage}
          onChange={(event) => void updateSettings({
            ...settings,
            translationTargetLanguage: String(event.target.value),
          })}
          renderValue={(value) => getTargetLanguageLabel(String(value))}
          MenuProps={targetLanguageMenuProps}
          sx={{ minWidth: { xs: '100%', sm: 240 }, width: { xs: '100%', sm: 'auto' } }}
        >
          <ListSubheader
            disableSticky
            sx={{
              bgcolor: '#eef3ff',
              color: '#667085',
              fontSize: 13,
              lineHeight: '34px',
              fontWeight: 500,
            }}
          >
            {t('settings.translationTargetSelectHint')}
          </ListSubheader>
          {TRANSLATION_TARGET_LANGUAGES.map((language) => (
            <MenuItem
              key={language.id}
              value={language.id}
              sx={{
                minHeight: 54,
                py: 0.8,
                px: 1.5,
                alignItems: 'flex-start',
                '&.Mui-selected': { bgcolor: '#f3f4f6' },
                '&.Mui-selected:hover': { bgcolor: '#eef2f7' },
              }}
            >
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.15, minWidth: 0 }}>
                <Typography sx={{ fontSize: 14, lineHeight: 1.35, fontWeight: 650, color: '#1f2937', letterSpacing: 0 }}>
                  {language.displayName || language.label}
                </Typography>
                <Typography sx={{ fontSize: 12, lineHeight: 1.25, fontWeight: 400, color: '#6b7280', letterSpacing: 0 }}>
                  {language.secondaryLabel || language.label}
                </Typography>
              </Box>
            </MenuItem>
          ))}
        </Select>
      </Box>
    </>
  )
}
