export const VOICE_SERVER_HTTP_BASE_URL = 'http://127.0.0.1:8000'
export const VOICE_SERVER_HEALTH_URL = `${VOICE_SERVER_HTTP_BASE_URL}/health`
export const VOICE_SERVER_READY_URL = `${VOICE_SERVER_HTTP_BASE_URL}/ready`
export const VOICE_SERVER_VOICE_FLOW_URL = `${VOICE_SERVER_HTTP_BASE_URL}/ai/voice_flow`
export const VOICE_SERVER_TEXT_FLOW_URL = `${VOICE_SERVER_HTTP_BASE_URL}/ai/text_flow`

const REVERSE_COMPAT_WS_VERSION = 'win_local'
const REVERSE_COMPAT_WS_TOKEN = 'local-dev-token'
const REVERSE_COMPAT_WS_MODE = '0'

export type VoiceServerProbeResult = {
  ok: boolean
  status: number
  detail: string
  payload: unknown
}

function toVoiceServerWebSocketUrl() {
  const url = new URL('/ws/rt_voice_flow', VOICE_SERVER_HTTP_BASE_URL)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('v', REVERSE_COMPAT_WS_VERSION)
  url.searchParams.set('t', REVERSE_COMPAT_WS_TOKEN)
  url.searchParams.set('m', REVERSE_COMPAT_WS_MODE)
  return url.toString()
}

async function parseJsonSafely(response: Response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function resolveProbeDetail(url: string, status: number, payload: unknown) {
  if (payload && typeof payload === 'object') {
    const objectPayload = payload as Record<string, unknown>
    const detail = objectPayload.detail
    if (typeof detail === 'string' && detail) return detail
    const state = objectPayload.status
    if (typeof state === 'string' && state) return state
  }

  return status > 0 ? `${url} 返回 ${status}` : `无法连接 ${url}`
}

async function probeVoiceServer(url: string): Promise<VoiceServerProbeResult> {
  try {
    const response = await fetch(url)
    const payload = await parseJsonSafely(response)
    return {
      ok: response.ok,
      status: response.status,
      detail: resolveProbeDetail(url, response.status, payload),
      payload,
    }
  } catch {
    return {
      ok: false,
      status: 0,
      detail: `无法连接 ${url}`,
      payload: null,
    }
  }
}

export const VOICE_SERVER_WS_URL = toVoiceServerWebSocketUrl()

export function probeVoiceServerHealth() {
  return probeVoiceServer(VOICE_SERVER_HEALTH_URL)
}

export function probeVoiceServerReady() {
  return probeVoiceServer(VOICE_SERVER_READY_URL)
}
