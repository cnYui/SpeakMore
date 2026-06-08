/**
 * 快捷键意图解析为语音任务
 *
 * 需要确认听写、语音翻译、自由提问和选区上下文规则时看这里。
 */
import type { ShortcutIntent } from '../shortcutGuard'
import type { ShortcutCommand } from '../shortcutCommandStore'
import {
  getFocusedInfoSnapshot,
  getFocusedSelectionSnapshot,
  type FocusedInfo,
  type FocusedSelectionSnapshot,
} from './focusedContext'
import type { VoiceMode } from './voiceTypes'
import type { MeetingAudioSource, MeetingTranslationTarget } from '../meetingNotesStore'

export type VoiceTaskDelivery = 'paste' | 'floating-panel' | 'none'

// 语音任务是快捷键意图解析后的稳定协议，后续录音链路只消费这份结果。
export type VoiceTask = {
  mode: VoiceMode
  selectedText: string
  source: FocusedSelectionSnapshot['source']
  confidence: FocusedSelectionSnapshot['confidence']
  focusInfo: FocusedInfo | null
  delivery: VoiceTaskDelivery
  customCommand?: {
    id: string
    name: string
    prompt: string
  }
  meetingOptions?: {
    audioSource: MeetingAudioSource
    targetLanguage: MeetingTranslationTarget
    showOriginal: boolean
    showTranslation: boolean
    module?: 'new_note' | 'live_translation'
  }
}

type SelectionSnapshotReader = () => Promise<FocusedSelectionSnapshot>
type FocusedInfoReader = () => Promise<FocusedInfo | null>

// 听写和语音翻译不依赖选区，避免有选中文本时误改业务模式。
const NO_SELECTION_SNAPSHOT: FocusedSelectionSnapshot = {
  selectedText: '',
  source: 'none',
  confidence: 'none',
  focusInfo: null,
}

function createTask(
  mode: VoiceMode,
  snapshot: FocusedSelectionSnapshot,
  delivery: VoiceTaskDelivery,
  customCommand?: VoiceTask['customCommand'],
): VoiceTask {
  return {
    mode,
    selectedText: snapshot.selectedText,
    source: snapshot.source,
    confidence: snapshot.confidence,
    focusInfo: snapshot.focusInfo,
    delivery,
    ...(customCommand ? { customCommand } : {}),
  }
}

function summarizeSelectedText(text: string) {
  const normalized = text.trim()
  return {
    hasText: Boolean(normalized),
    length: normalized.length,
    preview: normalized ? normalized.replace(/\s+/g, ' ').slice(0, 80) : '',
  }
}

function logVoiceTask(message: string, details: Record<string, unknown> = {}) {
  console.info('[voice][task] ' + message, details)
}

function createNoSelectionSnapshot(snapshot: FocusedSelectionSnapshot): FocusedSelectionSnapshot {
  // 保留结构但清空选区，避免不可信选区被自由提问当成上下文。
  return {
    ...snapshot,
    selectedText: '',
    source: 'none',
    confidence: 'none',
    focusInfo: null,
  }
}

async function createPasteTaskWithoutSelection(
  mode: VoiceMode,
  readFocusedInfoSnapshot: FocusedInfoReader,
): Promise<VoiceTask> {
  return createTask(mode, {
    ...NO_SELECTION_SNAPSHOT,
    focusInfo: await readFocusedInfoSnapshot(),
  }, 'paste')
}

export async function resolveVoiceTask(
  intent: ShortcutIntent,
  readSelectionSnapshot: SelectionSnapshotReader = getFocusedSelectionSnapshot,
  readFocusedInfoSnapshot: FocusedInfoReader = getFocusedInfoSnapshot,
): Promise<VoiceTask> {
  logVoiceTask('开始解析快捷键意图', { intent })
  // 翻译快捷键是显式语音翻译，不能因为当前有选区就变成选区翻译。
  if (intent === 'TranslateShortcut') {
    const task = await createPasteTaskWithoutSelection('Translate', readFocusedInfoSnapshot)
    logVoiceTask('解析为语音翻译任务', {
      intent,
      mode: task.mode,
      delivery: task.delivery,
      focusApp: task.focusInfo?.appInfo.app_identifier || '',
      focusTitle: task.focusInfo?.appInfo.window_title || '',
    })
    return task
  }

  // 普通听写始终优先自动粘贴，不读取 UIA 选区，避免选区状态影响听写语义。
  if (intent !== 'AskShortcut') {
    const task = await createPasteTaskWithoutSelection('Dictate', readFocusedInfoSnapshot)
    logVoiceTask('解析为普通听写任务', {
      intent,
      mode: task.mode,
      delivery: task.delivery,
      focusApp: task.focusInfo?.appInfo.app_identifier || '',
      focusTitle: task.focusInfo?.appInfo.window_title || '',
    })
    return task
  }

  // 只有自由提问需要选区上下文；UIA confirmed 优先，UIA 不可用时接受剪贴板 fallback。
  const snapshot = await readSelectionSnapshot()
  logVoiceTask('自由提问读取选区快照完成', {
    source: snapshot.source,
    confidence: snapshot.confidence,
    focusApp: snapshot.focusInfo?.appInfo.app_identifier || '',
    focusTitle: snapshot.focusInfo?.appInfo.window_title || '',
    ...summarizeSelectedText(snapshot.selectedText),
  })

  const hasSupportedSelection = Boolean(snapshot.selectedText)
    && (
      (snapshot.source === 'uia' && snapshot.confidence === 'confirmed')
      || (snapshot.source === 'clipboard' && snapshot.confidence === 'fallback')
    )

  // 自由提问的结果永远展示在悬浮面板，不参与自动粘贴或替换。
  const task = createTask('Ask', hasSupportedSelection ? snapshot : createNoSelectionSnapshot(snapshot), 'floating-panel')
  logVoiceTask('解析为自由提问任务', {
    intent,
    mode: task.mode,
    delivery: task.delivery,
    source: task.source,
    confidence: task.confidence,
    hasSupportedSelection,
    ...summarizeSelectedText(task.selectedText),
  })
  return task
}

export async function resolveShortcutCommandVoiceTask(
  command: ShortcutCommand,
  readFocusedInfoSnapshot: FocusedInfoReader = getFocusedInfoSnapshot,
): Promise<VoiceTask> {
  if (command.action === 'ask') {
    return createTask('Ask', NO_SELECTION_SNAPSHOT, 'floating-panel')
  }

  if (command.action === 'custom-command') {
    const focusInfo = command.delivery === 'paste' ? await readFocusedInfoSnapshot() : null
    return createTask('CustomCommand', {
      ...NO_SELECTION_SNAPSHOT,
      focusInfo,
    }, command.delivery, {
      id: command.id,
      name: command.name,
      prompt: command.prompt,
    })
  }

  const focusInfo = await readFocusedInfoSnapshot()
  return createTask('Dictate', {
    ...NO_SELECTION_SNAPSHOT,
    focusInfo,
  }, 'paste')
}

export function createMeetingNotesVoiceTask(options?: VoiceTask['meetingOptions']): VoiceTask {
  return {
    ...createTask('MeetingNotes', NO_SELECTION_SNAPSHOT, 'none'),
    ...(options ? { meetingOptions: options } : {}),
  }
}
