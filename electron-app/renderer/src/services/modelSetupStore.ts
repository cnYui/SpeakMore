/**
 * 首次运行模型初始化数据源
 *
 * 需要查询或触发 SenseVoiceSmall 下载时看这里。
 */
import { ipcClient } from './ipc'

export type VoiceModelSetupStatus =
  | 'idle'
  | 'downloading'
  | 'loading'
  | 'ready'
  | 'failed'
  | 'unavailable'

export type VoiceModelStatus = {
  success?: boolean
  status: VoiceModelSetupStatus
  detail: string
  model_id?: string
  repo_id?: string
  cache_dir?: string
  cached?: boolean
  ready?: boolean
  device?: string
  requested_device?: string
  device_source?: string
  fallback_reason?: string | null
  elapsed_ms?: number
  downloaded_bytes?: number
  total_bytes?: number
  progress_percent?: number | null
  downloaded_files?: number
  total_files?: number
  file_progress_percent?: number | null
  active_model_id?: string
  models?: VoiceModelOption[]
}

export type VoiceModelOption = {
  model_id: string
  repo_id: string
  label: string
  variant: string
  runtime: string
  size_bytes: number
  active: boolean
  cached: boolean
  status: VoiceModelSetupStatus
  detail: string
  downloaded_bytes: number
  total_bytes: number
  progress_percent: number | null
  downloaded_files: number
  total_files: number
  file_progress_percent: number | null
}

export type DirectorySelectionResult = {
  success: boolean
  canceled: boolean
  path: string
}

const unavailableStatus: VoiceModelStatus = {
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

function normalizeSetupStatus(value: unknown): VoiceModelSetupStatus {
  const rawStatus = typeof value === 'string' ? value : 'unavailable'
  return ['idle', 'downloading', 'loading', 'ready', 'failed'].includes(rawStatus)
    ? rawStatus as VoiceModelSetupStatus
    : 'unavailable'
}

function normalizeModelOption(value: unknown): VoiceModelOption | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const option = value as Record<string, unknown>
  if (typeof option.model_id !== 'string' || !option.model_id) return null
  return {
    model_id: option.model_id,
    repo_id: typeof option.repo_id === 'string' ? option.repo_id : '',
    label: typeof option.label === 'string' ? option.label : option.model_id,
    variant: typeof option.variant === 'string' ? option.variant : '',
    runtime: typeof option.runtime === 'string' ? option.runtime : '',
    size_bytes: normalizeNumber(option.size_bytes),
    active: Boolean(option.active),
    cached: Boolean(option.cached),
    status: normalizeSetupStatus(option.status),
    detail: typeof option.detail === 'string' ? option.detail : '',
    downloaded_bytes: normalizeNumber(option.downloaded_bytes),
    total_bytes: normalizeNumber(option.total_bytes),
    progress_percent: normalizePercent(option.progress_percent),
    downloaded_files: normalizeNumber(option.downloaded_files),
    total_files: normalizeNumber(option.total_files),
    file_progress_percent: normalizePercent(option.file_progress_percent),
  }
}

