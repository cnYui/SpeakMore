import { useEffect, useState } from 'react'
import { Box, Button, Chip, LinearProgress, Typography } from '@mui/material'
import CloudDownloadIcon from '@mui/icons-material/CloudDownload'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import RefreshIcon from '@mui/icons-material/Refresh'
import { useI18n, type TranslationKey } from '../../i18n'
import { chooseModelCacheDirectory } from '../../services/modelSetupStore'
import {
  getTranslationModelStatus,
  loadTranslationModel,
  startTranslationModelDownload,
  type TranslationModelStatus,
} from '../../services/translationModelStore'
import { type LocalSettings } from '../../services/settingsStore'
import { bodyTextSx, captionTextSx, helperTextSx, sectionTitleSx } from '../../uiTokens'

type TranslationModelSettingsSectionProps = {
  settings: LocalSettings
  updateSettings: (next: LocalSettings) => Promise<void>
}

const sectionTitle = { ...sectionTitleSx, mt: 3, mb: 1 }

const panelSx = {
  bgcolor: 'rgba(119,119,119,0.06)',
  borderRadius: '8px',
  p: 2,
}

const rowSx = {
  display: 'grid',
  gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) minmax(180px, auto)' },
  gap: 1.5,
  py: 0.75,
}

function isBusy(status: TranslationModelStatus | null) {
  return status?.status === 'downloading' || status?.status === 'loading'
}

