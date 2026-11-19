import { useEffect, useMemo, useState } from 'react'
import { Box, Button, Chip, LinearProgress, Typography } from '@mui/material'
import CloudDownloadIcon from '@mui/icons-material/CloudDownload'
import SettingsIcon from '@mui/icons-material/Settings'
import RefreshIcon from '@mui/icons-material/Refresh'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import DownloadIcon from '@mui/icons-material/Download'
import { glassItemSx, glassSectionSx, pageSx, pageTitleSx } from '../uiTokens'
import { useI18n, type TranslationKey } from '../i18n'
import {
  chooseModelCacheDirectory,
  downloadVoiceModelOnly,
  getVoiceModelStatus,
  startVoiceModelDownload,
  type VoiceModelOption,
  type VoiceModelStatus,
} from '../services/modelSetupStore'
import { ASR_MODELS, loadSettings, saveSettings, type LocalSettings } from '../services/settingsStore'

type SetupProps = {
  onOpenSettings: () => void
}

const sectionSx = {
  ...glassSectionSx,
}

const rowSx = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 2,
  py: 0.75,
}

const modelCardSx = {
  ...glassItemSx,
  borderRadius: '16px',
  px: 2,
  py: 1.5,
}

function isModelBusy(status: VoiceModelStatus | null) {
  return status?.status === 'downloading' || status?.status === 'loading'
}

