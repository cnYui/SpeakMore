import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import BubbleChartIcon from '@mui/icons-material/BubbleChart'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import KeyboardIcon from '@mui/icons-material/Keyboard'
import MicIcon from '@mui/icons-material/Mic'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import TagIcon from '@mui/icons-material/Tag'
import TerminalIcon from '@mui/icons-material/Terminal'
import TranslateIcon from '@mui/icons-material/Translate'
import { useI18n, type TranslationKey } from '../i18n'
import { adaptivePageSx, captionTextSx, helperTextSx, itemTitleSx, pageDescriptionSx, pageTitleSx, sectionTitleSx } from '../uiTokens'
import { ShortcutBindingDialog } from '../components/ShortcutBindingDialog'
import {
  deleteShortcutCommand,
  getShortcutRegistrationStatus,
  listShortcutCommands,
  saveShortcutCommand,
  subscribeShortcutCommandChanges,
  type ShortcutCommand,
  type ShortcutCommandRegistrationStatus,
} from '../services/shortcutCommandStore'

const defaultCommandNames: Record<string, string> = {
  voice_input: 'Voice Input',
  smart_assistant: 'Smart Assistant',
  hands_free_mode: 'Hands-Free Mode',
  translate_to_english: 'English Translation Command',
  terminal_assistant: 'Terminal Assistant',
  professional_polish: 'Professional Polish',
  abstract_mode: 'Abstract Mode',
  internet_dark: 'Internet Jargon',
}

const defaultCommandDescriptions: Record<string, string> = {
  voice_input: 'Hold to speak, release to transcribe and paste.',
  smart_assistant: 'Double-tap the voice input shortcut to ask a question and show the answer in the floating panel.',
  hands_free_mode: 'Press once to start recording, then press again to stop.',
  translate_to_english: 'A separately bindable shortcut command. Record speech and translate it into natural English.',
  terminal_assistant: 'Convert spoken requests into directly executable command-line text.',
  professional_polish: 'Rewrite spoken content into polished workplace communication.',
  abstract_mode: 'Rewrite text with abstract slang, expressive energy, and emoji-heavy style.',
  internet_dark: 'Turn casual speech into internet slang and corporate jargon.',
}

const legacyDefaultCommandNames: Record<string, string[]> = {
  translate_to_english: ['Translate to English'],
  internet_dark: ['Corporate Jargon Mode'],
}

const legacyDefaultCommandDescriptions: Record<string, string[]> = {
  translate_to_english: ['Translate spoken content into natural, fluent English.'],
  internet_dark: ['Turn casual speech into corporate buzzword-filled project language.'],
}

const commandIconById: Record<string, React.ReactNode> = {
  voice_input: <MicIcon sx={{ fontSize: 18 }} />,
  smart_assistant: <SmartToyIcon sx={{ fontSize: 18 }} />,
  hands_free_mode: <KeyboardIcon sx={{ fontSize: 18 }} />,
  translate_to_english: <TranslateIcon sx={{ fontSize: 18 }} />,
  terminal_assistant: <TerminalIcon sx={{ fontSize: 18 }} />,
  professional_polish: <AutoFixHighIcon sx={{ fontSize: 18 }} />,
  abstract_mode: <BubbleChartIcon sx={{ fontSize: 18 }} />,
  internet_dark: <TagIcon sx={{ fontSize: 18 }} />,
}

function commandText(command: ShortcutCommand, field: 'name' | 'description', t: (key: TranslationKey) => string) {
  const defaultValue = field === 'name' ? defaultCommandNames[command.id] : defaultCommandDescriptions[command.id]
  const legacyValues = field === 'name' ? legacyDefaultCommandNames[command.id] : legacyDefaultCommandDescriptions[command.id]
  const key = `shortcuts.command.${command.id}.${field}` as TranslationKey
  if ([defaultValue, ...(legacyValues || [])].filter(Boolean).includes(command[field])) return t(key)
  return command[field]
}

function createEmptyCustomCommand(): Partial<ShortcutCommand> {
  return {
    name: '',
    description: '',
    prompt: '',
    category: 'custom',
    kind: 'custom',
    action: 'custom-command',
    enabled: true,
    editable: true,
    deletable: true,
    shortcut: { accelerator: '', keys: [], display: '', fixed: false },
    delivery: 'paste',
  }
}

function statusLabel(status: ShortcutCommandRegistrationStatus[string] | undefined, t: (key: TranslationKey) => string) {
  const value = status?.status || 'unassigned'
  return t(`shortcuts.registration.${value}` as TranslationKey)
}

