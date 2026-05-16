import { ipcClient } from './ipc'

export type FloatingPanelPayload =
  | { visible: false }
  | {
      visible: true
      type: 'shortcut-hint'
    }
  | {
      visible: true
      type: 'free-ask-result'
      text: string
    }

export function showShortcutHintPanel() {
  ipcClient.send('floating-panel', {
    visible: true,
    type: 'shortcut-hint',
  } satisfies FloatingPanelPayload)
}

export function showFreeAskResult(text: string) {
  const normalizedText = text.trim()
  if (!normalizedText) return

  ipcClient.send('floating-panel', {
    visible: true,
    type: 'free-ask-result',
    text: normalizedText,
  } satisfies FloatingPanelPayload)
}

export function hideFloatingPanel() {
  ipcClient.send('floating-panel', { visible: false } satisfies FloatingPanelPayload)
}
