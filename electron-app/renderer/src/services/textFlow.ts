import { VOICE_SERVER_TEXT_FLOW_URL } from './voiceServer'
import type { VoiceFlowMode } from './voiceTypes'

type TextFlowPayload = {
  mode: VoiceFlowMode
  text: string
  parameters?: Record<string, string>
}

async function parseJsonSafely(response: Response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function getErrorDetail(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object') {
    const objectPayload = payload as Record<string, unknown>
    const detail = objectPayload.detail
    if (typeof detail === 'string' && detail) return detail

    const data = objectPayload.data
    if (data && typeof data === 'object') {
      const nestedDetail = (data as Record<string, unknown>).detail
      if (typeof nestedDetail === 'string' && nestedDetail) return nestedDetail

      const refineText = (data as Record<string, unknown>).refine_text
      if (typeof refineText === 'string' && refineText) return refineText
    }
  }
  return fallback
}

export async function requestTextFlow(payload: TextFlowPayload): Promise<string> {
  const response = await fetch(VOICE_SERVER_TEXT_FLOW_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await parseJsonSafely(response)

  if (!response.ok) {
    throw new Error(getErrorDetail(data, `文本处理服务返回 ${response.status}`))
  }

  if (data && typeof data === 'object') {
    if ((data as { status?: unknown }).status === 'ERROR') {
      throw new Error(getErrorDetail(data, '文本处理失败'))
    }

    const refineText = (data as { data?: { refine_text?: unknown } }).data?.refine_text
    return typeof refineText === 'string' ? refineText : ''
  }

  return ''
}
