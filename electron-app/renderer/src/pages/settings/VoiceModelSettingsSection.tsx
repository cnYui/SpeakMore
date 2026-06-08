/**
 * 语音模型设置区块
 *
 * 需要下载、加载 SenseVoiceSmall 或选择模型缓存目录时看这里。
 */
import { useEffect, useState } from 'react'
import { Box, Button, Chip, LinearProgress, Typography } from '@mui/material'
import CloudDownloadIcon from '@mui/icons-material/CloudDownload'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import RefreshIcon from '@mui/icons-material/Refresh'
import { useI18n, type TranslationKey } from '../../i18n'
import {
  chooseModelCacheDirectory,
  getVoiceModelStatus,
  startVoiceModelDownload,
  type VoiceModelStatus,
} from '../../services/modelSetupStore'
import { type LocalSettings } from '../../services/settingsStore'
import { bodyTextSx, captionTextSx, helperTextSx, sectionTitleSx } from '../../uiTokens'

type VoiceModelSettingsSectionProps = {
  settings: LocalSettings
  updateSettings: (next: LocalSettings) => Promise<void>
}

const sectionTitle = { ...sectionTitleSx, mt: 3, mb: 1 }

const modelPanelSx = {
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
  if (status?.status === 'downloading') return 'settings.voiceModel.modelStatus.downloading'
  if (status?.status === 'loading') return 'settings.voiceModel.modelStatus.loading'
  if (status?.status === 'ready') return 'settings.voiceModel.modelStatus.ready'
  if (status?.status === 'failed') return 'settings.voiceModel.modelStatus.failed'
  if (status?.status === 'unavailable') return 'settings.voiceModel.modelStatus.unavailable'
  if (status?.cached) return 'settings.voiceModel.modelStatus.cached'
  return 'settings.voiceModel.modelStatus.idle'
}

export default function VoiceModelSettingsSection({
  settings,
  updateSettings,
}: VoiceModelSettingsSectionProps) {
  const { t } = useI18n()
  const [modelStatus, setModelStatus] = useState<VoiceModelStatus | null>(null)
  const [isStartingDownload, setIsStartingDownload] = useState(false)

  const selectedModelCacheDir = settings.modelCacheDir.trim()
  const effectiveModelCacheDir = selectedModelCacheDir || modelStatus?.cache_dir || ''

  const refresh = async () => {
    setModelStatus(await getVoiceModelStatus(settings.modelCacheDir))
  }

  useEffect(() => {
    let cancelled = false

    const refreshIfMounted = async () => {
      const nextStatus = await getVoiceModelStatus(settings.modelCacheDir)
      if (!cancelled) setModelStatus(nextStatus)
    }

    void refreshIfMounted()
    const timer = window.setInterval(() => {
      void refreshIfMounted()
    }, 1000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [settings.modelCacheDir])

  const handleStartDownload = async () => {
    setIsStartingDownload(true)
    try {
      setModelStatus(await startVoiceModelDownload(effectiveModelCacheDir))
    } finally {
      setIsStartingDownload(false)
    }
  }

  const handleChooseModelCacheDir = async () => {
    const result = await chooseModelCacheDirectory(effectiveModelCacheDir)
    if (!result.success || result.canceled || !result.path) return
    await updateSettings({ ...settings, modelCacheDir: result.path })
    setModelStatus(await getVoiceModelStatus(result.path))
  }

  const busy = isModelBusy(modelStatus) || isStartingDownload
  const isDownloaded = Boolean(modelStatus?.cached)
  const isReady = Boolean(modelStatus?.ready || modelStatus?.status === 'ready')
  const canChooseCacheDir = !isDownloaded && !isReady && !busy
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
    ? t('settings.voiceModel.modelReady')
    : isDownloaded
      ? t('settings.voiceModel.loadModel')
      : t('settings.voiceModel.startDownload')

  return (
    <>
      <Typography sx={sectionTitle}>{t('settings.voiceModel.title')}</Typography>
      <Box sx={modelPanelSx}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, mb: 1 }}>
          <Typography sx={{ ...helperTextSx, color: 'text.secondary' }}>
            {t('settings.voiceModel.description')}
          </Typography>
          <Chip
            size="small"
            label={statusText}
            color={modelStatus?.status === 'ready' ? 'success' : modelStatus?.status === 'failed' ? 'error' : 'default'}
          />
        </Box>

        <Box sx={rowSx}>
          <Typography sx={{ ...bodyTextSx, color: 'text.secondary' }}>{t('settings.voiceModel.modelName')}</Typography>
          <Typography sx={{ ...bodyTextSx, textAlign: { xs: 'left', sm: 'right' } }}>
            {modelStatus?.repo_id || 'FunAudioLLM/SenseVoiceSmall'}
          </Typography>
        </Box>
        <Box sx={rowSx}>
          <Typography sx={{ ...bodyTextSx, color: 'text.secondary' }}>{t('settings.voiceModel.cacheDir')}</Typography>
          <Typography sx={{ ...bodyTextSx, textAlign: { xs: 'left', sm: 'right' }, wordBreak: 'break-all' }}>
            {effectiveModelCacheDir || '-'}
          </Typography>
        </Box>
        {modelStatus?.detail ? (
          <Typography sx={{ ...helperTextSx, color: modelStatus.status === 'failed' ? 'error.main' : 'text.secondary', mt: 1 }}>
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
              <Typography sx={{ ...captionTextSx, color: 'text.secondary', mt: 0.75 }}>
                {`${downloadProgressPercent}% · ${formatBytes(modelStatus?.downloaded_bytes)} / ${formatBytes(modelStatus?.total_bytes)}`}
              </Typography>
            ) : hasFileProgress ? (
              <Typography sx={{ ...captionTextSx, color: 'text.secondary', mt: 0.75 }}>
                {`${t('settings.voiceModel.modelFilesProgress')} ${modelStatus?.downloaded_files} / ${modelStatus?.total_files}${shouldExplainFileProgressPause ? ` · ${t('settings.voiceModel.modelFilesProgressHint')}` : ''}`}
              </Typography>
            ) : null}
          </Box>
        ) : null}

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 2 }}>
          {canChooseCacheDir ? (
            <Button
              variant="outlined"
              startIcon={<FolderOpenIcon />}
              onClick={() => void handleChooseModelCacheDir()}
              sx={{ borderRadius: '8px' }}
            >
              {t('settings.voiceModel.chooseCacheDir')}
            </Button>
          ) : null}
          <Button
            variant="contained"
            startIcon={<CloudDownloadIcon />}
            onClick={() => void handleStartDownload()}
            disabled={busy || modelStatus?.status === 'ready'}
            sx={{ borderRadius: '8px' }}
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
            {t('settings.voiceModel.refresh')}
          </Button>
        </Box>
      </Box>
    </>
  )
}
