/**
 * 快捷键设置区块
 *
 * 需要展示固定快捷键说明时看这里。
 */
import { Box, Typography } from '@mui/material'
import { useI18n } from '../../i18n'
import { getShortcutLabelSet } from '../../services/shortcutLabels'
import { typo } from '../../uiTokens'

const keybindChip = {
  borderRadius: '6px',
  border: '1px solid rgba(119,119,119,0.12)',
  padding: '4px 8px',
  ...typo.caption,
  display: 'inline-block',
}

const rowSx = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 0',
  borderBottom: '1px solid rgba(119,119,119,0.08)',
}

const sectionTitle = { ...typo.heading, mt: 3, mb: 1 }

function KeyChips({ keys }: { keys: string[] }) {
  return (
    <Box sx={{ display: 'flex', gap: 0.5 }}>
      {keys.map((key) => (
        <Box key={key} component="span" sx={keybindChip}>{key}</Box>
      ))}
    </Box>
  )
}

export default function ShortcutSettingsSection() {
  const { t } = useI18n()
  const shortcuts = getShortcutLabelSet()

  return (
    <>
      <Typography sx={sectionTitle}>{t('settings.shortcuts')}</Typography>
      <Box sx={rowSx}>
        <Typography>{t('settings.shortcut.dictation')}</Typography>
        <KeyChips keys={shortcuts.dictation} />
      </Box>
      <Box sx={rowSx}>
        <Typography>{t('settings.shortcut.ask')}</Typography>
        <KeyChips keys={shortcuts.ask} />
      </Box>
      <Box sx={rowSx}>
        <Typography>{t('settings.shortcut.translate')}</Typography>
        <KeyChips keys={shortcuts.translate} />
      </Box>
    </>
  )
}
