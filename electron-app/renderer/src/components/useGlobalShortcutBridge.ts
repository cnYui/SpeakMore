/**
 * 全局快捷键桥接
 *
 * 需要把 Windows 低级键盘事件转成语音意图时看这里。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ipcClient } from '../services/ipc'
import {
  cancelRecording,
  getVoiceSession,
  toggleRecordingByShortcut,
  toggleRecordingByShortcutCommand,
} from '../services/recorder'
import { hideFloatingPanel, showShortcutHintPanel } from '../services/floatingPanel'
import {
  listShortcutCommands,
  subscribeShortcutCommandChanges,
  subscribeShortcutCommandTriggers,
  type ShortcutCommand,
} from '../services/shortcutCommandStore'
import {
  blockByLongPress,
  createInitialShortcutGuardState,
  disposeShortcutGuard,
  reduceShortcutGuard,
  type KeyboardLike,
  type ShortcutGuardState,
} from '../services/shortcutGuard'

const CANCELABLE_STATUSES = new Set(['connecting', 'recording', 'stopping', 'transcribing'])
const RIGHT_ALT_DOUBLE_TAP_MS = 280

export function useGlobalShortcutBridge() {
  const [shortcutGuard, setShortcutGuard] = useState(createInitialShortcutGuardState)
  const shortcutGuardRef = useRef(shortcutGuard)
  const shortcutHintMountedRef = useRef(false)
  const shortcutCommandsRef = useRef<Map<string, ShortcutCommand>>(new Map())
  const pendingDictateTimerRef = useRef<number | null>(null)
  const pendingDictateTapAtRef = useRef(0)

  const applyShortcutGuard = useCallback((nextGuard: ShortcutGuardState) => {
    shortcutGuardRef.current = nextGuard
    setShortcutGuard(nextGuard)
  }, [])

  const handleLongPress = useCallback(() => {
    applyShortcutGuard(blockByLongPress(shortcutGuardRef.current))
  }, [applyShortcutGuard])

  const clearPendingDictate = useCallback(() => {
    if (pendingDictateTimerRef.current !== null) {
      window.clearTimeout(pendingDictateTimerRef.current)
      pendingDictateTimerRef.current = null
    }
  }, [])

  const isCommandEnabled = useCallback((id: string) => {
    const command = shortcutCommandsRef.current.get(id)
    return command ? command.enabled : true
  }, [])

  const isVoiceInputHandledByRightAlt = useCallback(() => {
    const command = shortcutCommandsRef.current.get('voice_input')
    if (!command) return true
    const display = String(command.shortcut?.display || '').replace(/\s+/g, '').toLowerCase()
    const keys = command.shortcut?.keys || []
    return display === 'rightalt' || (keys.length === 1 && String(keys[0]).replace(/\s+/g, '').toLowerCase() === 'rightalt')
  }, [])

  const isSmartAssistantAvailable = useCallback(() => (
    isCommandEnabled('voice_input') && isCommandEnabled('smart_assistant')
  ), [isCommandEnabled])

  const triggerShortcutIntent = useCallback((intent: 'DictateShortcut' | 'AskShortcut' | 'TranslateShortcut') => {
    if (intent === 'AskShortcut') {
      clearPendingDictate()
      if (isSmartAssistantAvailable()) {
        void toggleRecordingByShortcut('AskShortcut')
      }
      return
    }

    if (intent === 'TranslateShortcut') {
      clearPendingDictate()
      void toggleRecordingByShortcut('TranslateShortcut')
      return
    }

    const pressedAt = Date.now()
    if (pendingDictateTimerRef.current !== null && pressedAt - pendingDictateTapAtRef.current <= RIGHT_ALT_DOUBLE_TAP_MS) {
      clearPendingDictate()
      if (isSmartAssistantAvailable()) {
        void toggleRecordingByShortcut('AskShortcut')
      }
      return
    }

    pendingDictateTapAtRef.current = pressedAt
    pendingDictateTimerRef.current = window.setTimeout(() => {
      pendingDictateTimerRef.current = null
      if (isCommandEnabled('voice_input')) {
        void toggleRecordingByShortcut('DictateShortcut')
      }
    }, RIGHT_ALT_DOUBLE_TAP_MS)
  }, [clearPendingDictate, isCommandEnabled, isSmartAssistantAvailable])

  useEffect(() => {
    shortcutGuardRef.current = shortcutGuard
  }, [shortcutGuard])

  useEffect(() => {
    if (!shortcutHintMountedRef.current) {
      shortcutHintMountedRef.current = true
      return
    }

    if (shortcutGuard.modalVisible) {
      showShortcutHintPanel()
      return
    }

    hideFloatingPanel()
  }, [shortcutGuard.modalVisible])

  useEffect(() => {
    const refreshCommands = () => {
      listShortcutCommands()
        .then((commands) => {
          shortcutCommandsRef.current = new Map(commands.map((command) => [command.id, command]))
        })
        .catch(() => undefined)
    }

    refreshCommands()
    return subscribeShortcutCommandChanges(() => {
      refreshCommands()
    })
  }, [])

  useEffect(() => {
    return subscribeShortcutCommandTriggers((command) => {
      if (command.id === 'voice_input') {
        triggerShortcutIntent('DictateShortcut')
        return
      }
      if (command.id === 'smart_assistant') {
        triggerShortcutIntent('AskShortcut')
        return
      }

      clearPendingDictate()
      void toggleRecordingByShortcutCommand(command)
    })
  }, [clearPendingDictate, triggerShortcutIntent])

  useEffect(() => {
    return ipcClient.on('global-keyboard', (_event, keys) => {
      const keyboardKeys = (Array.isArray(keys) ? keys : []) as KeyboardLike[]
      const hasRightAlt = keyboardKeys.some((key) => key?.keyName === 'RightAlt')
      const hasRightShift = keyboardKeys.some((key) => key?.keyName === 'RightShift' && key?.isKeydown)
      if (hasRightAlt && !hasRightShift && (!isVoiceInputHandledByRightAlt() || !isCommandEnabled('voice_input'))) {
        return
      }

      const next = reduceShortcutGuard(
        shortcutGuardRef.current,
        keyboardKeys,
        {
          voiceStatus: getVoiceSession().status,
          debugLog: (event, payload) => {
            if (import.meta.env.DEV) {
              console.debug(`[shortcut-debug] ${event}`, payload)
            }
          },
        },
        handleLongPress,
      )

      applyShortcutGuard(next.state)

      if (next.action.type === 'toggle-recording') {
        if ((next.action.intent === 'DictateShortcut' || next.action.intent === 'AskShortcut') && !isVoiceInputHandledByRightAlt()) {
          return
        }
        triggerShortcutIntent(next.action.intent)
      }
    })
  }, [applyShortcutGuard, handleLongPress, isCommandEnabled, isVoiceInputHandledByRightAlt, triggerShortcutIntent])

  useEffect(() => {
    return ipcClient.on('voice-cancel-requested', () => {
      if (!CANCELABLE_STATUSES.has(getVoiceSession().status)) return
      cancelRecording()
    })
  }, [])

  useEffect(() => {
    return () => {
      clearPendingDictate()
      disposeShortcutGuard(shortcutGuardRef.current)
    }
  }, [clearPendingDictate])

  return shortcutGuard
}
