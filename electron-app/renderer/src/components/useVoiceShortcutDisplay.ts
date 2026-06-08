import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fallbackShortcutCommands,
  listShortcutCommands,
  saveShortcutCommand,
  subscribeShortcutCommandChanges,
  type ShortcutCommand,
} from '../services/shortcutCommandStore'

const VOICE_INPUT_COMMAND_ID = 'voice_input'
const SMART_ASSISTANT_COMMAND_ID = 'smart_assistant'
const TRANSLATE_TO_ENGLISH_COMMAND_ID = 'translate_to_english'

function findCommand(commands: ShortcutCommand[], id: string) {
  return commands.find((command) => command.id === id) || fallbackShortcutCommands.find((command) => command.id === id) || null
}

function shortcutDisplay(command: ShortcutCommand | null, fallback: string) {
  return command?.shortcut?.display?.trim() || fallback
}

export function useShortcutCommands() {
  const [commands, setCommands] = useState<ShortcutCommand[]>(fallbackShortcutCommands)

  const refresh = useCallback(async () => {
    const nextCommands = await listShortcutCommands()
    setCommands(nextCommands.length ? nextCommands : fallbackShortcutCommands)
  }, [])

  const saveCommand = useCallback(async (command: Partial<ShortcutCommand>) => {
    await saveShortcutCommand(command)
    await refresh()
  }, [refresh])

  useEffect(() => {
    void refresh()
    return subscribeShortcutCommandChanges(() => {
      void refresh()
    })
  }, [refresh])

  return { commands, refresh, saveCommand }
}

export function useVoiceShortcutDisplay() {
  const shortcutCommands = useShortcutCommands()

  return useMemo(() => {
    const voiceInputCommand = findCommand(shortcutCommands.commands, VOICE_INPUT_COMMAND_ID)
    const smartAssistantCommand = findCommand(shortcutCommands.commands, SMART_ASSISTANT_COMMAND_ID)
    const translateCommand = findCommand(shortcutCommands.commands, TRANSLATE_TO_ENGLISH_COMMAND_ID)
    const voiceShortcutDisplay = shortcutDisplay(voiceInputCommand, 'Right Alt')
    const voiceInputEnabled = voiceInputCommand?.enabled !== false
    const smartAssistantAvailable = voiceInputEnabled && smartAssistantCommand?.enabled !== false

    return {
      ...shortcutCommands,
      voiceInputCommand,
      smartAssistantCommand,
      voiceShortcutDisplay,
      smartAssistantDisplay: `${voiceShortcutDisplay} x 2`,
      voiceInputEnabled,
      smartAssistantAvailable,
      translateCommand,
      translateShortcutDisplay: shortcutDisplay(translateCommand, 'Tab'),
      translateCommandEnabled: translateCommand?.enabled !== false,
    }
  }, [shortcutCommands])
}
