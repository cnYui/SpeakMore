import { ipcClient } from './ipc'

export type TranslationModelSetupStatus =
  | 'idle'
  | 'downloading'
  | 'loading'
  | 'ready'
  | 'failed'
  | 'runtime_missing'
  | 'unavailable'

export type TranslationModelStatus = {
  success?: boolean
  status: TranslationModelSetupStatus
  detail: string
  model_id?: string
  repo_id?: string
  gguf_repo_id?: string
  model_file?: string
  runtime_profile?: 'stq' | 'standard' | string
  available_profiles?: string[]
  fallback_reason?: string
  cache_dir?: string
  cached?: boolean
  ready?: boolean
  runtime_url?: string
  runtime_kind?: string
  runtime_available?: boolean
  runtime_path?: string
  runtime_source?: string
  runtime_kind_available?: string
  stq_runtime_available?: boolean
  stq_runtime_path?: string
  standard_runtime_available?: boolean
  standard_runtime_path?: string
  runtime_pid?: number | null
  runtime_missing?: boolean
  elapsed_ms?: number
  downloaded_bytes?: number
  total_bytes?: number
  progress_percent?: number | null
  downloaded_files?: number
  total_files?: number
  file_progress_percent?: number | null
}

const unavailableStatus: TranslationModelStatus = {
  success: false,
  status: 'unavailable',
  detail: '无法连接语音后端',
  ready: false,
}

function normalizeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function normalizePercent(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function normalizeTranslationModelStatus(value: unknown): TranslationModelStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unavailableStatus
  const status = value as Record<string, unknown>
  const rawStatus = typeof status.status === 'string' ? status.status : 'unavailable'
  const normalizedStatus = ['idle', 'downloading', 'loading', 'ready', 'failed', 'runtime_missing'].includes(rawStatus)
    ? rawStatus as TranslationModelSetupStatus
    : 'unavailable'

  return {
    success: Boolean(status.success ?? normalizedStatus !== 'unavailable'),
    status: normalizedStatus,
    detail: typeof status.detail === 'string' ? status.detail : '',
    model_id: typeof status.model_id === 'string' ? status.model_id : '',
    repo_id: typeof status.repo_id === 'string' ? status.repo_id : '',
    gguf_repo_id: typeof status.gguf_repo_id === 'string' ? status.gguf_repo_id : '',
    model_file: typeof status.model_file === 'string' ? status.model_file : '',
    runtime_profile: typeof status.runtime_profile === 'string' ? status.runtime_profile : '',
    available_profiles: Array.isArray(status.available_profiles)
      ? status.available_profiles.filter((item): item is string => typeof item === 'string')
      : [],
    fallback_reason: typeof status.fallback_reason === 'string' ? status.fallback_reason : '',
    cache_dir: typeof status.cache_dir === 'string' ? status.cache_dir : '',
    cached: Boolean(status.cached),
    ready: Boolean(status.ready || normalizedStatus === 'ready'),
    runtime_url: typeof status.runtime_url === 'string' ? status.runtime_url : '',
    runtime_kind: typeof status.runtime_kind === 'string' ? status.runtime_kind : '',
    runtime_available: Boolean(status.runtime_available),
    runtime_path: typeof status.runtime_path === 'string' ? status.runtime_path : '',
    runtime_source: typeof status.runtime_source === 'string' ? status.runtime_source : '',
    runtime_kind_available: typeof status.runtime_kind_available === 'string' ? status.runtime_kind_available : '',
    stq_runtime_available: Boolean(status.stq_runtime_available),
    stq_runtime_path: typeof status.stq_runtime_path === 'string' ? status.stq_runtime_path : '',
    standard_runtime_available: Boolean(status.standard_runtime_available),
    standard_runtime_path: typeof status.standard_runtime_path === 'string' ? status.standard_runtime_path : '',
    runtime_pid: typeof status.runtime_pid === 'number' ? status.runtime_pid : null,
    runtime_missing: Boolean(status.runtime_missing || normalizedStatus === 'runtime_missing'),
    elapsed_ms: normalizeNumber(status.elapsed_ms),
    downloaded_bytes: normalizeNumber(status.downloaded_bytes),
    total_bytes: normalizeNumber(status.total_bytes),
    progress_percent: normalizePercent(status.progress_percent),
    downloaded_files: normalizeNumber(status.downloaded_files),
    total_files: normalizeNumber(status.total_files),
    file_progress_percent: normalizePercent(status.file_progress_percent),
  }
}

async function invokeTranslationModelStatus(channel: string, cacheDir = ''): Promise<TranslationModelStatus> {
  try {
    return normalizeTranslationModelStatus(await ipcClient.invoke(channel, { cacheDir }))
  } catch {
    return unavailableStatus
  }
}

export function getTranslationModelStatus(cacheDir = ''): Promise<TranslationModelStatus> {
  return invokeTranslationModelStatus('translation-model:get-status', cacheDir)
}

export function startTranslationModelDownload(cacheDir = ''): Promise<TranslationModelStatus> {
  return invokeTranslationModelStatus('translation-model:start-download', cacheDir)
}

export function loadTranslationModel(cacheDir = ''): Promise<TranslationModelStatus> {
  return invokeTranslationModelStatus('translation-model:load', cacheDir)
}

export function unloadTranslationModel(cacheDir = ''): Promise<TranslationModelStatus> {
  return invokeTranslationModelStatus('translation-model:unload', cacheDir)
}
