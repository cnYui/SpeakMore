import type { ShortcutIntent } from './shortcutGuard'
import {
  getFocusedSelectionSnapshot,
  type FocusedInfo,
  type FocusedSelectionSnapshot,
} from './focusedContext'
import type { VoiceMode } from './voiceTypes'

export type VoiceTaskDelivery = 'paste' | 'floating-panel'

export type VoiceTask = {
  mode: VoiceMode
  selectedText: string
  source: FocusedSelectionSnapshot['source']
  confidence: FocusedSelectionSnapshot['confidence']
  focusInfo: FocusedInfo | null
  delivery: VoiceTaskDelivery
}

type SelectionSnapshotReader = () => Promise<FocusedSelectionSnapshot>

function createTask(
  mode: VoiceMode,
  snapshot: FocusedSelectionSnapshot,
  delivery: VoiceTaskDelivery,
): VoiceTask {
  return {
    mode,
    selectedText: snapshot.selectedText,
    source: snapshot.source,
    confidence: snapshot.confidence,
    focusInfo: snapshot.focusInfo,
    delivery,
  }
}

function createNoSelectionSnapshot(snapshot: FocusedSelectionSnapshot): FocusedSelectionSnapshot {
  return {
    ...snapshot,
    selectedText: '',
    source: 'none',
    confidence: 'none',
    focusInfo: null,
  }
}

export async function resolveVoiceTask(
  intent: ShortcutIntent,
  readSelectionSnapshot: SelectionSnapshotReader = getFocusedSelectionSnapshot,
): Promise<VoiceTask> {
  const snapshot = await readSelectionSnapshot()
  const hasConfirmedSelection = snapshot.source === 'uia'
    && snapshot.confidence === 'confirmed'
    && Boolean(snapshot.selectedText)

  if (intent === 'AskShortcut') {
    return createTask('Ask', hasConfirmedSelection ? snapshot : createNoSelectionSnapshot(snapshot), 'floating-panel')
  }

  if (intent === 'TranslateShortcut') {
    return createTask('Translate', createNoSelectionSnapshot(snapshot), 'paste')
  }

  return createTask('Dictate', createNoSelectionSnapshot(snapshot), 'paste')
}
