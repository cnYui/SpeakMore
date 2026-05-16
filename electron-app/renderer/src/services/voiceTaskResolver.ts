import type { ShortcutIntent } from './shortcutGuard'
import {
  getFocusedSelectionSnapshot,
  type FocusedInfo,
  type FocusedSelectionSnapshot,
} from './focusedContext'
import type { VoiceMode } from './voiceTypes'

export type VoiceTaskDelivery = 'paste' | 'replace-selection' | 'floating-panel'

export type VoiceTask = {
  mode: VoiceMode
  selectedText: string
  focusInfo: FocusedInfo | null
  delivery: VoiceTaskDelivery
  shouldRecordAudio: boolean
}

type SelectionSnapshotReader = () => Promise<FocusedSelectionSnapshot>

function createTask(
  mode: VoiceMode,
  snapshot: FocusedSelectionSnapshot,
  delivery: VoiceTaskDelivery,
  shouldRecordAudio: boolean,
): VoiceTask {
  return {
    mode,
    selectedText: snapshot.selectedText,
    focusInfo: snapshot.focusInfo,
    delivery,
    shouldRecordAudio,
  }
}

export async function resolveVoiceTask(
  intent: ShortcutIntent,
  readSelectionSnapshot: SelectionSnapshotReader = getFocusedSelectionSnapshot,
): Promise<VoiceTask> {
  const snapshot = await readSelectionSnapshot()
  const hasSelection = Boolean(snapshot.selectedText)

  if (intent === 'AskShortcut') {
    return createTask('Ask', snapshot, hasSelection ? 'replace-selection' : 'floating-panel', true)
  }

  if (intent === 'TranslateShortcut') {
    return createTask('Translate', snapshot, 'paste', true)
  }

  if (hasSelection) {
    return createTask('Translate', snapshot, 'replace-selection', false)
  }

  return createTask('Dictate', snapshot, 'paste', true)
}
