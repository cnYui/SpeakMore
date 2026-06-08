import { Box, Typography } from '@mui/material'
import { adaptivePageSx, cardSx, pageTitleSx } from '../uiTokens'
import ApplicationBehaviorSettingsSection from './settings/ApplicationBehaviorSettingsSection'
import AsrRuntimeSettingsSection from './settings/AsrRuntimeSettingsSection'
import AudioSettingsSection from './settings/AudioSettingsSection'
import LanguageSettingsSection from './settings/LanguageSettingsSection'
import LlmSettingsSection from './settings/LlmSettingsSection'
import MacOSPermissionSection from './settings/MacOSPermissionSection'
import ShortcutSettingsSection from './settings/ShortcutSettingsSection'
import TranslationModelSettingsSection from './settings/TranslationModelSettingsSection'
import VoiceDiagnosticsSettingsSection from './settings/VoiceDiagnosticsSettingsSection'
import VoiceModelSettingsSection from './settings/VoiceModelSettingsSection'
import { useSettingsPageState } from './settings/useSettingsPageState'
import { useI18n } from '../i18n'
import { isMacOSRuntime } from '../services/macosPermissions'

const settingsContentSx = {
  width: '100%',
  maxWidth: 1080,
  marginRight: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: { xs: 1.5, lg: 1.75 },
}

const settingsSectionSx = {
  ...cardSx,
  p: { xs: 2, md: 2.25 },
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  '& > .MuiTypography-root:first-of-type': {
    mt: 0,
  },
  '& > .MuiBox-root:first-of-type': {
    mt: 0,
  },
}

export default function Settings() {
  const { t } = useI18n()
  const {
    settings,
    llmView,
    currentProvider,
    isLlmEditing,
    isSavingLlm,
    llmSaveMessage,
    settingsSaveMessage,
    devices,
    refreshDevices,
    updateSettings,
    updateProvider,
    updateCurrentProvider,
    updateCurrentApiKey,
    updateCurrentModel,
    beginLlmEdit,
    cancelLlmEdit,
    saveLlmSettings,
  } = useSettingsPageState()
  const showMacOSPermissions = isMacOSRuntime()

  return (
    <Box sx={{ ...adaptivePageSx, display: 'flex', flexDirection: 'column', gap: { xs: 2, lg: 2.5 } }}>
      <Box sx={settingsContentSx}>
        <Typography sx={{ ...pageTitleSx, mb: { xs: 0.5, md: 0.75 } }}>{t('settings.title')}</Typography>
        <Box sx={settingsSectionSx}>
          <ShortcutSettingsSection />
        </Box>
        {showMacOSPermissions ? (
          <Box sx={settingsSectionSx}>
            <MacOSPermissionSection />
          </Box>
        ) : null}
        <Box sx={settingsSectionSx}>
          <AudioSettingsSection
            settings={settings}
            devices={devices}
            refreshDevices={refreshDevices}
            updateSettings={updateSettings}
          />
        </Box>
        <Box sx={settingsSectionSx}>
          <VoiceModelSettingsSection settings={settings} updateSettings={updateSettings} />
        </Box>
        <Box sx={settingsSectionSx}>
          <TranslationModelSettingsSection settings={settings} updateSettings={updateSettings} />
        </Box>
        <Box sx={settingsSectionSx}>
          <AsrRuntimeSettingsSection settings={settings} updateSettings={updateSettings} />
        </Box>
        <Box sx={settingsSectionSx}>
          <ApplicationBehaviorSettingsSection
            settings={settings}
            settingsSaveMessage={settingsSaveMessage}
            updateSettings={updateSettings}
          />
        </Box>
        <Box sx={settingsSectionSx}>
          <VoiceDiagnosticsSettingsSection />
        </Box>
        <Box sx={settingsSectionSx}>
          <LanguageSettingsSection settings={settings} updateSettings={updateSettings} />
        </Box>
        <Box sx={settingsSectionSx}>
          <LlmSettingsSection
            llmView={llmView}
            currentProvider={currentProvider}
            isLlmEditing={isLlmEditing}
            isSavingLlm={isSavingLlm}
            llmSaveMessage={llmSaveMessage}
            updateProvider={updateProvider}
            updateCurrentProvider={updateCurrentProvider}
            updateCurrentApiKey={updateCurrentApiKey}
            updateCurrentModel={updateCurrentModel}
            beginLlmEdit={beginLlmEdit}
            cancelLlmEdit={cancelLlmEdit}
            saveLlmSettings={saveLlmSettings}
          />
        </Box>
      </Box>
    </Box>
  )
}
