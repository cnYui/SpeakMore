import { Box, Button, Dialog, TextField, Typography } from '@mui/material'
import type { KeyboardEvent } from 'react'
import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { sectionTitleSx } from '../uiTokens'
import type { ShortcutCommand, ShortcutCommandShortcut } from '../services/shortcutCommandStore'

const MODIFIER_KEYS = new Set([
  'Ctrl',
  'Left Ctrl',
  'Right Ctrl',
  'Shift',
  'Left Shift',
  'Right Shift',
  'Alt',
  'Left Alt',
  'Right Alt',
  'Meta',
  'Left Meta',
  'Right Meta',
])

function normalizeKeyName(key: string, code = '') {
  if (code === 'AltRight') return 'Right Alt'
  if (code === 'AltLeft') return 'Left Alt'
  if (code === 'ShiftRight') return 'Right Shift'
  if (code === 'ShiftLeft') return 'Left Shift'
  if (code === 'ControlRight') return 'Right Ctrl'
  if (code === 'ControlLeft') return 'Left Ctrl'
  if (code === 'MetaRight') return 'Right Meta'
  if (code === 'MetaLeft') return 'Left Meta'
  if (key === ' ') return 'Space'
  if (key === 'Esc') return 'Escape'
  if (key.length === 1) return key.toUpperCase()
  return key
}

function activeModifierNames(event: KeyboardEvent) {
  return [
    event.ctrlKey ? (event.code === 'ControlRight' ? 'Right Ctrl' : event.code === 'ControlLeft' ? 'Left Ctrl' : 'Ctrl') : '',
    event.altKey ? (event.code === 'AltRight' ? 'Right Alt' : event.code === 'AltLeft' ? 'Left Alt' : 'Alt') : '',
    event.shiftKey ? (event.code === 'ShiftRight' ? 'Right Shift' : event.code === 'ShiftLeft' ? 'Left Shift' : 'Shift') : '',
    event.metaKey ? (event.code === 'MetaRight' ? 'Right Meta' : event.code === 'MetaLeft' ? 'Left Meta' : 'Meta') : '',
  ].filter(Boolean)
}

function toAcceleratorKey(key: string) {
  if (key === 'Right Ctrl' || key === 'Left Ctrl') return 'Ctrl'
  if (key === 'Right Alt' || key === 'Left Alt') return 'Alt'
  if (key === 'Right Shift' || key === 'Left Shift') return 'Shift'
  if (key === 'Right Meta' || key === 'Left Meta') return 'Meta'
  return key
}

function uniqueKeys(keys: string[]) {
  return keys.filter((item, index, values) => values.indexOf(item) === index)
}

export function shortcutFromKeyboardEvent(event: KeyboardEvent): ShortcutCommandShortcut {
  const key = normalizeKeyName(event.key, event.code)
  const modifiers = activeModifierNames(event)
  const keys = MODIFIER_KEYS.has(key) ? modifiers : uniqueKeys([...modifiers, key].filter(Boolean))
  const display = keys.join(' + ')
  const isDefaultRightAlt = keys.length === 1 && keys[0] === 'Right Alt'
  return {
    accelerator: isDefaultRightAlt ? '' : keys.map(toAcceleratorKey).join('+'),
    keys,
    display,
    fixed: isDefaultRightAlt,
  }
}

export function ShortcutKeyButton({
  label,
  disabled = false,
  ariaLabel,
  onClick,
}: {
  label: string
  disabled?: boolean
  ariaLabel?: string
  onClick?: () => void
}) {
  const keyLabel = label || 'Unset'
  const baseSx = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 24,
    px: '8px',
    py: '2px',
    mx: '3px',
    borderRadius: '7px',
    border: '1px solid rgba(15, 23, 42, 0.14)',
    bgcolor: disabled ? 'rgba(148, 163, 184, 0.12)' : '#fff',
    color: disabled ? 'text.disabled' : '#111827',
    boxShadow: disabled ? 'none' : '0 1px 0 rgba(15, 23, 42, 0.10)',
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.25,
    letterSpacing: 0,
    textTransform: 'uppercase',
    verticalAlign: 'baseline',
    whiteSpace: 'nowrap',
  }

  if (!onClick) {
    return <Box component="span" sx={baseSx}>{keyLabel}</Box>
  }

  return (
    <Box
      component="button"
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={onClick}
      sx={{
        ...baseSx,
        cursor: disabled ? 'not-allowed' : 'pointer',
        '&:hover': disabled ? undefined : {
          borderColor: 'rgba(37, 99, 235, 0.42)',
          bgcolor: 'rgba(37, 99, 235, 0.06)',
        },
        '&:focus-visible': {
          outline: '2px solid rgba(37, 99, 235, 0.36)',
          outlineOffset: 2,
        },
      }}
    >
      {keyLabel}
    </Box>
  )
}

export function ShortcutDisplayButtons({
  display,
  disabled = false,
  ariaLabel,
  onClick,
}: {
  display: string
  disabled?: boolean
  ariaLabel?: string
  onClick?: () => void
}) {
  const keys = display.split(/\s+\+\s+/).map((item) => item.trim()).filter(Boolean)
  const labels = keys.length ? keys : [display || 'Unset']

  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, mx: '2px', verticalAlign: 'baseline' }}>
      {labels.map((label, index) => (
        <Box key={`${label}-${index}`} component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
          <ShortcutKeyButton label={label} disabled={disabled} ariaLabel={ariaLabel} onClick={onClick} />
          {index < labels.length - 1 ? (
            <Box component="span" sx={{ color: disabled ? 'text.disabled' : 'text.secondary', fontSize: 12, fontWeight: 600 }}>+</Box>
          ) : null}
        </Box>
      ))}
    </Box>
  )
}

export function ShortcutBindingDialog({
  command,
  onClose,
  onSave,
}: {
  command: ShortcutCommand | null
  onClose: () => void
  onSave: (command: Partial<ShortcutCommand>) => void | Promise<void>
}) {
  const { t } = useI18n()
  const [display, setDisplay] = useState('')

  useEffect(() => {
    setDisplay('')
  }, [command])

  if (!command) return null

  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth={false}
      slotProps={{
        paper: {
          sx: {
            width: 380,
            borderRadius: '18px',
            p: 2.5,
            boxShadow: '0 24px 70px rgba(15, 23, 42, 0.22)',
          },
        },
        backdrop: { sx: { bgcolor: 'rgba(17, 24, 39, 0.38)' } },
      }}
    >
      <Typography sx={{ ...sectionTitleSx, textAlign: 'center', mb: 2 }}>
        {t('shortcuts.recordShortcutTitle')}
      </Typography>
      <TextField
        autoFocus
        fullWidth
        value={display}
        placeholder={t('shortcuts.recordShortcutPlaceholder')}
        slotProps={{ htmlInput: { readOnly: true } }}
        onKeyDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
          const shortcut = shortcutFromKeyboardEvent(event)
          setDisplay(shortcut.display)
          void onSave({ id: command.id, shortcut })
        }}
        sx={{
          '& .MuiOutlinedInput-root': {
            height: 52,
            borderRadius: '14px',
            bgcolor: '#fafafa',
            textAlign: 'center',
          },
          '& input': {
            textAlign: 'center',
            fontSize: 16,
            fontWeight: 700,
          },
        }}
      />
      <Button onClick={onClose} sx={{ mt: 1.5, height: 38, color: 'text.secondary', fontSize: 14, fontWeight: 700 }}>
        {t('shortcuts.cancel')}
      </Button>
    </Dialog>
  )
}
