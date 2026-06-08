import { Box, Typography } from '@mui/material'
import { useState } from 'react'
import { ShortcutBindingDialog, ShortcutDisplayButtons } from '../../components/ShortcutBindingDialog'
import { useVoiceShortcutDisplay } from '../../components/useVoiceShortcutDisplay'
import { useI18n } from '../../i18n'
import type { ShortcutCommand } from '../../services/shortcutCommandStore'
import { bodyTextSx, captionTextSx, sectionTitleSx } from '../../uiTokens'

const sectionTitle = { ...sectionTitleSx, mt: 3, mb: 1 }

const shortcutPanelSx = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  borderTop: '1px solid rgba(119,119,119,0.08)',
  borderBottom: '1px solid rgba(119,119,119,0.08)',
  py: 1.25,
}

const shortcutLineSx = {
  ...bodyTextSx,
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  rowGap: 0.75,
  color: '#2f2f2f',
}

export default function ShortcutSettingsSection() {
  const { t } = useI18n()
  const [bindingShortcutCommand, setBindingShortcutCommand] = useState<ShortcutCommand | null>(null)
  const {
    voiceInputCommand,
    voiceShortcutDisplay,
    smartAssistantAvailable,
    translateCommand,
    translateShortcutDisplay,
    translateCommandEnabled,
    saveCommand: saveShortcutCommand,
  } = useVoiceShortcutDisplay()

  const openVoiceShortcutBinding = () => {
    if (voiceInputCommand) setBindingShortcutCommand(voiceInputCommand)
  }

  const openTranslateShortcutBinding = () => {
    if (translateCommand) setBindingShortcutCommand(translateCommand)
  }

  const handleSaveShortcutBinding = async (command: Partial<ShortcutCommand>) => {
    await saveShortcutCommand(command)
    setBindingShortcutCommand(null)
  }

  return (
    <>
      <Typography sx={sectionTitle}>{t('settings.shortcuts')}</Typography>
      <Box sx={shortcutPanelSx}>
        <Typography component="div" sx={shortcutLineSx}>
          <Box component="span">{t('settings.shortcut.voicePrefix')}</Box>
          <ShortcutDisplayButtons
            display={voiceShortcutDisplay}
            ariaLabel={t('settings.shortcut.bindVoiceInput')}
            onClick={openVoiceShortcutBinding}
          />
          <Box component="span">{t('settings.shortcut.voiceSuffix')}</Box>
        </Typography>
        <Typography component="div" sx={{ ...shortcutLineSx, color: smartAssistantAvailable ? '#2f2f2f' : 'text.disabled' }}>
          <Box component="span">{t('settings.shortcut.smartPrefix')}</Box>
          <ShortcutDisplayButtons
            display={voiceShortcutDisplay}
            disabled={!smartAssistantAvailable}
            ariaLabel={t('settings.shortcut.bindVoiceInput')}
            onClick={smartAssistantAvailable ? openVoiceShortcutBinding : undefined}
          />
          <Box component="span">{t('settings.shortcut.smartSuffix')}</Box>
        </Typography>
        {!smartAssistantAvailable ? (
          <Typography sx={{ ...captionTextSx, color: 'text.disabled', pl: 0.25 }}>
            {t('settings.shortcut.smartUnavailable')}
          </Typography>
        ) : null}
        <Typography component="div" sx={{ ...shortcutLineSx, color: translateCommandEnabled ? '#2f2f2f' : 'text.disabled' }}>
          <Box component="span">{t('settings.shortcut.translatePrefix')}</Box>
          <ShortcutDisplayButtons
            display={translateShortcutDisplay}
            disabled={!translateCommandEnabled}
            ariaLabel={t('settings.shortcut.bindTranslate')}
            onClick={translateCommandEnabled ? openTranslateShortcutBinding : undefined}
          />
          <Box component="span">{t('settings.shortcut.translateSuffix')}</Box>
        </Typography>
      </Box>

      <ShortcutBindingDialog
        command={bindingShortcutCommand}
        onClose={() => setBindingShortcutCommand(null)}
        onSave={handleSaveShortcutBinding}
      />
    </>
  )
}