function normalizeModelStatus(value: unknown): VoiceModelStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unavailableStatus
  const status = value as Record<string, unknown>
  const normalizedStatus = normalizeSetupStatus(status.status)
  const models = Array.isArray(status.models)
    ? status.models.map(normalizeModelOption).filter((option): option is VoiceModelOption => option !== null)
    : []

  return {
    success: Boolean(status.success ?? normalizedStatus !== 'unavailable'),
    status: normalizedStatus,
    detail: typeof status.detail === 'string' ? status.detail : '',
    model_id: typeof status.model_id === 'string' ? status.model_id : '',
    repo_id: typeof status.repo_id === 'string' ? status.repo_id : '',
    cache_dir: typeof status.cache_dir === 'string' ? status.cache_dir : '',
    cached: Boolean(status.cached),
    ready: Boolean(status.ready || normalizedStatus === 'ready'),
    device: typeof status.device === 'string' ? status.device : '',
    requested_device: typeof status.requested_device === 'string' ? status.requested_device : '',
    device_source: typeof status.device_source === 'string' ? status.device_source : '',
    fallback_reason: typeof status.fallback_reason === 'string' ? status.fallback_reason : null,
    elapsed_ms: typeof status.elapsed_ms === 'number' ? status.elapsed_ms : 0,
    downloaded_bytes: normalizeNumber(status.downloaded_bytes),
    total_bytes: normalizeNumber(status.total_bytes),
    progress_percent: normalizePercent(status.progress_percent),
    downloaded_files: normalizeNumber(status.downloaded_files),
    total_files: normalizeNumber(status.total_files),
    file_progress_percent: normalizePercent(status.file_progress_percent),
    active_model_id: typeof status.active_model_id === 'string' ? status.active_model_id : '',
    models,
  }
}
export async function getVoiceModelStatus(cacheDir = ''): Promise<VoiceModelStatus> {
  try {
    return normalizeModelStatus(await ipcClient.invoke('voice-model:get-status', { cacheDir }))
  } catch {
    return unavailableStatus
  }
}

/** 下载（如未下载）并加载为当前模型；modelId 为空时用设置里选用的模型。 */
export async function startVoiceModelDownload(cacheDir = '', modelId = ''): Promise<VoiceModelStatus> {
  try {
    return normalizeModelStatus(await ipcClient.invoke('voice-model:start-download', { cacheDir, modelId }))
  } catch {
    return unavailableStatus
  }
}

/** 只下载某个模型，不切换当前模型（初始化页的“下载”“全部下载”）。 */
export async function downloadVoiceModelOnly(modelId: string, cacheDir = ''): Promise<VoiceModelStatus> {
  try {
    return normalizeModelStatus(await ipcClient.invoke('voice-model:start-download', { cacheDir, modelId, load: false }))
  } catch {
    return unavailableStatus
  }
}

export type DeleteVoiceModelResult = {
  ok: boolean
  /** 删除后的模型状态（成功时有）。 */
  status: VoiceModelStatus | null
  /** 失败原因（后端给的，直接展示给用户）。 */
  detail: string
  freedBytes: number
  /** 别处还有一份（显式目录 / Hugging Face 缓存），应用不会删，只告诉用户位置。 */
  externalLocations: string[]
}

/** 删除一个已下载的模型。 */
export async function deleteVoiceModel(modelId: string, cacheDir = ''): Promise<DeleteVoiceModelResult> {
  try {
    const raw = await ipcClient.invoke<Record<string, unknown>>('voice-model:delete', { cacheDir, modelId })
    if (!raw || raw.success === false) {
      return {
        ok: false,
        status: null,
        detail: typeof raw?.detail === 'string' && raw.detail ? raw.detail : '删除模型失败',
        freedBytes: 0,
        externalLocations: [],
      }
    }
    const result = (raw.delete && typeof raw.delete === 'object' ? raw.delete : {}) as Record<string, unknown>
    return {
      ok: true,
      status: normalizeModelStatus(raw),
      detail: '',
      freedBytes: normalizeNumber(result.freed_bytes),
      externalLocations: Array.isArray(result.external_locations)
        ? result.external_locations.filter((item): item is string => typeof item === 'string')
        : [],
    }
  } catch (error) {
    return { ok: false, status: null, detail: error instanceof Error ? error.message : String(error), freedBytes: 0, externalLocations: [] }
  }
}

export async function chooseModelCacheDirectory(defaultPath = ''): Promise<DirectorySelectionResult> {
  try {
    const result = await ipcClient.invoke<Partial<DirectorySelectionResult>>('file:choose-directory', { defaultPath })
    return {
      success: Boolean(result?.success),
      canceled: Boolean(result?.canceled),
      path: typeof result?.path === 'string' ? result.path : '',
    }
  } catch {
    return { success: false, canceled: true, path: '' }
  }
}
