import { Box, Typography } from '@mui/material'
import { glassSectionSx, pageSx, pageTitleSx } from '../uiTokens'
import AsrRuntimeSettingsSection from './settings/AsrRuntimeSettingsSection'
import AudioSettingsSection from './settings/AudioSettingsSection'
import LanguageSettingsSection from './settings/LanguageSettingsSection'
import LlmSettingsSection from './settings/LlmSettingsSection'
import MacOSPermissionSection from './settings/MacOSPermissionSection'
import ShortcutSettingsSection from './settings/ShortcutSettingsSection'
import { useSettingsPageState } from './settings/useSettingsPageState'
import { useI18n } from '../i18n'

// 每个设置区块是一张玻璃卡片：区块自带的标题上边距去掉，最后一行不要分隔线。
const sectionCardSx = {
  ...glassSectionSx,
  '& > :first-of-type': { mt: '0 !important' },
  '& > :last-child': { borderBottom: 'none !important' },
  // 当前平台不显示的区块（比如 Windows 上的 macOS 权限）渲染为空，卡片也跟着隐藏。
  '&:empty': { display: 'none' },
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return <Box sx={sectionCardSx}>{children}</Box>
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
    devices,
    updateSettings,
    updateProvider,
    updateCurrentProvider,
    updateCurrentApiKey,
    updateCurrentModel,
    beginLlmEdit,
    cancelLlmEdit,
    saveLlmSettings,
  } = useSettingsPageState()

  return (
    <Box sx={{ ...pageSx, maxWidth: 680 }}>
      <Typography sx={{ ...pageTitleSx, mb: 2 }}>{t('settings.title')}</Typography>
      <SectionCard>
        <ShortcutSettingsSection />
      </SectionCard>
      <SectionCard>
        <MacOSPermissionSection />
      </SectionCard>
      <SectionCard>
        <AudioSettingsSection
          settings={settings}
          devices={devices}
          updateSettings={updateSettings}
        />
      </SectionCard>
      <SectionCard>
        <AsrRuntimeSettingsSection settings={settings} updateSettings={updateSettings} />
      </SectionCard>
      <SectionCard>
        <LanguageSettingsSection settings={settings} updateSettings={updateSettings} />
      </SectionCard>
      <SectionCard>
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
      </SectionCard>
    </Box>
  )
}