function formatBytes(bytes = 0) {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`
}

function getStatusKey(status: TranslationModelStatus | null): TranslationKey {
  if (status?.status === 'downloading') return 'settings.translationModel.modelStatus.downloading'
  if (status?.status === 'loading') return 'settings.translationModel.modelStatus.loading'
  if (status?.status === 'ready') return 'settings.translationModel.modelStatus.ready'
  if (status?.status === 'failed') return 'settings.translationModel.modelStatus.failed'
  if (status?.status === 'runtime_missing') return 'settings.translationModel.modelStatus.runtimeMissing'
  if (status?.status === 'unavailable') return 'settings.translationModel.modelStatus.unavailable'
  if (status?.cached) return 'settings.translationModel.modelStatus.cached'
  return 'settings.translationModel.modelStatus.idle'
}

function getDetailText(status: TranslationModelStatus | null, t: (key: TranslationKey) => string) {
  if (!status?.detail) return ''
  if (status.status === 'ready') {
    return ''
  }
  if (status.status === 'runtime_missing') return t('settings.translationModel.runtimeMissingDetail')

  const detail = status.detail.toLowerCase()
  if (
    detail.includes('translation_model_download_interrupted')
    || detail.includes('incompleteread')
    || detail.includes('connection broken')
    || detail.includes('read timed out')
  ) {
    return t('settings.translationModel.downloadInterruptedDetail')
  }
  if (detail.includes('translation_model_download_failed')) {
    return t('settings.translationModel.downloadFailedDetail')
  }
  if (
    detail.includes('cached gguf')
    || detail.includes('could not be loaded')
    || detail.includes('failed to load model')
  ) {
    return t('settings.translationModel.modelLoadFailedDetail')
  }
  if (detail.includes('runtime failed to start') || detail.includes('did not become ready')) {
    return t('settings.translationModel.runtimeStartFailedDetail')
  }
  return status.detail
}

export default function TranslationModelSettingsSection({
  settings,
  updateSettings,
}: TranslationModelSettingsSectionProps) {
  const { t } = useI18n()
  const [modelStatus, setModelStatus] = useState<TranslationModelStatus | null>(null)
  const [isStartingAction, setIsStartingAction] = useState(false)

  const selectedCacheDir = settings.translationModelCacheDir.trim()
  const effectiveCacheDir = selectedCacheDir || modelStatus?.cache_dir || ''

  const refresh = async () => {
    setModelStatus(await getTranslationModelStatus(settings.translationModelCacheDir))
  }

  useEffect(() => {
    let cancelled = false

    const refreshIfMounted = async () => {
      const nextStatus = await getTranslationModelStatus(settings.translationModelCacheDir)
      if (!cancelled) setModelStatus(nextStatus)
    }

    void refreshIfMounted()
    const timer = window.setInterval(() => {
      void refreshIfMounted()
    }, 1200)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [settings.translationModelCacheDir])

  const handleChooseCacheDir = async () => {
    const result = await chooseModelCacheDirectory(effectiveCacheDir)
    if (!result.success || result.canceled || !result.path) return
    await updateSettings({ ...settings, translationModelCacheDir: result.path })
    setModelStatus(await getTranslationModelStatus(result.path))
  }

  const runAction = async (action: (cacheDir: string) => Promise<TranslationModelStatus>) => {
    setIsStartingAction(true)
    try {
      setModelStatus(await action(effectiveCacheDir))
    } finally {
      setIsStartingAction(false)
    }
  }

  const busy = isBusy(modelStatus) || isStartingAction
  const isReady = Boolean(modelStatus?.ready || modelStatus?.status === 'ready')
  const isCached = Boolean(modelStatus?.cached)
  const canChooseCacheDir = !isCached && !isReady && !busy
  const hasDownloadProgress = modelStatus?.status === 'downloading'
    && typeof modelStatus.progress_percent === 'number'
    && (modelStatus.total_bytes ?? 0) > 0
  const hasFileProgress = modelStatus?.status === 'downloading'
    && typeof modelStatus.file_progress_percent === 'number'
    && (modelStatus.total_files ?? 0) > 0
  const statusText = t(getStatusKey(modelStatus))
  const detailText = getDetailText(modelStatus, t)
  const modelActionText = isReady
    ? t('settings.translationModel.modelReady')
    : isCached
      ? t('settings.translationModel.loadModel')
      : t('settings.translationModel.startDownload')

  const handlePrimaryAction = async () => {
    if (isReady) return
    await runAction(isCached ? loadTranslationModel : startTranslationModelDownload)
  }

  return (
    <>
      <Typography sx={sectionTitle}>{t('settings.translationModel.title')}</Typography>
      <Box sx={panelSx}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, mb: 1 }}>
          <Typography sx={{ ...helperTextSx, color: 'text.secondary' }}>
            {t('settings.translationModel.description')}
          </Typography>
          <Chip
            size="small"
            label={statusText}
            color={isReady ? 'success' : modelStatus?.status === 'failed' ? 'error' : 'default'}
          />
        </Box>

        <Box sx={rowSx}>
          <Typography sx={{ ...bodyTextSx, color: 'text.secondary' }}>{t('settings.translationModel.modelName')}</Typography>
          <Typography sx={{ ...bodyTextSx, textAlign: { xs: 'left', sm: 'right' } }}>
            {modelStatus?.repo_id || 'tencent/Hy-MT2-1.8B-GGUF'}
          </Typography>
        </Box>
        <Box sx={rowSx}>
          <Typography sx={{ ...bodyTextSx, color: 'text.secondary' }}>{t('settings.translationModel.cacheDir')}</Typography>
          <Typography sx={{ ...bodyTextSx, textAlign: { xs: 'left', sm: 'right' }, wordBreak: 'break-all' }}>
            {effectiveCacheDir || '-'}
          </Typography>
        </Box>
        {detailText ? (
          <Typography sx={{ ...helperTextSx, color: modelStatus?.status === 'failed' ? 'error.main' : 'text.secondary', mt: 1 }}>
            {detailText}
          </Typography>
        ) : null}
        {busy ? (
          <Box sx={{ mt: 2 }}>
            <LinearProgress
              variant={hasDownloadProgress ? 'determinate' : 'indeterminate'}
              value={hasDownloadProgress ? modelStatus?.progress_percent ?? undefined : undefined}
            />
            {hasDownloadProgress ? (
              <Typography sx={{ ...captionTextSx, color: 'text.secondary', mt: 0.75 }}>
                {`${modelStatus?.progress_percent}% - ${formatBytes(modelStatus?.downloaded_bytes)} / ${formatBytes(modelStatus?.total_bytes)}`}
              </Typography>
            ) : hasFileProgress ? (
              <Typography sx={{ ...captionTextSx, color: 'text.secondary', mt: 0.75 }}>
                {`${t('settings.translationModel.modelFilesProgress')} ${modelStatus?.downloaded_files} / ${modelStatus?.total_files}`}
              </Typography>
            ) : null}
          </Box>
        ) : null}

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 2 }}>
          {canChooseCacheDir ? (
            <Button
              variant="outlined"
              startIcon={<FolderOpenIcon />}
              onClick={() => void handleChooseCacheDir()}
              sx={{ borderRadius: '8px' }}
            >
              {t('settings.translationModel.chooseCacheDir')}
            </Button>
          ) : null}
          <Button
            variant="contained"
            startIcon={<CloudDownloadIcon />}
            onClick={() => void handlePrimaryAction()}
            disabled={busy || isReady}
            sx={{
              borderRadius: '8px',
              bgcolor: 'grey.800',
              color: 'common.white',
              boxShadow: 'none',
              '&:hover': { bgcolor: 'grey.700', boxShadow: 'none' },
              '&.Mui-disabled': { bgcolor: 'grey.200' },
            }}
          >
            {modelActionText}
          </Button>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => void refresh()}
            disabled={busy}
            sx={{ borderRadius: '8px' }}
          >
            {t('settings.translationModel.refresh')}
          </Button>
        </Box>
      </Box>
    </>
  )
}
