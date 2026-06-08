/**
 * 语音结果交付策略
 *
 * 需要判断自动粘贴、粘贴失败兜底或自由提问展示时看这里。
 */
import { hideFloatingPanel, showFreeAskResult } from '../floatingPanel'
import { ipcClient } from '../ipc'
import type { VoiceTask } from './voiceTaskResolver'
import type { VoiceMode } from './voiceTypes'

export { hideFloatingPanel }

export async function pasteResultOrShowPanel(resultText: string, task: VoiceTask | null = null) {
  try {
    const result = await ipcClient.invoke('keyboard:type-transcript', resultText, {
      startFocusInfo: task?.focusInfo ?? null,
    })
    if (result === false || (result && typeof result === 'object' && (result as { success?: unknown }).success === false)) {
      // 自动粘贴失败时必须保底展示结果，不能让用户丢失本轮文本。
      showFreeAskResult(resultText)
    }
  } catch {
    showFreeAskResult(resultText)
  }
}

export async function deliverVoiceResult(
  resultText: string,
  task: VoiceTask | null,
  mode: VoiceMode,
) {
  // 自由提问不自动粘贴；其它模式先尝试粘贴，失败再展示悬浮结果。
  if (task?.delivery === 'none') return

  if (task?.delivery === 'floating-panel' || mode === 'Ask') {
    showFreeAskResult(resultText)
    return
  }

  await pasteResultOrShowPanel(resultText, task)
}
