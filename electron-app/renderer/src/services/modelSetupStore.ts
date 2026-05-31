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
  elapsed_ms?: number
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

function normalizeModelStatus(value: unknown): VoiceModelStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unavailableStatus
  const status = value as Record<string, unknown>
  const rawStatus = typeof status.status === 'string' ? status.status : 'unavailable'
  const normalizedStatus = ['idle', 'downloading', 'loading', 'ready', 'failed'].includes(rawStatus)
    ? rawStatus as VoiceModelSetupStatus
    : 'unavailable'

  return {
    success: Boolean(status.success ?? normalizedStatus !== 'unavailable'),
    status: normalizedStatus,
    detail: typeof status.detail === 'string' ? status.detail : '',
    model_id: typeof status.model_id === 'string' ? status.model_id : '',
    repo_id: typeof status.repo_id === 'string' ? status.repo_id : '',
    cache_dir: typeof status.cache_dir === 'string' ? status.cache_dir : '',
    cached: Boolean(status.cached),
    ready: Boolean(status.ready || normalizedStatus === 'ready'),
    elapsed_ms: typeof status.elapsed_ms === 'number' ? status.elapsed_ms : 0,
  }
}
export async function getVoiceModelStatus(cacheDir = ''): Promise<VoiceModelStatus> {
  try {
    return normalizeModelStatus(await ipcClient.invoke('voice-model:get-status', { cacheDir }))
  } catch {
    return unavailableStatus
  }
}

export async function startVoiceModelDownload(cacheDir = ''): Promise<VoiceModelStatus> {
  try {
    return normalizeModelStatus(await ipcClient.invoke('voice-model:start-download', { cacheDir }))
  } catch {
    return unavailableStatus
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
