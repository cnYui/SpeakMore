import { ipcClient } from './ipc'

export type ShortcutCommandCategory = 'default' | 'recommended' | 'custom'
export type ShortcutCommandKind = 'builtin' | 'preset' | 'custom'
export type ShortcutCommandDelivery = 'paste' | 'floating-panel' | 'none'
export type ShortcutCommandAction = 'dictate' | 'ask' | 'toggle-dictate' | 'custom-command'

export type ShortcutCommandShortcut = {
  accelerator: string
  keys: string[]
  display: string
  fixed: boolean
}

export type ShortcutCommand = {
  id: string
  name: string
  description: string
  prompt: string
  category: ShortcutCommandCategory
  kind: ShortcutCommandKind
  action: ShortcutCommandAction
  enabled: boolean
  editable: boolean
  deletable: boolean
  shortcut: ShortcutCommandShortcut
  delivery: ShortcutCommandDelivery
  updatedAt: string
}

export type ShortcutCommandRegistrationStatus = Record<string, {
  id: string
  name: string
  shortcut: ShortcutCommandShortcut
  status: 'disabled' | 'fixed' | 'unassigned' | 'registered' | 'failed' | 'conflict' | 'invalid'
  detail: string
  updatedAt: string
}>

export type ShortcutCommandChangeEvent = {
  reason: string
  command?: ShortcutCommand
  id?: string
  changedAt?: string
  registrationStatus?: ShortcutCommandRegistrationStatus
}

const now = () => new Date().toISOString()

export const fallbackShortcutCommands: ShortcutCommand[] = [
  {
    id: 'voice_input',
    name: 'Voice Input',
    description: 'Hold to speak, release to transcribe and paste.',
    prompt: '',
    category: 'default',
    kind: 'builtin',
    action: 'dictate',
    enabled: true,
    editable: false,
    deletable: false,
    shortcut: { accelerator: '', keys: ['Right Alt'], display: 'Right Alt', fixed: true },
    delivery: 'paste',
    updatedAt: now(),
  },
  {
    id: 'smart_assistant',
    name: 'Smart Assistant',
    description: 'Double-tap the voice input shortcut to ask a question and show the answer in the floating panel.',
    prompt: '',
    category: 'default',
    kind: 'builtin',
    action: 'ask',
    enabled: true,
    editable: false,
    deletable: false,
    shortcut: { accelerator: '', keys: ['Right Alt', 'x 2'], display: 'Right Alt x 2', fixed: true },
    delivery: 'floating-panel',
    updatedAt: now(),
  },
  {
    id: 'hands_free_mode',
    name: 'Hands-Free Mode',
    description: 'Press once to start recording, then press again to stop.',
    prompt: '',
    category: 'default',
    kind: 'builtin',
    action: 'toggle-dictate',
    enabled: false,
    editable: false,
    deletable: false,
    shortcut: { accelerator: '', keys: [], display: '', fixed: false },
    delivery: 'paste',
    updatedAt: now(),
  },
  {
    id: 'translate_to_english',
    name: 'English Translation Command',
    description: 'A separately bindable shortcut command. Record speech and translate it into natural English.',
    prompt: '',
    category: 'recommended',
    kind: 'preset',
    action: 'custom-command',
    enabled: true,
    editable: false,
    deletable: false,
    shortcut: { accelerator: 'Tab', keys: ['Tab'], display: 'Tab', fixed: false },
    delivery: 'paste',
    updatedAt: now(),
  },
]

function normalizeCommands(value: unknown): ShortcutCommand[] {
  return Array.isArray(value) ? value.filter((item): item is ShortcutCommand => Boolean(item && typeof item === 'object')) : []
}

export async function listShortcutCommands(): Promise<ShortcutCommand[]> {
  try {
    const commands = await ipcClient.invoke<ShortcutCommand[]>('shortcut-command:list')
    return normalizeCommands(commands)
  } catch {
    return fallbackShortcutCommands
  }
}

export async function saveShortcutCommand(command: Partial<ShortcutCommand>): Promise<ShortcutCommand | null> {
  try {
    const response = await ipcClient.invoke<{ success?: boolean; data?: ShortcutCommand }>('shortcut-command:upsert', command)
    return response?.data || null
  } catch {
    return null
  }
}

export async function deleteShortcutCommand(id: string): Promise<boolean> {
  try {
    const response = await ipcClient.invoke<{ success?: boolean }>('shortcut-command:delete', id)
    return Boolean(response?.success)
  } catch {
    return false
  }
}

export async function getShortcutRegistrationStatus(): Promise<ShortcutCommandRegistrationStatus> {
  try {
    return await ipcClient.invoke<ShortcutCommandRegistrationStatus>('shortcut-command:registration-status')
  } catch {
    return {}
  }
}

export function subscribeShortcutCommandChanges(listener: (event: ShortcutCommandChangeEvent) => void) {
  return ipcClient.on('shortcut-command:changed', (_event, payload) => {
    listener((payload || {}) as ShortcutCommandChangeEvent)
  })
}

export function subscribeShortcutCommandTriggers(listener: (command: ShortcutCommand) => void) {
  return ipcClient.on('shortcut-command:triggered', (_event, payload) => {
    if (payload && typeof payload === 'object') listener(payload as ShortcutCommand)
  })
}
