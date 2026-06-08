/**
 * 大模型设置区块
 *
 * 需要编辑 provider、API Key 或模型时看这里。
 */
import { Box, Button, MenuItem, Select, TextField, Typography } from '@mui/material'
import { type LlmProvider, type LlmSettings } from '../../services/settingsStore'
import { useI18n } from '../../i18n'
import { bodyTextSx, captionTextSx, sectionTitleSx } from '../../uiTokens'

type LlmSettingsSectionProps = {
  llmView: LlmSettings
  currentProvider: LlmProvider | undefined
  isLlmEditing: boolean
  isSavingLlm: boolean
  llmSaveMessage: string
  updateProvider: (providerId: string) => void
  updateCurrentProvider: (updater: (provider: LlmProvider) => LlmProvider) => void
  updateCurrentApiKey: (apiKey: string) => void
  updateCurrentModel: (model: string) => void
  beginLlmEdit: () => void
  cancelLlmEdit: () => void
  saveLlmSettings: () => Promise<void>
}

const rowSx = {
  display: 'grid',
  alignItems: 'center',
  gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) minmax(240px, 420px)' },
  gap: 1.5,
  padding: '12px 0',
  borderBottom: '1px solid rgba(119,119,119,0.08)',
}

const sectionTitle = sectionTitleSx

export default function LlmSettingsSection({
  llmView,
  currentProvider,
  isLlmEditing,
  isSavingLlm,
  llmSaveMessage,
  updateProvider,
  updateCurrentProvider,
  updateCurrentApiKey,
  updateCurrentModel,
  beginLlmEdit,
  cancelLlmEdit,
  saveLlmSettings,
}: LlmSettingsSectionProps) {
  const { t } = useI18n()
  const saveMessageColor = llmSaveMessage.startsWith('后端') ? 'error.main' : 'success.main'
  const visibleSaveMessage = llmSaveMessage === '已保存'
    ? t('settings.saved')
    : llmSaveMessage.replace('后端重载失败', t('settings.backendReloadFailed')).replace('未知错误', t('settings.unknownError'))

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 3, mb: 1, gap: 1, flexWrap: 'wrap' }}>
        <Typography sx={sectionTitle}>{t('settings.llm')}</Typography>
        {isLlmEditing ? (
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button variant="outlined" size="small" onClick={cancelLlmEdit} disabled={isSavingLlm}>{t('settings.cancel')}</Button>
            <Button variant="contained" size="small" onClick={() => void saveLlmSettings()} disabled={isSavingLlm}>{t('settings.save')}</Button>
          </Box>
        ) : (
          <Button variant="outlined" size="small" onClick={beginLlmEdit}>{t('settings.edit')}</Button>
        )}
      </Box>
      {llmSaveMessage && (
        <Typography sx={{ ...captionTextSx, color: saveMessageColor, mb: 1 }}>
          {visibleSaveMessage}
        </Typography>
      )}
      <Box sx={rowSx}>
        <Typography sx={bodyTextSx}>{t('settings.provider')}</Typography>
        <Select
          size="small"
          value={llmView.providerId}
          onChange={(event) => updateProvider(String(event.target.value))}
          disabled={!isLlmEditing || isSavingLlm}
          sx={{ width: '100%' }}
        >
          {llmView.providers.map((provider) => (
            <MenuItem key={provider.id} value={provider.id}>{provider.label}</MenuItem>
          ))}
        </Select>
      </Box>
      {currentProvider?.allowBaseUrlEdit ? (
        <Box sx={rowSx}>
          <Typography sx={bodyTextSx}>Base URL</Typography>
          <TextField
            fullWidth
            size="small"
            label="Base URL"
            placeholder={t('settings.openAiBaseUrlPlaceholder')}
            value={currentProvider.baseUrl}
            onChange={(event) => updateCurrentProvider((provider) => ({ ...provider, baseUrl: event.target.value }))}
            disabled={!isLlmEditing || isSavingLlm}
            sx={{ maxWidth: 420, justifySelf: 'stretch' }}
          />
        </Box>
      ) : null}
      <Box sx={rowSx}>
        <Typography sx={bodyTextSx}>API Key</Typography>
        <TextField
          fullWidth
          size="small"
          type="password"
          label="API Key"
          placeholder={t('settings.apiKeyPlaceholder')}
          value={currentProvider ? llmView.apiKeys[currentProvider.id] ?? '' : ''}
          onChange={(event) => updateCurrentApiKey(event.target.value)}
          disabled={!isLlmEditing || isSavingLlm}
          sx={{ maxWidth: 420, justifySelf: 'stretch' }}
        />
      </Box>
      <Box sx={rowSx}>
        <Typography sx={bodyTextSx}>{t('settings.model')}</Typography>
        <TextField
          fullWidth
          size="small"
          label={t('settings.model')}
          placeholder={t('settings.modelPlaceholder')}
          value={currentProvider ? llmView.models[currentProvider.id] ?? currentProvider.defaultModel : ''}
          onChange={(event) => updateCurrentModel(event.target.value)}
          disabled={!isLlmEditing || isSavingLlm}
          sx={{ maxWidth: 420, justifySelf: 'stretch' }}
        />
      </Box>
    </>
  )
}