function formatBytes(bytes = 0) {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`
}

function getStatusKey(status: VoiceModelStatus | null): TranslationKey {
  if (status?.status === 'downloading') return 'setup.modelStatus.downloading'
  if (status?.status === 'loading') return 'setup.modelStatus.loading'
  if (status?.status === 'ready') return 'setup.modelStatus.ready'
  if (status?.status === 'failed') return 'setup.modelStatus.failed'
  if (status?.status === 'unavailable') return 'setup.modelStatus.unavailable'
  if (status?.cached) return 'setup.modelStatus.cached'
  return 'setup.modelStatus.idle'
}

function getModelOptionStatusKey(option: VoiceModelOption): TranslationKey {
  if (option.status === 'downloading') return 'setup.modelStatus.downloading'
  if (option.status === 'loading') return 'setup.modelStatus.loading'
  if (option.status === 'failed') return 'setup.modelStatus.failed'
  if (option.active && option.status === 'ready') return 'setup.modelStatus.ready'
  return option.cached ? 'setup.modelStatus.cached' : 'setup.modelNotDownloaded'
}

// 后端不可用时也要能列出模型，用共享元数据兜底。
function getModelOptions(status: VoiceModelStatus | null, activeModelId: string): VoiceModelOption[] {
  if (status?.models?.length) return status.models
  return ASR_MODELS.map((model) => ({
    model_id: model.id,
    repo_id: model.repoId,
    label: model.label,
    variant: model.variant,
    runtime: model.runtime,
    size_bytes: model.sizeBytes,
    active: model.id === activeModelId,
    cached: false,
    status: 'idle',
    detail: '',
    downloaded_bytes: 0,
    total_bytes: 0,
    progress_percent: null,
    downloaded_files: 0,
    total_files: 0,
    file_progress_percent: null,
  }))
}

function getModelDescriptionKey(modelId: string): TranslationKey | null {
  if (modelId === 'sensevoice-small') return 'setup.modelDesc.sensevoice-small'
  if (modelId === 'sensevoice-small-int8') return 'setup.modelDesc.sensevoice-small-int8'
  return null
}

export default function Setup({ onOpenSettings }: SetupProps) {
  const { t } = useI18n()
  const [modelStatus, setModelStatus] = useState<VoiceModelStatus | null>(null)
  const [settings, setSettings] = useState<LocalSettings | null>(null)
  const [isStartingDownload, setIsStartingDownload] = useState(false)

  const currentProvider = useMemo(() => (
    settings?.llm.providers.find((provider) => provider.id === settings.llm.providerId)
      ?? settings?.llm.providers[0]
  ), [settings])
  const currentApiKey = currentProvider ? settings?.llm.apiKeys[currentProvider.id]?.trim() : ''
  const apiConfigured = Boolean(currentApiKey)
  const selectedModelCacheDir = settings?.modelCacheDir?.trim() || ''
  const effectiveModelCacheDir = selectedModelCacheDir || modelStatus?.cache_dir || ''
  const activeModelId = modelStatus?.active_model_id || settings?.asrModelId || ''
  const modelOptions = getModelOptions(modelStatus, activeModelId)
  const activeModelOption = modelOptions.find((option) => option.active)

  const refresh = async () => {
    const nextSettings = await loadSettings()
    const nextStatus = await getVoiceModelStatus(nextSettings.modelCacheDir)
    setModelStatus(nextStatus)
    setSettings(nextSettings)
  }

  useEffect(() => {
    let cancelled = false

    const refreshIfMounted = async () => {
      const nextSettings = await loadSettings()
      const nextStatus = await getVoiceModelStatus(nextSettings.modelCacheDir)
      if (cancelled) return
      setModelStatus(nextStatus)
      setSettings(nextSettings)
    }

    void refreshIfMounted()
    const timer = window.setInterval(() => {
      void refreshIfMounted()
    }, 1000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  const handleStartDownload = async () => {
    setIsStartingDownload(true)
    try {
      setModelStatus(await startVoiceModelDownload(effectiveModelCacheDir))
    } finally {
      setIsStartingDownload(false)
    }
  }

  const handleDownloadOnly = async (modelId: string) => {
    setModelStatus(await downloadVoiceModelOnly(modelId, effectiveModelCacheDir))
  }

  const handleDownloadAll = async () => {
    let latest: VoiceModelStatus | null = modelStatus
    for (const option of modelOptions) {
      if (option.cached || option.status === 'downloading') continue
      latest = await downloadVoiceModelOnly(option.model_id, effectiveModelCacheDir)
    }
    if (latest) setModelStatus(latest)
  }

  // 切换：先保存设置（之后的状态查询都带新模型），再让后端加载新模型。
  const handleUseModel = async (modelId: string) => {
    if (!settings) return
    setIsStartingDownload(true)
    try {
      const nextSettings = await saveSettings({ ...settings, asrModelId: modelId })
      setSettings(nextSettings)
      setModelStatus(await startVoiceModelDownload(effectiveModelCacheDir, modelId))
    } finally {
      setIsStartingDownload(false)
    }
  }

  const handleChooseModelCacheDir = async () => {
    const result = await chooseModelCacheDirectory(effectiveModelCacheDir)
    if (!result.success || result.canceled || !result.path || !settings) return
    const nextSettings = await saveSettings({ ...settings, modelCacheDir: result.path })
    setSettings(nextSettings)
    setModelStatus(await getVoiceModelStatus(nextSettings.modelCacheDir))
  }

  const anyModelDownloading = modelOptions.some((option) => option.status === 'downloading')
  const busy = isModelBusy(modelStatus) || isStartingDownload
  const isDownloaded = Boolean(modelStatus?.cached)
  const hasAnyDownloadedModel = isDownloaded || modelOptions.some((option) => option.cached)
  const isReady = Boolean(modelStatus?.ready || modelStatus?.status === 'ready')
  const canChooseCacheDir = !hasAnyDownloadedModel && !isReady && !busy && !anyModelDownloading
  const canDownloadAll = modelOptions.some((option) => !option.cached && option.status !== 'downloading')
  const downloadProgressPercent = modelStatus?.progress_percent ?? null
  const fileProgressPercent = modelStatus?.file_progress_percent ?? null
  const hasDownloadProgress = modelStatus?.status === 'downloading'
    && typeof downloadProgressPercent === 'number'
    && (modelStatus?.total_bytes ?? 0) > 0
  const hasFileProgress = modelStatus?.status === 'downloading'
    && typeof fileProgressPercent === 'number'
    && (modelStatus?.total_files ?? 0) > 0
  const shouldExplainFileProgressPause = hasFileProgress && (modelStatus?.downloaded_files ?? 0) === 0
  const statusText = t(getStatusKey(modelStatus))
  const modelActionText = isReady
    ? t('setup.modelReady')
    : isDownloaded
      ? t('setup.loadModel')
      : t('setup.startDownload')

  return (
    <Box sx={{ ...pageSx, maxWidth: 760 }}>
      <Typography sx={{ ...pageTitleSx, mb: 1 }}>{t('setup.title')}</Typography>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 3 }}>
        {t('setup.subtitle')}
      </Typography>

      <Box sx={sectionSx}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 500 }}>{t('setup.model')}</Typography>
          <Chip
            size="small"
            label={statusText}
            color={modelStatus?.status === 'ready' ? 'success' : modelStatus?.status === 'failed' ? 'error' : 'default'}
          />
        </Box>

        <Box sx={rowSx}>
          <Typography sx={{ color: 'text.secondary' }}>{t('setup.modelName')}</Typography>
          <Typography sx={{ textAlign: 'right' }}>
            {activeModelOption
              ? `${activeModelOption.label}${activeModelOption.variant ? ` · ${activeModelOption.variant}` : ''}`
              : modelStatus?.repo_id || 'FunAudioLLM/SenseVoiceSmall'}
          </Typography>
        </Box>
        <Box sx={rowSx}>
          <Typography sx={{ color: 'text.secondary' }}>{t('setup.cacheDir')}</Typography>
          <Typography sx={{ textAlign: 'right', wordBreak: 'break-all' }}>{effectiveModelCacheDir || '-'}</Typography>
        </Box>
        {modelStatus?.detail ? (
          <Typography sx={{ fontSize: 13, color: modelStatus.status === 'failed' ? 'error.main' : 'text.secondary', mt: 1 }}>
            {modelStatus.detail}
          </Typography>
        ) : null}
        {busy ? (
          <Box sx={{ mt: 2 }}>
            <LinearProgress
              variant={hasDownloadProgress ? 'determinate' : 'indeterminate'}
              value={hasDownloadProgress ? downloadProgressPercent : undefined}
            />
            {hasDownloadProgress ? (
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.75 }}>
                {`${downloadProgressPercent}% · ${formatBytes(modelStatus?.downloaded_bytes)} / ${formatBytes(modelStatus?.total_bytes)}`}
              </Typography>
            ) : hasFileProgress ? (
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.75 }}>
                {`${t('setup.modelFilesProgress')} ${modelStatus?.downloaded_files} / ${modelStatus?.total_files}${shouldExplainFileProgressPause ? ` · ${t('setup.modelFilesProgressHint')}` : ''}`}
              </Typography>
            ) : null}
          </Box>
        ) : null}

        <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
          {canChooseCacheDir ? (
            <Button
              variant="outlined"
              startIcon={<FolderOpenIcon />}
              onClick={() => void handleChooseModelCacheDir()}
            >
              {t('setup.chooseCacheDir')}
            </Button>
          ) : null}
          <Button
            variant="contained"
            startIcon={<CloudDownloadIcon />}
            onClick={() => void handleStartDownload()}
            disabled={busy || modelStatus?.status === 'ready'}
          >
            {modelActionText}
          </Button>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => void refresh()}
            disabled={busy}
          >
            {t('setup.refresh')}
          </Button>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 3, mb: 0.5 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 500 }}>{t('setup.modelList')}</Typography>
          <Button
            size="small"
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={() => void handleDownloadAll()}
            disabled={!canDownloadAll || modelStatus?.status === 'unavailable'}
          >
            {t('setup.downloadAll')}
          </Button>
        </Box>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1.5 }}>{t('setup.modelListHint')}</Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          {modelOptions.map((option) => {
            const descriptionKey = getModelDescriptionKey(option.model_id)
            const optionDownloading = option.status === 'downloading'
            const optionHasProgress = optionDownloading && typeof option.progress_percent === 'number' && option.total_bytes > 0
            return (
              <Box key={option.model_id} sx={{ ...modelCardSx, borderColor: option.active ? 'primary.main' : 'var(--glass-border)' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: 14, fontWeight: 500 }}>
                      {option.label}{option.variant ? ` · ${option.variant}` : ''}
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                      {`${t('setup.approxSize')} ${formatBytes(option.size_bytes)}`}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 0.75 }}>
                    {option.active ? <Chip size="small" color="primary" label={t('setup.modelInUse')} /> : null}
                    <Chip
                      size="small"
                      variant="outlined"
                      label={t(getModelOptionStatusKey(option))}
                      color={option.status === 'failed' ? 'error' : option.cached ? 'success' : 'default'}
                    />
                  </Box>
                </Box>
                {descriptionKey ? (
                  <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.75 }}>{t(descriptionKey)}</Typography>
                ) : null}
                {!option.active && option.detail && option.status === 'failed' ? (
                  <Typography sx={{ fontSize: 12, color: 'error.main', mt: 0.5 }}>{option.detail}</Typography>
                ) : null}
                {optionDownloading && !option.active ? (
                  <Box sx={{ mt: 1 }}>
                    <LinearProgress
                      variant={optionHasProgress ? 'determinate' : 'indeterminate'}
                      value={optionHasProgress ? option.progress_percent ?? 0 : undefined}
                    />
                    {optionHasProgress ? (
                      <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5 }}>
                        {`${option.progress_percent}% · ${formatBytes(option.downloaded_bytes)} / ${formatBytes(option.total_bytes)}`}
                      </Typography>
                    ) : null}
                  </Box>
                ) : null}
                {!option.active ? (
                  <Box sx={{ display: 'flex', gap: 1, mt: 1.25 }}>
                    {!option.cached ? (
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<DownloadIcon />}
                        onClick={() => void handleDownloadOnly(option.model_id)}
                        disabled={optionDownloading || modelStatus?.status === 'unavailable'}
                      >
                        {t('setup.downloadModel')}
                      </Button>
                    ) : null}
                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => void handleUseModel(option.model_id)}
                      disabled={busy || optionDownloading || modelStatus?.status === 'unavailable'}
                    >
                      {t('setup.useModel')}
                    </Button>
                  </Box>
                ) : null}
              </Box>
            )
          })}
        </Box>
      </Box>

      <Box sx={sectionSx}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 500 }}>{t('setup.api')}</Typography>
          <Chip
            size="small"
            label={apiConfigured ? t('setup.apiReady') : t('setup.apiMissing')}
            color={apiConfigured ? 'success' : 'warning'}
          />
        </Box>
        <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>
          {apiConfigured
            ? `${currentProvider?.label || 'DeepSeek'} ${t('setup.apiConfigured')}`
            : t('setup.apiRequired')}
        </Typography>
        <Button variant="outlined" startIcon={<SettingsIcon />} onClick={onOpenSettings}>
          {t('setup.openSettings')}
        </Button>
      </Box>
    </Box>
  )
}