function ShortcutCommandDialog({
  command,
  onClose,
  onSave,
  onDelete,
}: {
  command: Partial<ShortcutCommand> | null
  onClose: () => void
  onSave: (command: Partial<ShortcutCommand>) => void
  onDelete: (id: string) => void
}) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<Partial<ShortcutCommand>>(command || createEmptyCustomCommand())

  useEffect(() => {
    setDraft(command || createEmptyCustomCommand())
  }, [command])

  if (!command) return null

  const isBuiltin = draft.kind === 'builtin'
  const canEditText = !isBuiltin
  const canDelete = Boolean(draft.id && draft.deletable)

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{draft.id ? t('shortcuts.formTitleEdit') : t('shortcuts.formTitleNew')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        {isBuiltin ? <Alert severity="info">{t('shortcuts.builtInLocked')}</Alert> : null}
        <TextField
          label={t('shortcuts.nameLabel')}
          value={draft.name || ''}
          disabled={!canEditText}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
        />
        <TextField
          label={t('shortcuts.promptLabel')}
          value={draft.prompt || ''}
          disabled={!canEditText}
          multiline
          minRows={5}
          onChange={(event) => setDraft((current) => ({ ...current, prompt: event.target.value }))}
        />
        <TextField
          label={t('shortcuts.descriptionLabel')}
          value={draft.description || ''}
          disabled={!canEditText}
          multiline
          minRows={2}
          onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {canDelete ? (
          <Button color="error" startIcon={<DeleteIcon />} onClick={() => onDelete(String(draft.id))}>
            {t('shortcuts.delete')}
          </Button>
        ) : null}
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>{t('shortcuts.cancel')}</Button>
        <Button
          variant="contained"
          disabled={!String(draft.name || '').trim() || (draft.action === 'custom-command' && !String(draft.prompt || '').trim())}
          onClick={() => onSave(draft)}
        >
          {t('shortcuts.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function CommandRow({
  command,
  status,
  unavailable = false,
  onToggle,
  onEdit,
  onRecordShortcut,
}: {
  command: ShortcutCommand
  status?: ShortcutCommandRegistrationStatus[string]
  unavailable?: boolean
  onToggle: (command: ShortcutCommand) => void
  onEdit: (command: ShortcutCommand) => void
  onRecordShortcut: (command: ShortcutCommand) => void
}) {
  const { t } = useI18n()
  const name = commandText(command, 'name', t)
  const description = commandText(command, 'description', t)
  const shortcut = command.shortcut?.display || t('shortcuts.shortcutUnset')
  const canRecordShortcut = command.id === 'voice_input' || !command.shortcut?.fixed
  const canEditCommand = command.kind === 'custom'

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) auto auto' },
        alignItems: 'center',
        gap: 1.5,
        border: '1px solid rgba(119,119,119,0.10)',
        borderRadius: '8px',
        p: 1.5,
        bgcolor: '#fff',
        opacity: unavailable ? 0.56 : 1,
      }}
    >
      <Box sx={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <Box sx={{ width: 32, height: 32, borderRadius: '8px', bgcolor: 'rgba(119,119,119,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {commandIconById[command.id] || <KeyboardIcon sx={{ fontSize: 18 }} />}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={itemTitleSx}>{name}</Typography>
          <Typography sx={{ ...captionTextSx, color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: { xs: 'normal', md: 'nowrap' } }}>
            {description}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: { xs: 'flex-start', md: 'flex-end' }, flexWrap: 'wrap' }}>
        <Button
          disabled={!canRecordShortcut || unavailable}
          onClick={() => onRecordShortcut(command)}
          variant="outlined"
          sx={{
            minWidth: 0,
            height: 34,
            px: 1.35,
            borderRadius: 999,
            color: 'text.primary',
            borderColor: 'rgba(0,0,0,0.24)',
            bgcolor: canRecordShortcut && !unavailable ? '#fff' : '#fafafa',
            fontSize: 14,
            fontWeight: 600,
            '&.Mui-disabled': {
              color: 'text.primary',
              borderColor: 'rgba(0,0,0,0.20)',
              bgcolor: '#fafafa',
              opacity: 1,
            },
          }}
        >
          {shortcut}
        </Button>
        <Chip size="small" label={statusLabel(status, t)} />
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, justifyContent: { xs: 'flex-start', md: 'flex-end' } }}>
        <Switch checked={command.enabled && !unavailable} disabled={unavailable} onChange={() => onToggle(command)} size="small" />
        {canEditCommand ? (
          <IconButton aria-label={`${t('shortcuts.edit')} ${name}`} onClick={() => onEdit(command)} size="small">
            <EditIcon sx={{ fontSize: 18 }} />
          </IconButton>
        ) : (
          <Box sx={{ width: 30, height: 30 }} />
        )}
      </Box>
    </Box>
  )
}

export default function Shortcuts() {
  const { t } = useI18n()
  const [commands, setCommands] = useState<ShortcutCommand[]>([])
  const [registrationStatus, setRegistrationStatus] = useState<ShortcutCommandRegistrationStatus>({})
  const [editingCommand, setEditingCommand] = useState<Partial<ShortcutCommand> | null>(null)
  const [recordingShortcutCommand, setRecordingShortcutCommand] = useState<ShortcutCommand | null>(null)

  const refresh = useCallback(async () => {
    const [nextCommands, nextStatus] = await Promise.all([
      listShortcutCommands(),
      getShortcutRegistrationStatus(),
    ])
    setCommands(nextCommands)
    setRegistrationStatus(nextStatus)
  }, [])

  useEffect(() => {
    void refresh()
    return subscribeShortcutCommandChanges(() => {
      void refresh()
    })
  }, [refresh])

  const commandsBySection = useMemo(() => ({
    default: commands.filter((command) => command.category === 'default'),
    recommended: commands.filter((command) => command.category === 'recommended'),
    custom: commands.filter((command) => command.category === 'custom'),
  }), [commands])
  const voiceInputEnabled = commands.find((command) => command.id === 'voice_input')?.enabled !== false

  const handleToggle = async (command: ShortcutCommand) => {
    if (command.id === 'smart_assistant' && !voiceInputEnabled) return
    await saveShortcutCommand({ id: command.id, enabled: !command.enabled })
    await refresh()
  }

  const handleSave = async (command: Partial<ShortcutCommand>) => {
    await saveShortcutCommand(command)
    setEditingCommand(null)
    await refresh()
  }

  const handleRecordShortcut = async (command: ShortcutCommand) => {
    setRecordingShortcutCommand(command)
  }

  const handleSaveShortcut = async (command: Partial<ShortcutCommand>) => {
    await saveShortcutCommand(command)
    setRecordingShortcutCommand(null)
    await refresh()
  }

  const handleDelete = async (id: string) => {
    await deleteShortcutCommand(id)
    setEditingCommand(null)
    await refresh()
  }

  const renderSection = (title: string, items: ShortcutCommand[], emptyText = '') => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography sx={{ ...sectionTitleSx, color: 'text.secondary' }}>{title}</Typography>
      {items.length ? items.map((command) => (
        <CommandRow
          key={command.id}
          command={command}
          status={registrationStatus[command.id]}
          unavailable={command.id === 'smart_assistant' && !voiceInputEnabled}
          onToggle={handleToggle}
          onEdit={setEditingCommand}
          onRecordShortcut={handleRecordShortcut}
        />
      )) : (
        <Box sx={{ border: '1px dashed rgba(119,119,119,0.20)', borderRadius: '8px', p: 2 }}>
          <Typography sx={{ ...helperTextSx, color: 'text.secondary' }}>{emptyText}</Typography>
        </Box>
      )}
    </Box>
  )

  return (
    <Box sx={{ ...adaptivePageSx, display: 'flex', flexDirection: 'column', gap: { xs: 2, lg: 2.5 } }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={pageTitleSx}>{t('shortcuts.title')}</Typography>
          <Typography sx={{ ...pageDescriptionSx, color: 'text.secondary', mt: 0.5 }}>{t('shortcuts.subtitle')}</Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditingCommand(createEmptyCustomCommand())} sx={{ flexShrink: 0 }}>
          {t('shortcuts.addCommand')}
        </Button>
      </Box>

      {renderSection(t('shortcuts.defaultSection'), commandsBySection.default)}
      {renderSection(t('shortcuts.recommendedSection'), commandsBySection.recommended)}
      {renderSection(t('shortcuts.customSection'), commandsBySection.custom, t('shortcuts.emptyCustom'))}

      <ShortcutCommandDialog
        command={editingCommand}
        onClose={() => setEditingCommand(null)}
        onSave={handleSave}
        onDelete={handleDelete}
      />
      <ShortcutBindingDialog
        command={recordingShortcutCommand}
        onClose={() => setRecordingShortcutCommand(null)}
        onSave={handleSaveShortcut}
      />
    </Box>
  )
}
