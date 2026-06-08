import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogContent,
  IconButton,
  InputBase,
  LinearProgress,
  Menu,
  MenuItem,
  Select,
  Switch,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CloseIcon from '@mui/icons-material/Close'
import DeleteIcon from '@mui/icons-material/Delete'
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined'
import GraphicEqIcon from '@mui/icons-material/GraphicEq'
import IosShareIcon from '@mui/icons-material/IosShare'
import KeyboardIcon from '@mui/icons-material/Keyboard'
import MicIcon from '@mui/icons-material/Mic'
import NotesIcon from '@mui/icons-material/Notes'
import MoreHorizIcon from '@mui/icons-material/MoreHoriz'
import PauseIcon from '@mui/icons-material/Pause'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import SearchIcon from '@mui/icons-material/Search'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import StopCircleIcon from '@mui/icons-material/StopCircle'
import { useI18n, type TranslationKey } from '../i18n'
import { ipcClient } from '../services/ipc'
import { generateMeetingNoteTitle } from '../services/meetingNoteTitle'
import type { MeetingStructuredItem, MeetingTopicSegment, MeetingTranscriptSegment } from '../services/meetingStructuredResult'
import {
  createDraftMeetingNote,
  deleteMeetingNote,
  importMeetingMediaFile,
  listMeetingNotes,
  saveMeetingNote,
  subscribeMeetingNoteChanges,
  type MeetingAudioSource,
  type MeetingNote,
  type MeetingTranslationTarget,
} from '../services/meetingNotesStore'
import {
  cancelRecording,
  getVoiceSession,
  setRecordingPaused,
  subscribeVoiceSession,
  toggleMeetingNotesRecording,
  updateMeetingNotesRecordingOptions,
} from '../services/recorder'
import {
  loadSettings,
  saveSettings,
  MEETING_LIVE_TARGET_LANGUAGES,
  MEETING_NOTE_TARGET_LANGUAGES,
  type TranslationTargetLanguageConfig,
} from '../services/settingsStore'
import {
  adaptivePageSx,
  bodyTextSx,
  captionTextSx,
  helperTextSx,
  itemTitleSx,
  pageDescriptionSx,
  pageTitleSx,
  sectionTitleSx,
} from '../uiTokens'

type MeetingView = 'list' | 'liveSetup' | 'recording' | 'processing' | 'detail' | 'import'
type RecordingKind = 'note' | 'live'
type DetailTab = 'note' | 'transcript'
type FileInputMode = 'note' | 'import'
export type MeetingAutoStartRequest = {
  requestId: string
  appName?: string
  appIdentifier?: string
  windowTitle?: string
  audioSource?: MeetingAudioSource
  targetLanguage?: MeetingTranslationTarget
}
type MeetingNotesProps = {
  autoStartRequest?: MeetingAutoStartRequest | null
  onAutoStartConsumed?: (requestId: string) => void
}
type RecordingStartOptions = {
  audioSource?: MeetingAudioSource
  targetLanguage?: MeetingTranslationTarget
  title?: string
}
type ImportItem = {
  name: string
  size: number
  status: 'uploaded' | 'processing' | 'completed' | 'error'
  error?: string
}

const TEXT_COLOR = '#202124'
const MUTED_COLOR = '#8b95a5'
const BORDER_COLOR = '#eeeeef'
const PANEL_COLOR = '#f5f5f6'
const BLUE_COLOR = '#3478f6'
const DANGER_COLOR = '#e2524d'
const WAVEFORM_BAR_SHAPE = [0.34, 0.58, 0.82, 0.64, 1, 0.7, 0.9, 0.56, 0.38]

const pageFrameSx = {
  ...adaptivePageSx,
  p: { xs: 2, md: 2.25 },
  width: '100%',
  maxWidth: 'none',
  minHeight: '100%',
  boxSizing: 'border-box',
  color: TEXT_COLOR,
  position: 'relative',
}

const selectSx = {
  height: 36,
  minWidth: 112,
  borderRadius: '10px',
  bgcolor: '#fff',
  '& .MuiOutlinedInput-notchedOutline': {
    borderColor: '#dedfe3',
  },
  '& .MuiSelect-select': {
    py: 0.65,
    ...bodyTextSx,
    fontSize: 13,
    color: '#606775',
  },
}

function noteMatches(note: MeetingNote, query: string) {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return true
  return [note.title, note.transcript, note.translationText, note.summary].some((value) => value.toLowerCase().includes(keyword))
}

function formatNoteDate(value: string, language: string, todayLabel: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date()
  const isToday = date.toDateString() === today.toDateString()
  const time = date.toLocaleTimeString(language, { hour: 'numeric', minute: '2-digit' })
  return `${isToday ? todayLabel : date.toLocaleDateString(language, { month: 'short', day: 'numeric' })} ${time}`
}

function formatElapsed(ms: number) {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function formatSegmentTime(value: string, language: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(language, { hour: 'numeric', minute: '2-digit' })
}

function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return '0 KB'
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(size / 1024))} KB`
}

function importErrorText(detail: string, t: (key: TranslationKey) => string) {
  if (detail === 'unsupported_media_type') return t('meeting.importUnsupported')
  if (detail === 'media_file_too_large') return t('meeting.importTooLarge')
  if (detail === 'llm_api_key_missing') return t('meeting.importMissingApiKey')
  return detail || t('meeting.importFailed')
}

function splitUsefulLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^#{1,6}\s*/, '').replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
}

function structuredItemTexts(items: MeetingStructuredItem[] | undefined) {
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item?.text || '').trim())
    .filter(Boolean)
}

function structuredTopicTexts(topics: MeetingTopicSegment[] | undefined) {
  return (Array.isArray(topics) ? topics : [])
    .map((topic) => {
      const title = String(topic?.title || '').trim()
      const summary = String(topic?.summary || '').trim()
      if (title && summary) return `${title}: ${summary}`
      return title || summary
    })
    .filter(Boolean)
}

function getTranscriptSegments(segments: MeetingTranscriptSegment[] | undefined) {
  return (Array.isArray(segments) ? segments : [])
    .map((segment) => ({
      index: Math.max(1, Number(segment?.index) || 1),
      text: String(segment?.text || '').trim(),
      contentLevel: String(segment?.contentLevel || '').trim(),
    }))
    .filter((segment) => segment.text)
}

function splitLiveText(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  return lines.length ? lines : (text.trim() ? [text.trim()] : [])
}

function getAudioSourceToast(source: MeetingAudioSource, t: (key: TranslationKey) => string) {
  if (source === 'system') return t('meeting.systemAudioToast')
  if (source === 'microphone_system') return t('meeting.micAndSystemToast')
  return t('meeting.microphoneToast')
}

function EntryCard({
  tone,
  icon,
  title,
  description,
  onClick,
}: {
  tone: 'new' | 'live' | 'import'
  icon: ReactNode
  title: string
  description: string
  onClick: () => void
}) {
  const tones = {
    new: { border: '#b9e8ca', bg: '#f3fcf6', iconBg: '#e3f7e9', color: '#238249' },
    live: { border: '#c7dcff', bg: '#f3f7ff', iconBg: '#e1ebff', color: BLUE_COLOR },
    import: { border: '#f1d2ad', bg: '#fff5ea', iconBg: '#ffe5c8', color: '#c8752f' },
  }[tone]

  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      sx={{
        border: `1px solid ${tones.border}`,
        bgcolor: tones.bg,
        borderRadius: '8px',
        minHeight: 72,
        p: 1.2,
        display: 'grid',
        gridTemplateColumns: '42px minmax(0, 1fr)',
        gap: 1,
        alignItems: 'center',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <Box sx={{ width: 42, height: 42, borderRadius: '8px', bgcolor: tones.iconBg, color: tones.color, display: 'grid', placeItems: 'center' }}>
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ ...itemTitleSx, color: tones.color }}>{title}</Typography>
        <Typography sx={{ ...helperTextSx, color: MUTED_COLOR, mt: 0.2 }}>{description}</Typography>
      </Box>
    </Box>
  )
}

function Waveform({
  active,
  level = 0,
  size = 'compact',
}: {
  active: boolean
  level?: number
  size?: 'compact' | 'inline' | 'hero'
}) {
  const normalizedLevel = active ? Math.max(0, Math.min(1, level)) : 0
  const visualLevel = active ? Math.min(1, Math.sqrt(normalizedLevel) * 1.12) : 0
  const dimensions = {
    compact: { height: 24, width: 5, gap: '4px', min: 6, max: 24, radius: 999 },
    inline: { height: 22, width: 4, gap: '3px', min: 5, max: 20, radius: 999 },
    hero: { height: 34, width: 6, gap: '5px', min: 8, max: 34, radius: 999 },
  }[size]

  return (
    <Box
      aria-hidden
      sx={{
        display: 'flex',
        alignItems: 'end',
        justifyContent: 'center',
        gap: dimensions.gap,
        height: dimensions.height,
        minWidth: size === 'inline' ? 58 : 78,
        mt: size === 'compact' ? 0.35 : 0,
      }}
    >
      {WAVEFORM_BAR_SHAPE.map((shape, index) => {
        const idleLift = active ? 0.08 + (index % 2) * 0.02 : 0
        const barLevel = Math.min(1, Math.max(0, idleLift + visualLevel * shape))
        const height = Math.round(dimensions.min + (dimensions.max - dimensions.min) * barLevel)
        const opacity = active ? 0.36 + barLevel * 0.62 : 0.26
        const glow = active ? 2 + barLevel * 9 : 0

        return (
        <Box
          key={index}
          sx={{
            width: dimensions.width,
            height,
            borderRadius: dimensions.radius,
            background: active
              ? 'linear-gradient(180deg, #7ea6ff 0%, #4b7ff7 54%, #876cff 100%)'
              : 'linear-gradient(180deg, rgba(92,132,242,0.36), rgba(92,132,242,0.18))',
            opacity,
            boxShadow: active ? `0 0 ${glow}px rgba(69, 120, 246, ${0.12 + barLevel * 0.22})` : 'none',
            transform: active ? `translateY(${-Math.round(barLevel * 2)}px)` : 'translateY(0)',
            transition: 'height 120ms ease-out, opacity 160ms ease-out, transform 160ms ease-out, box-shadow 180ms ease-out',
          }}
        />
        )
      })}
    </Box>
  )
}

function AudioSourceSelect({
  value,
  onChange,
}: {
  value: MeetingAudioSource
  onChange: (value: MeetingAudioSource) => void
}) {
  const { t } = useI18n()
  return (
    <Select size="small" value={value} onChange={(event) => onChange(String(event.target.value) as MeetingAudioSource)} sx={selectSx}>
      <MenuItem value="microphone">{t('meeting.microphone')}</MenuItem>
      <MenuItem value="system">{t('meeting.systemAudio')}</MenuItem>
      <MenuItem value="microphone_system">{t('meeting.micAndSystem')}</MenuItem>
    </Select>
  )
}

function TargetLanguageSelect({
  value,
  onChange,
  languages,
}: {
  value: MeetingTranslationTarget
  onChange: (value: MeetingTranslationTarget) => void
  languages: TranslationTargetLanguageConfig[]
}) {
  const { t } = useI18n()
  return (
    <Select size="small" value={value} onChange={(event) => onChange(String(event.target.value) as MeetingTranslationTarget)} sx={{ ...selectSx, minWidth: 112 }}>
      <MenuItem value="off">{t('meeting.off')}</MenuItem>
      {languages.map((language) => (
        <MenuItem key={language.id} value={language.id}>{language.label}</MenuItem>
      ))}
    </Select>
  )
}

function RecorderControls({
  active,
  paused,
  elapsedMs,
  inputLevel = 0,
  transcriptPanelVisible = true,
  onToggleTranscriptPanel,
  onTogglePause,
  onEnd,
}: {
  active: boolean
  paused: boolean
  elapsedMs: number
  inputLevel?: number
  transcriptPanelVisible?: boolean
  onToggleTranscriptPanel?: () => void
  onTogglePause: () => void
  onEnd: () => void
}) {
  const { t } = useI18n()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.05, flexWrap: 'wrap' }}>
      <IconButton
        onClick={onToggleTranscriptPanel}
        aria-label={transcriptPanelVisible ? t('meeting.hideTranscriptionPanel') : t('meeting.showTranscriptionPanel')}
        sx={{ width: 50, height: 50, bgcolor: '#202124', color: '#fff', opacity: transcriptPanelVisible ? 1 : 0.72, '&:hover': { bgcolor: '#202124' } }}
      >
        <DescriptionOutlinedIcon sx={{ fontSize: 23 }} />
      </IconButton>
      <Button
        variant="outlined"
        onClick={onTogglePause}
        sx={{
          width: 86,
          height: 42,
          borderRadius: 999,
          bgcolor: '#fff',
          border: '2px solid #eef0f4',
          color: TEXT_COLOR,
          boxShadow: '0 16px 34px rgba(17,17,17,0.06)',
        }}
      >
        {paused ? <PlayArrowIcon sx={{ fontSize: 26 }} /> : <PauseIcon sx={{ fontSize: 24 }} />}
      </Button>
      <Box sx={{ minWidth: 68, textAlign: 'center' }}>
        <Typography sx={{ ...itemTitleSx, fontSize: 14, color: paused ? '#9aa1ad' : BLUE_COLOR, lineHeight: 1 }}>{formatElapsed(elapsedMs)}</Typography>
        <Waveform active={active && !paused} level={inputLevel} />
      </Box>
      <Button
        onClick={onEnd}
        sx={{
          height: 42,
          minWidth: 94,
          px: 2.1,
          borderRadius: 999,
          bgcolor: DANGER_COLOR,
          color: '#fff',
          ...itemTitleSx,
          fontSize: 14,
          '&:hover': { bgcolor: DANGER_COLOR },
        }}
      >
        {t('meeting.end')}
      </Button>
    </Box>
  )
}

function LiveToolbarButton({
  icon,
  label,
  active = false,
  danger = false,
  onClick,
}: {
  icon: ReactNode
  label: string
  active?: boolean
  danger?: boolean
  onClick?: () => void
}) {
  return (
    <Button
      onClick={onClick}
      sx={{
        minWidth: 88,
        height: 64,
        borderRadius: '8px',
        color: danger ? '#ef9a9a' : active ? BLUE_COLOR : '#565d68',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.3,
        ...bodyTextSx,
        fontSize: 13,
        fontWeight: active || danger ? 600 : 500,
        '&:hover': { bgcolor: '#f7f8fb' },
      }}
    >
      <Box sx={{ height: 26, display: 'grid', placeItems: 'center' }}>{icon}</Box>
      <Box component="span">{label}</Box>
    </Button>
  )
}

export default function MeetingNotes({
  autoStartRequest = null,
  onAutoStartConsumed = () => undefined,
}: MeetingNotesProps) {
  const { language, t } = useI18n()
  const [view, setView] = useState<MeetingView>('list')
  const [notes, setNotes] = useState<MeetingNote[]>([])
  const [query, setQuery] = useState('')
  const [activeNote, setActiveNote] = useState<Partial<MeetingNote> | null>(null)
  const [recordingKind, setRecordingKind] = useState<RecordingKind>('note')
  const [detailTab, setDetailTab] = useState<DetailTab>('note')
  const [audioSource, setAudioSource] = useState<MeetingAudioSource>('microphone')
  const [targetLanguage, setTargetLanguage] = useState<MeetingTranslationTarget>('off')
  const [liveAudioSource, setLiveAudioSource] = useState<MeetingAudioSource>('microphone')
  const [liveTargetLanguage, setLiveTargetLanguage] = useState<MeetingTranslationTarget>('off')
  const [showOriginal, setShowOriginal] = useState(true)
  const [showTranslation, setShowTranslation] = useState(true)
  const [showTranscriptPanel, setShowTranscriptPanel] = useState(true)
  const [liveSettingsOpen, setLiveSettingsOpen] = useState(false)
  const [voiceSession, setVoiceSession] = useState(getVoiceSession())
  const [elapsedMs, setElapsedMs] = useState(0)
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false)
  const [subtitlesOpen, setSubtitlesOpen] = useState(false)
  const [menuNoteId, setMenuNoteId] = useState('')
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [importItem, setImportItem] = useState<ImportItem | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const fileInputModeRef = useRef<FileInputMode>('import')
  const activeNoteRef = useRef<Partial<MeetingNote> | null>(activeNote)
  const viewRef = useRef<MeetingView>(view)
  const consumedAutoStartRequestRef = useRef('')

  const refreshNotes = useCallback(() => {
    listMeetingNotes().then(setNotes).catch(() => setNotes([]))
  }, [])

  const loadLivePreferences = useCallback(async () => {
    const settings = await loadSettings()
    setLiveAudioSource(settings.meetingLiveAudioSource as MeetingAudioSource)
    setLiveTargetLanguage(settings.meetingLiveTargetLanguage as MeetingTranslationTarget)
  }, [])

  const persistLivePreferences = useCallback(async (patch: Partial<{
    meetingLiveAudioSource: MeetingAudioSource
    meetingLiveTargetLanguage: MeetingTranslationTarget
  }>) => {
    const settings = await loadSettings()
    await saveSettings({
      ...settings,
      ...patch,
    })
  }, [])

  const isMeetingVoiceActive = voiceSession.mode === 'MeetingNotes' && ['connecting', 'recording', 'stopping', 'transcribing'].includes(voiceSession.status)
  const isPaused = Boolean(voiceSession.paused)
  const visibleNotes = useMemo(() => notes.filter((note) => noteMatches(note, query)), [notes, query])
  const activeTitle = activeNote?.title?.trim() || (recordingKind === 'live' ? t('meeting.liveNote') : t('meeting.newNote'))
  const activeTranscript = activeNote?.transcript || voiceSession.rawText || ''
  const activeTranslation = activeNote?.translationText || voiceSession.translationText || ''
  const liveSegments = voiceSession.mode === 'MeetingNotes' ? voiceSession.meetingLiveSegments || [] : []
  const activeStructuredResult = activeNote?.structuredResult || null
  const summaryLines = splitUsefulLines(activeNote?.summary || '')
  const structuredSummaryLines = splitUsefulLines(activeStructuredResult?.summary || activeNote?.summary || '')
  const structuredDecisionLines = structuredItemTexts(activeStructuredResult?.decisions)
  const structuredActionLines = structuredItemTexts(activeStructuredResult?.actionItems)
  const structuredScheduleLines = structuredItemTexts(activeStructuredResult?.scheduleItems)
  const structuredRiskLines = structuredItemTexts(activeStructuredResult?.risks)
  const structuredQuestionLines = structuredItemTexts(activeStructuredResult?.questions)
  const structuredFollowUpLines = structuredItemTexts(activeStructuredResult?.followUps)
  const structuredTopicLines = structuredTopicTexts(activeStructuredResult?.topics)
  const transcriptSegments = getTranscriptSegments(activeStructuredResult?.transcriptSegments)
  const actionLines = structuredActionLines.length
    ? structuredActionLines
    : summaryLines.filter((line) => /行动|待办|action|todo|负责|deadline|截止/i.test(line))

  const weakMeetingTitleHints = useMemo(() => [
    t('meeting.newNote'),
    t('meeting.liveNote'),
    t('meeting.titlePlaceholder'),
    t('meeting.title'),
  ], [t])

  const meetingFallbackTitle = useCallback((note: Partial<MeetingNote>) => {
    const timestamp = note.updatedAt || note.createdAt || new Date().toISOString()
    const formatted = formatNoteDate(timestamp, language, t('meeting.today'))
    return `${t('meeting.title')} ${formatted}`.trim()
  }, [language, t])

  const getGeneratedMeetingTitle = useCallback((note: Partial<MeetingNote>, extraWeakTitleHints: string[] = []) => {
    return generateMeetingNoteTitle(note, {
      weakTitleHints: [...weakMeetingTitleHints, ...extraWeakTitleHints],
      fallbackTitle: meetingFallbackTitle(note),
    })
  }, [meetingFallbackTitle, weakMeetingTitleHints])

  const withGeneratedMeetingTitle = useCallback((note: Partial<MeetingNote>, extraWeakTitleHints: string[] = []) => {
    const title = getGeneratedMeetingTitle(note, extraWeakTitleHints)
    return title && title !== note.title ? { ...note, title } : note
  }, [getGeneratedMeetingTitle])

  const openLiveSetup = useCallback(() => {
    if (isMeetingVoiceActive) {
      setExitConfirmOpen(true)
      return
    }
    setMessage('')
    setView('liveSetup')
    void loadLivePreferences()
  }, [isMeetingVoiceActive, loadLivePreferences])

  const sendSubtitleUpdate = useCallback((payload: Partial<MeetingNote> = {}) => {
    ipcClient.send('meeting-subtitles:update', {
      visible: subtitlesOpen,
      statusText: isPaused ? t('meeting.paused') : t('meeting.listening'),
      originalText: payload.transcript ?? activeTranscript,
      translationText: payload.translationText ?? activeTranslation,
      showOriginal,
      showTranslation,
    })
  }, [activeTranscript, activeTranslation, isPaused, showOriginal, showTranslation, subtitlesOpen, t])

  useEffect(() => {
    refreshNotes()
    return subscribeMeetingNoteChanges(() => refreshNotes())
  }, [refreshNotes])

  useEffect(() => {
    activeNoteRef.current = activeNote
  }, [activeNote])

  useEffect(() => {
    viewRef.current = view
  }, [view])

  useEffect(() => {
    if (!isMeetingVoiceActive || isPaused) return
    const timer = window.setInterval(() => setElapsedMs((current) => current + 1000), 1000)
    return () => window.clearInterval(timer)
  }, [isMeetingVoiceActive, isPaused])

  useEffect(() => {
    return subscribeVoiceSession((session) => {
      setVoiceSession(session)
      if (session.mode !== 'MeetingNotes') return
      const note = activeNoteRef.current
      if (!note) return

      if (['connecting', 'recording'].includes(session.status)) {
        const nextNote = { ...note, status: 'recording' as const, transcript: session.rawText, translationText: session.translationText }
        activeNoteRef.current = nextNote
        setActiveNote(nextNote)
        sendSubtitleUpdate(nextNote)
        return
      }

      if (['stopping', 'transcribing'].includes(session.status)) {
        const nextNote = { ...note, status: 'processing' as const, transcript: session.rawText, translationText: session.translationText }
        activeNoteRef.current = nextNote
        setActiveNote(nextNote)
        sendSubtitleUpdate(nextNote)
        return
      }

      if (session.status === 'completed') {
        const nextNote = withGeneratedMeetingTitle({
          ...note,
          source: 'recording' as const,
          status: 'completed' as const,
          transcript: session.rawText,
          translationText: session.translationText,
          summary: session.refinedText,
          structuredResult: session.meetingStructuredResult || note.structuredResult || null,
          durationMs: session.durationMs || elapsedMs,
        })
        activeNoteRef.current = nextNote
        setActiveNote(nextNote)
        sendSubtitleUpdate(nextNote)
        void saveMeetingNote(nextNote).then((saved) => {
          if (saved) {
            activeNoteRef.current = saved
            setActiveNote(saved)
          }
          refreshNotes()
          if (viewRef.current === 'processing' || viewRef.current === 'recording') {
            setDetailTab('note')
            setView('detail')
          }
        })
        return
      }

      if (session.status === 'error') {
        const nextNote = withGeneratedMeetingTitle({
          ...note,
          source: 'recording' as const,
          status: 'error' as const,
          transcript: session.rawText,
          translationText: session.translationText,
          summary: session.refinedText,
          structuredResult: session.meetingStructuredResult || note.structuredResult || null,
          error: session.error?.message || session.error?.detail || '',
          durationMs: session.durationMs || elapsedMs,
        })
        activeNoteRef.current = nextNote
        setActiveNote(nextNote)
        void saveMeetingNote(nextNote).then((saved) => {
          if (saved) setActiveNote(saved)
          refreshNotes()
          setView('detail')
        })
      }
    })
  }, [elapsedMs, refreshNotes, sendSubtitleUpdate, withGeneratedMeetingTitle])

  useEffect(() => {
    if (subtitlesOpen) sendSubtitleUpdate()
  }, [sendSubtitleUpdate, subtitlesOpen])

  const startRecordingFlow = async (kind: RecordingKind, options: RecordingStartOptions = {}) => {
    if (isMeetingVoiceActive) {
      setExitConfirmOpen(true)
      return
    }
    setMessage('')
    setElapsedMs(0)
    setShowTranscriptPanel(true)
    setLiveSettingsOpen(false)
    const nextAudioSource = options.audioSource ?? audioSource
    const nextTarget: MeetingTranslationTarget = options.targetLanguage ?? (kind === 'live' ? liveTargetLanguage : 'off')
    const draft = {
      ...createDraftMeetingNote(),
      title: options.title || (kind === 'live' ? t('meeting.liveNote') : t('meeting.newNote')),
      source: 'recording' as const,
      status: 'recording' as const,
      audioSource: nextAudioSource,
      targetLanguage: nextTarget,
      showOriginal,
      showTranslation,
    }
    const saved = await saveMeetingNote(draft)
    if (!saved) return
    activeNoteRef.current = saved
    setActiveNote(saved)
    setRecordingKind(kind)
    setAudioSource(nextAudioSource)
    setTargetLanguage(nextTarget)
    setView('recording')
    try {
      await toggleMeetingNotesRecording({
        audioSource: nextAudioSource,
        targetLanguage: nextTarget,
        showOriginal,
        showTranslation,
        module: kind === 'live' ? 'live_translation' : 'new_note',
      })
    } catch (error) {
      activeNoteRef.current = null
      setActiveNote(null)
      await deleteMeetingNote(saved.id)
      setView('list')
      setMessage(error instanceof Error ? error.message : String(error || t('meeting.importFailed')))
      refreshNotes()
    }
  }

  const handleLiveSetupAudioSourceChange = (value: MeetingAudioSource) => {
    setLiveAudioSource(value)
    void persistLivePreferences({ meetingLiveAudioSource: value })
  }

  const handleLiveSetupTargetLanguageChange = (value: MeetingTranslationTarget) => {
    setLiveTargetLanguage(value)
    void persistLivePreferences({ meetingLiveTargetLanguage: value })
  }

  const startLiveTranslationFlow = async () => {
    await persistLivePreferences({
      meetingLiveAudioSource: liveAudioSource,
      meetingLiveTargetLanguage: liveTargetLanguage,
    })
    await startRecordingFlow('live', {
      audioSource: liveAudioSource,
      targetLanguage: liveTargetLanguage,
      title: t('meeting.liveNote'),
    })
  }

  const handleRecordingAudioSourceChange = (value: MeetingAudioSource) => {
    setAudioSource(value)
    setActiveNote((current) => current ? { ...current, audioSource: value } : current)
    if (recordingKind === 'live') {
      setLiveAudioSource(value)
      void persistLivePreferences({ meetingLiveAudioSource: value })
    }
    if (isMeetingVoiceActive) setMessage(t('meeting.audioSourceNextRun'))
  }

  const handleNoteRecordingTargetLanguageChange = (value: MeetingTranslationTarget) => {
    setTargetLanguage(value)
    setActiveNote((current) => current ? { ...current, targetLanguage: value } : current)
    updateMeetingNotesRecordingOptions({
      audioSource,
      targetLanguage: value,
      showOriginal,
      showTranslation,
      module: recordingKind === 'live' ? 'live_translation' : 'new_note',
    })
  }

  const handleLiveRecordingTargetLanguageChange = (value: MeetingTranslationTarget) => {
    setTargetLanguage(value)
    setLiveTargetLanguage(value)
    setActiveNote((current) => current ? { ...current, targetLanguage: value } : current)
    void persistLivePreferences({ meetingLiveTargetLanguage: value })
    updateMeetingNotesRecordingOptions({
      audioSource,
      targetLanguage: value,
      showOriginal,
      showTranslation,
      module: 'live_translation',
    })
  }

  const handleShowOriginalChange = (value: boolean) => {
    setShowOriginal(value)
    setActiveNote((current) => current ? { ...current, showOriginal: value } : current)
    updateMeetingNotesRecordingOptions({
      audioSource,
      targetLanguage,
      showOriginal: value,
      showTranslation,
      module: recordingKind === 'live' ? 'live_translation' : 'new_note',
    })
  }

  const handleShowTranslationChange = (value: boolean) => {
    setShowTranslation(value)
    setActiveNote((current) => current ? { ...current, showTranslation: value } : current)
    updateMeetingNotesRecordingOptions({
      audioSource,
      targetLanguage,
      showOriginal,
      showTranslation: value,
      module: recordingKind === 'live' ? 'live_translation' : 'new_note',
    })
  }

  useEffect(() => {
    const requestId = autoStartRequest?.requestId || ''
    if (!requestId || consumedAutoStartRequestRef.current === requestId) return
    consumedAutoStartRequestRef.current = requestId
    onAutoStartConsumed(requestId)

    if (isMeetingVoiceActive) {
      setExitConfirmOpen(true)
      return
    }

    const detectedAppName = autoStartRequest?.appName?.trim() || ''
    const title = detectedAppName ? `${detectedAppName} ${t('meeting.newNote')}` : t('meeting.newNote')
    void startRecordingFlow('note', {
      audioSource: autoStartRequest?.audioSource || 'microphone_system',
      targetLanguage: autoStartRequest?.targetLanguage || 'off',
      title,
    })
  }, [autoStartRequest, isMeetingVoiceActive, onAutoStartConsumed, t])

  const handleEndRecording = async () => {
    if (isMeetingVoiceActive) {
      setView('processing')
      await toggleMeetingNotesRecording()
      setActiveNote((current) => current ? { ...current, status: 'processing' } : current)
      return
    }
    setView('detail')
  }

  const handleTogglePause = () => {
    if (voiceSession.status === 'recording') setRecordingPaused(!isPaused)
  }

  const handleBack = async () => {
    if (isMeetingVoiceActive) {
      setExitConfirmOpen(true)
      return
    }
    if (activeNote) await saveMeetingNote(activeNote)
    setView('list')
    refreshNotes()
  }

  const discardRecording = async () => {
    cancelRecording()
    const id = activeNoteRef.current?.id
    if (id) await deleteMeetingNote(id)
    setExitConfirmOpen(false)
    setActiveNote(null)
    activeNoteRef.current = null
    setSubtitlesOpen(false)
    await ipcClient.invoke('meeting-subtitles:hide').catch(() => undefined)
    refreshNotes()
    setView('list')
  }

  const openSubtitles = async () => {
    setSubtitlesOpen(true)
    await ipcClient.invoke('meeting-subtitles:show', {
      statusText: isPaused ? t('meeting.paused') : t('meeting.listening'),
      originalText: activeTranscript,
      translationText: activeTranslation,
      showOriginal,
      showTranslation,
    }).catch(() => undefined)
  }

  const handleDeleteNote = async (id: string) => {
    setMenuAnchor(null)
    setMenuNoteId('')
    await deleteMeetingNote(id)
    if (activeNote?.id === id) {
      setActiveNote(null)
      setView('list')
    }
    refreshNotes()
  }

  const requestFile = (mode: FileInputMode) => {
    fileInputModeRef.current = mode
    fileInputRef.current?.click()
  }

  const handleImportFile = async (file: File, mode: FileInputMode) => {
    setMessage('')
    setBusy(true)
    setView(mode === 'import' ? 'import' : view)
    setImportItem({ name: file.name, size: file.size, status: 'uploaded' })

    try {
      const saved = await saveMeetingNote({
        ...(mode === 'note' ? activeNote : createDraftMeetingNote()),
        title: mode === 'note' ? activeTitle : file.name,
        source: 'import',
        status: 'processing',
        importFile: { name: file.name, size: file.size, type: file.type },
      })
      if (saved) setActiveNote(saved)

      setImportItem({ name: file.name, size: file.size, status: 'processing' })
      const result = await importMeetingMediaFile(file)
      const hasUsableTranscript = Boolean(result.transcript.trim())
      const isUsableResult = result.success || hasUsableTranscript
      const errorText = result.partialSuccess ? t('meeting.importSummaryFailed') : (result.success ? '' : importErrorText(result.detail, t))
      const nextNote = withGeneratedMeetingTitle({
        ...(saved || activeNote || createDraftMeetingNote()),
        title: saved?.title || file.name,
        source: 'import' as const,
        status: isUsableResult ? 'completed' as const : 'error' as const,
        transcript: result.transcript,
        translationText: result.translationText,
        summary: result.summary,
        structuredResult: result.structuredResult,
        error: errorText,
        importFile: { name: file.name, size: file.size, type: file.type },
      }, [file.name])
      const finalNote = await saveMeetingNote(nextNote)
      if (finalNote) setActiveNote(finalNote)
      setImportItem({ name: file.name, size: file.size, status: isUsableResult ? 'completed' : 'error', error: errorText })
      setMessage(errorText)
      refreshNotes()
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error || t('meeting.importFailed'))
      setImportItem({ name: file.name, size: file.size, status: 'error', error: errorText })
      setMessage(errorText)
    } finally {
      setBusy(false)
    }
  }

  const renderHiddenFileInput = () => (
    <input
      ref={fileInputRef}
      hidden
      type="file"
      accept=".m4a,.mp3,.mp4,.wav,.ogg,.flac,.mov,.avi,.mkv,.webm,.opus,audio/*,video/*"
      onChange={(event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file) void handleImportFile(file, fileInputModeRef.current)
      }}
    />
  )

  const renderListView = () => (
    <Box sx={{ ...pageFrameSx, display: 'flex', flexDirection: 'column', gap: 1.8 }}>
      {renderHiddenFileInput()}
      <Box>
        <Typography sx={pageTitleSx}>{t('meeting.title')}</Typography>
        <Typography sx={{ ...pageDescriptionSx, mt: 0.6, color: MUTED_COLOR }}>{t('meeting.subtitle')}</Typography>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' }, gap: 1.25 }}>
        <EntryCard tone="new" icon={<AddIcon />} title={t('meeting.newNote')} description={t('meeting.newNoteHint')} onClick={() => void startRecordingFlow('note')} />
        <EntryCard tone="live" icon={<GraphicEqIcon />} title={t('meeting.liveNote')} description={t('meeting.liveNoteHint')} onClick={openLiveSetup} />
        <EntryCard tone="import" icon={<FileUploadOutlinedIcon />} title={t('meeting.importFile')} description={t('meeting.importFileHint')} onClick={() => setView('import')} />
      </Box>

      <Box sx={{ height: 50, border: `1px solid ${BORDER_COLOR}`, bgcolor: '#fafafa', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: 1, px: 1.6 }}>
        <SearchIcon sx={{ color: '#c7c9ce', fontSize: 20 }} />
        <InputBase value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('meeting.searchPlaceholder')} sx={{ flex: 1, ...bodyTextSx }} />
      </Box>

      <Box>
        <Typography sx={{ ...sectionTitleSx, color: '#788391', mb: 1 }}>{t('meeting.notesSection')}</Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {visibleNotes.length ? visibleNotes.map((note) => (
            <Box
              key={note.id}
              component="button"
              type="button"
              onClick={() => {
                const generatedTitle = getGeneratedMeetingTitle(note)
                const nextNote = generatedTitle && generatedTitle !== note.title ? { ...note, title: generatedTitle } : note
                setActiveNote(nextNote)
                if (nextNote !== note) void saveMeetingNote(nextNote).then(refreshNotes)
                setDetailTab('note')
                setView('detail')
              }}
              sx={{
                width: '100%',
                border: 0,
                bgcolor: '#fff',
                borderRadius: '8px',
                p: 1.25,
                minHeight: 72,
                display: 'grid',
                gridTemplateColumns: '48px minmax(0, 1fr) auto',
                alignItems: 'center',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <Box sx={{ width: 40, height: 40, borderRadius: '8px', bgcolor: '#f1f6ff', color: BLUE_COLOR, display: 'grid', placeItems: 'center' }}>
                <DescriptionOutlinedIcon sx={{ fontSize: 22 }} />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ ...itemTitleSx, color: BLUE_COLOR, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {getGeneratedMeetingTitle(note) || note.title || t('meeting.newNote')}
                </Typography>
                <Typography sx={{ ...helperTextSx, color: MUTED_COLOR, mt: 0.25 }}>
                  {formatNoteDate(note.updatedAt, language, t('meeting.today'))}
                </Typography>
              </Box>
              <IconButton
                aria-label={t('meeting.menuLabel')}
                onClick={(event) => {
                  event.stopPropagation()
                  setMenuNoteId(note.id)
                  setMenuAnchor(event.currentTarget)
                }}
                sx={{ width: 38, height: 38, bgcolor: '#f2f2f2' }}
              >
                <MoreHorizIcon />
              </IconButton>
            </Box>
          )) : (
            <Box sx={{ p: 3, textAlign: 'center', color: MUTED_COLOR, ...bodyTextSx }}>{t('meeting.empty')}</Box>
          )}
        </Box>
      </Box>
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem onClick={() => void handleDeleteNote(menuNoteId)} sx={{ color: DANGER_COLOR, minWidth: 220, gap: 1 }}>
          <DeleteIcon sx={{ fontSize: 18 }} />
          {t('meeting.delete')}
        </MenuItem>
      </Menu>
    </Box>
  )

  const renderNoteTranscriptionPanel = () => (
    <Box sx={{ width: 'min(760px, calc(100% - 48px))', minHeight: 138, bgcolor: '#f1f1f2', borderRadius: '14px', p: 1.6, alignSelf: 'center', mb: 1.8 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.2, mb: 1.2 }}>
        <Typography sx={{ ...sectionTitleSx, fontSize: 15, color: TEXT_COLOR }}>{t('meeting.transcriptionPanel')}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
          <AudioSourceSelect value={audioSource} onChange={handleRecordingAudioSourceChange} />
          <TargetLanguageSelect value={targetLanguage} onChange={handleNoteRecordingTargetLanguageChange} languages={MEETING_NOTE_TARGET_LANGUAGES} />
          <IconButton onClick={() => void openSubtitles()} aria-label={t('meeting.openSubtitles')} sx={{ width: 32, height: 32 }}>
            <KeyboardIcon sx={{ fontSize: 20 }} />
          </IconButton>
        </Box>
      </Box>
      <Box sx={{ minHeight: 76, display: 'grid', placeItems: 'center', color: '#8d96a3', ...bodyTextSx, fontSize: 13, textAlign: 'center', px: 2 }}>
        {activeTranscript || t('meeting.transcriptionPlaceholder')}
        {showTranslation && activeTranslation ? <Typography sx={{ ...bodyTextSx, color: BLUE_COLOR, mt: 0.8, fontSize: 13 }}>{activeTranslation}</Typography> : null}
      </Box>
    </Box>
  )

  const renderLiveSettingsSheet = () => {
    if (!liveSettingsOpen) return null

    return (
      <Box sx={{ position: 'absolute', inset: 0, zIndex: 10, bgcolor: 'rgba(32,33,36,0.36)', display: 'flex', alignItems: 'flex-end' }}>
        <Box sx={{ width: '100%', bgcolor: '#fff', borderRadius: '22px 22px 0 0', boxShadow: '0 -18px 44px rgba(0,0,0,0.14)', px: { xs: 2, md: 3 }, pt: 1.2, pb: 2.6, position: 'relative' }}>
          <Box sx={{ width: 54, height: 5, borderRadius: 999, bgcolor: '#dedede', marginLeft: 'auto', marginRight: 'auto', mb: 1.6 }} />
          <IconButton onClick={() => setLiveSettingsOpen(false)} aria-label={t('meeting.close')} sx={{ position: 'absolute', right: 20, top: 20, width: 32, height: 32 }}>
            <CloseIcon sx={{ fontSize: 20 }} />
          </IconButton>
          <Box sx={{ maxWidth: 980, marginLeft: 'auto', marginRight: 'auto', display: 'flex', flexDirection: 'column', gap: 1.15 }}>
            <Typography sx={{ ...helperTextSx, color: MUTED_COLOR, fontWeight: 700 }}>{t('meeting.displayOriginal')}</Typography>
            <Box sx={{ minHeight: 54, borderRadius: '12px', bgcolor: '#f7f7f8', display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.6 }}>
              <Typography sx={{ ...bodyTextSx, color: TEXT_COLOR }}>{t('meeting.showOriginal')}</Typography>
              <Switch checked={showOriginal} onChange={(event) => handleShowOriginalChange(event.target.checked)} />
            </Box>
            <Typography sx={{ ...helperTextSx, color: MUTED_COLOR, fontWeight: 700 }}>{t('meeting.displayTranslation')}</Typography>
            <Box sx={{ minHeight: 54, borderRadius: '12px', bgcolor: '#f7f7f8', display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.6 }}>
              <Typography sx={{ ...bodyTextSx, color: TEXT_COLOR }}>{t('meeting.showAiTranslation')}</Typography>
              <Switch checked={showTranslation} onChange={(event) => handleShowTranslationChange(event.target.checked)} />
            </Box>
            <Typography sx={{ ...helperTextSx, color: MUTED_COLOR, fontWeight: 700 }}>{t('meeting.aiTranslationSettings')}</Typography>
            <Box sx={{ borderRadius: '12px', bgcolor: '#f7f7f8', overflow: 'hidden' }}>
              <Box sx={{ minHeight: 58, display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.6, borderBottom: `1px solid ${BORDER_COLOR}` }}>
                <Typography sx={{ ...bodyTextSx, color: TEXT_COLOR }}>{t('meeting.audioSource')}</Typography>
                <AudioSourceSelect value={audioSource} onChange={handleRecordingAudioSourceChange} />
              </Box>
              <Box sx={{ minHeight: 58, display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.6 }}>
                <Typography sx={{ ...bodyTextSx, color: TEXT_COLOR }}>{t('meeting.targetLanguage')}</Typography>
                <TargetLanguageSelect value={targetLanguage} onChange={handleLiveRecordingTargetLanguageChange} languages={MEETING_LIVE_TARGET_LANGUAGES} />
              </Box>
            </Box>
          </Box>
        </Box>
      </Box>
    )
  }

  const renderLiveSetupView = () => (
    <Box sx={{ minHeight: '100%', height: '100%', bgcolor: 'rgba(32,33,36,0.52)', display: 'grid', placeItems: 'center', p: 2 }}>
      <Box sx={{ width: 'min(520px, 88vw)', bgcolor: '#fff', borderRadius: '20px', boxShadow: '0 24px 60px rgba(0,0,0,0.22)', overflow: 'hidden' }}>
        <Box sx={{ height: 58, display: 'grid', placeItems: 'center', borderBottom: `1px solid ${BORDER_COLOR}` }}>
          <Typography sx={{ fontSize: 18, lineHeight: 1.2, fontWeight: 700, color: TEXT_COLOR, letterSpacing: 0 }}>{t('meeting.liveSetupTitle')}</Typography>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', minHeight: 64, px: 3, borderBottom: `1px solid ${BORDER_COLOR}` }}>
          <Typography sx={{ ...bodyTextSx, fontWeight: 700, color: TEXT_COLOR, letterSpacing: 0 }}>{t('meeting.audioSource')}</Typography>
          <AudioSourceSelect value={liveAudioSource} onChange={handleLiveSetupAudioSourceChange} />
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', minHeight: 64, px: 3, borderBottom: `1px solid ${BORDER_COLOR}` }}>
          <Typography sx={{ ...bodyTextSx, fontWeight: 700, color: TEXT_COLOR, letterSpacing: 0 }}>{t('meeting.targetLanguage')}</Typography>
          <TargetLanguageSelect value={liveTargetLanguage} onChange={handleLiveSetupTargetLanguageChange} languages={MEETING_LIVE_TARGET_LANGUAGES} />
        </Box>
        <Box sx={{ px: 3, pt: 2.2, pb: 2.6, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.4 }}>
          <Button
            onClick={() => void startLiveTranslationFlow()}
            sx={{ width: '100%', height: 52, borderRadius: '12px', bgcolor: BLUE_COLOR, color: '#fff', fontSize: 16, fontWeight: 700, '&:hover': { bgcolor: BLUE_COLOR } }}
          >
            {t('meeting.start')}
          </Button>
          <Button onClick={() => setView('list')} sx={{ color: '#8d949e', fontSize: 14, fontWeight: 700 }}>{t('meeting.back')}</Button>
        </Box>
      </Box>
    </Box>
  )

  const renderLiveRecordingView = () => {
    const originalLines = splitLiveText(activeTranscript)
    const translationLines = splitLiveText(activeTranslation)
    const waveformActive = voiceSession.status === 'recording' && !isPaused
    const waveformLevel = waveformActive ? voiceSession.inputLevel : 0
    const liveRows = liveSegments.length
      ? liveSegments
      : originalLines.map((line, index) => ({
        id: `raw-${index}`,
        sourceText: line,
        translationText: translationLines[index] || '',
        targetLanguage: targetLanguage === 'off' ? 'off' : targetLanguage,
        chunkIndex: index,
        createdAt: new Date().toISOString(),
        status: 'translated' as const,
        normalizedSourceText: line,
      }))
    const hasLiveContent = liveRows.some((row) => row.sourceText || row.translationText)
    const statusMessage = message || voiceSession.noticeText || getAudioSourceToast(audioSource, t)

    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: '#fff', color: TEXT_COLOR, overflow: 'hidden', position: 'relative' }}>
        <Box sx={{ height: 58, px: 2.1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${BORDER_COLOR}`, gap: 1.4 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.4, minWidth: 0 }}>
            <IconButton onClick={() => void handleBack()} aria-label={t('meeting.back')} sx={{ width: 34, height: 34 }}>
              <ArrowBackIosNewIcon sx={{ fontSize: 18 }} />
            </IconButton>
            <Typography sx={{ ...bodyTextSx, fontSize: 13, color: '#8a93a1', whiteSpace: 'nowrap' }}>{t('meeting.title')} /</Typography>
            <Typography sx={{ ...sectionTitleSx, fontSize: 15, color: TEXT_COLOR, whiteSpace: 'nowrap' }}>{t('meeting.liveNote')}</Typography>
            <Box sx={{ height: 26, px: 1, borderRadius: 999, bgcolor: '#eaf8ef', color: '#2b9b61', display: 'flex', alignItems: 'center', gap: 0.55, ...helperTextSx, fontSize: 12, fontWeight: 700 }}>
              <Box sx={{ width: 7, height: 7, borderRadius: 999, bgcolor: '#49bf73' }} />
              {t('meeting.realtime')}
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AudioSourceSelect value={audioSource} onChange={handleRecordingAudioSourceChange} />
            <TargetLanguageSelect value={targetLanguage} onChange={handleLiveRecordingTargetLanguageChange} languages={MEETING_LIVE_TARGET_LANGUAGES} />
          </Box>
        </Box>

        <Box sx={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', alignItems: hasLiveContent ? 'stretch' : 'center', justifyContent: 'center', px: { xs: 2, md: 3.6 }, py: hasLiveContent ? 2.8 : 3 }}>
          {hasLiveContent ? (
            <Box sx={{ width: 'min(1120px, 100%)', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 2.2, pb: 7 }}>
              {liveRows.map((row) => (
                <Box key={row.id} sx={{ display: 'flex', flexDirection: 'column', gap: 0.65 }}>
                  <Typography sx={{ ...helperTextSx, color: '#9aa1ad', fontSize: 12 }}>{formatSegmentTime(row.createdAt, language)}</Typography>
                  {showOriginal && row.sourceText ? (
                    <Typography sx={{ ...bodyTextSx, color: TEXT_COLOR, fontSize: 16, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {row.sourceText}
                    </Typography>
                  ) : null}
                  {showTranslation && row.translationText ? (
                    <Box sx={{ bgcolor: '#f1f6ff', borderLeft: `3px solid ${BLUE_COLOR}`, px: 1.2, py: 0.7, width: 'fit-content', maxWidth: '100%' }}>
                      <Typography sx={{ ...bodyTextSx, color: BLUE_COLOR, fontSize: 16, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {row.translationText}
                      </Typography>
                    </Box>
                  ) : showTranslation && row.status === 'pending' ? (
                    <Typography sx={{ ...helperTextSx, color: '#7b8491', fontSize: 12, fontWeight: 700 }}>
                      {t('meeting.translating')}
                    </Typography>
                  ) : null}
                </Box>
              ))}
            </Box>
          ) : (
            <Box sx={{ textAlign: 'center', transform: 'translateY(-18px)' }}>
              <Box sx={{ width: 70, height: 70, borderRadius: '50%', border: '2px solid #dce6fb', display: 'grid', placeItems: 'center', marginLeft: 'auto', marginRight: 'auto', boxShadow: waveformActive ? '0 0 0 10px rgba(52,120,246,0.06), 0 16px 42px rgba(52,120,246,0.16)' : '0 0 0 10px rgba(52,120,246,0.05)' }}>
                <Box sx={{ width: 38, height: 38, borderRadius: '50%', bgcolor: BLUE_COLOR, color: '#fff', display: 'grid', placeItems: 'center' }}>
                  <MicIcon sx={{ fontSize: 21 }} />
                </Box>
              </Box>
              <Box sx={{ mt: 1.7, display: 'flex', justifyContent: 'center' }}>
                <Waveform active={waveformActive} level={waveformLevel} size="hero" />
              </Box>
              <Typography sx={{ ...sectionTitleSx, fontSize: 15, color: TEXT_COLOR, mt: 2 }}>{isPaused ? t('meeting.paused') : t('meeting.listening')}</Typography>
              <Typography sx={{ ...bodyTextSx, fontSize: 13, color: MUTED_COLOR, mt: 1 }}>{t('meeting.startSpeaking')}</Typography>
            </Box>
          )}

          <Box sx={{ position: 'absolute', left: '50%', bottom: 18, transform: 'translateX(-50%)', minHeight: 44, px: 1.5, borderRadius: '14px', bgcolor: '#202124', color: '#f7f7f7', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.25, boxShadow: '0 14px 34px rgba(0,0,0,0.18)', ...bodyTextSx, fontSize: 13, fontWeight: 700, maxWidth: 'min(620px, calc(100% - 48px))', textAlign: 'left' }}>
            <Waveform active={waveformActive} level={waveformLevel} size="inline" />
            <Box component="span" sx={{ minWidth: 0 }}>{statusMessage}</Box>
          </Box>
        </Box>

        <Box sx={{ minHeight: 82, borderTop: `1px solid ${BORDER_COLOR}`, display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', alignItems: 'center', px: { xs: 1, md: 6 }, bgcolor: '#fff' }}>
          <LiveToolbarButton active={showOriginal} icon={<NotesIcon sx={{ fontSize: 22 }} />} label={t('meeting.original')} onClick={() => handleShowOriginalChange(!showOriginal)} />
          <LiveToolbarButton icon={<SettingsOutlinedIcon sx={{ fontSize: 22 }} />} label={t('meeting.settings')} onClick={() => setLiveSettingsOpen(true)} />
          <LiveToolbarButton active={isPaused} icon={isPaused ? <PlayArrowIcon sx={{ fontSize: 24 }} /> : <PauseIcon sx={{ fontSize: 23 }} />} label={isPaused ? t('meeting.resume') : t('meeting.pause')} onClick={handleTogglePause} />
          <LiveToolbarButton icon={<KeyboardIcon sx={{ fontSize: 23 }} />} label={t('meeting.subtitles')} onClick={() => void openSubtitles()} />
          <LiveToolbarButton danger icon={<StopCircleIcon sx={{ fontSize: 27 }} />} label={t('meeting.end')} onClick={() => void handleEndRecording()} />
        </Box>
        {renderLiveSettingsSheet()}
      </Box>
    )
  }

  const renderRecordingView = () => {
    if (recordingKind === 'live') return renderLiveRecordingView()

    return (
    <Box sx={{ ...pageFrameSx, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <IconButton onClick={() => void handleBack()} aria-label={t('meeting.back')} sx={{ width: 36, height: 36, mb: 1.3 }}>
        <ArrowBackIosNewIcon sx={{ fontSize: 20 }} />
      </IconButton>
      <InputBase
        value={activeTitle}
        onChange={(event) => setActiveNote((current) => current ? { ...current, title: event.target.value } : current)}
        sx={{ ...pageTitleSx, width: '100%', color: '#c4c6ca', lineHeight: 1.25, '& input': { p: 0 } }}
      />
      <InputBase
        multiline
        minRows={3}
        value={recordingKind === 'note' ? activeNote?.transcript || '' : ''}
        onChange={(event) => setActiveNote((current) => current ? { ...current, transcript: event.target.value } : current)}
        placeholder={recordingKind === 'note' ? t('meeting.notePlaceholder') : ''}
        sx={{ mt: 1.2, color: TEXT_COLOR, ...bodyTextSx, '& textarea::placeholder': { color: '#c6c7ca', opacity: 1 } }}
      />
      <Box sx={{ flex: 1 }} />
      {showTranscriptPanel ? renderNoteTranscriptionPanel() : null}
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.2, pb: 1.7 }}>
        <RecorderControls
          active={isMeetingVoiceActive}
          paused={isPaused}
          elapsedMs={elapsedMs}
          inputLevel={voiceSession.inputLevel}
          transcriptPanelVisible={showTranscriptPanel}
          onToggleTranscriptPanel={() => setShowTranscriptPanel((visible) => !visible)}
          onTogglePause={handleTogglePause}
          onEnd={() => void handleEndRecording()}
        />
      </Box>
    </Box>
    )
  }

  const renderProcessingView = () => (
    <Box sx={{ ...pageFrameSx, height: '100%', display: 'grid', placeItems: 'center', textAlign: 'center' }}>
      <Box sx={{ width: 'min(460px, 80vw)' }}>
        <Typography sx={{ fontSize: 24, fontWeight: 700, color: '#545960' }}>{t('meeting.processingTitle')}</Typography>
        <LinearProgress sx={{ mt: 3, height: 4, borderRadius: 999 }} />
        <Typography sx={{ ...bodyTextSx, color: MUTED_COLOR, mt: 2.4 }}>{t('meeting.processingHint')}</Typography>
      </Box>
    </Box>
  )

  const getAudioSourceLabel = (value: MeetingAudioSource | undefined) => {
    if (value === 'system') return t('meeting.systemAudio')
    if (value === 'microphone_system') return t('meeting.micAndSystem')
    return t('meeting.microphone')
  }

  const getTargetLanguageLabel = (value: MeetingTranslationTarget | undefined) => {
    if (!value || value === 'off') return t('meeting.off')
    return [...MEETING_NOTE_TARGET_LANGUAGES, ...MEETING_LIVE_TARGET_LANGUAGES].find((language) => language.id === value)?.label || value
  }

  const renderMetaChip = (label: string, value: string | number | undefined) => {
    const text = String(value || '').trim()
    if (!text) return null
    return (
      <Chip
        key={`${label}-${text}`}
        label={`${label}: ${text}`}
        sx={{ height: 28, borderRadius: '7px', bgcolor: '#f5f7fb', color: '#475569', fontSize: 12, fontWeight: 600 }}
      />
    )
  }

  const renderStructuredSection = (title: string, items: string[], options: { accent?: boolean } = {}) => {
    const usefulItems = items.map((item) => item.trim()).filter(Boolean)
    if (!usefulItems.length) return null
    return (
      <Box sx={{ border: `1px solid ${BORDER_COLOR}`, borderRadius: '12px', bgcolor: '#fff', p: 1.6, minWidth: 0 }}>
        <Typography sx={{ ...itemTitleSx, color: options.accent ? BLUE_COLOR : TEXT_COLOR, mb: 1 }}>{title}</Typography>
        <Box component="ul" sx={{ pl: 2.2, m: 0 }}>
          {usefulItems.map((item, index) => (
            <Typography key={`${title}-${index}-${item}`} component="li" sx={{ ...bodyTextSx, color: TEXT_COLOR, mb: index === usefulItems.length - 1 ? 0 : 0.75, wordBreak: 'break-word' }}>
              {item}
            </Typography>
          ))}
        </Box>
      </Box>
    )
  }

  const renderStructuredNoteTab = () => {
    const summaryItems = structuredSummaryLines.length ? structuredSummaryLines : (activeTranscript ? [t('meeting.summaryFallback')] : [])
    return (
      <Box sx={{ maxWidth: 1180, display: 'flex', flexDirection: 'column', gap: 1.4 }}>
        <Box>
          <Typography sx={{ ...pageTitleSx, color: TEXT_COLOR, lineHeight: 1.25, mb: 1.2 }}>
            {activeTitle}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.8, flexWrap: 'wrap' }}>
            {renderMetaChip(t('meeting.scenario'), activeStructuredResult?.scenario)}
            {renderMetaChip(t('meeting.contentLevel'), activeStructuredResult?.contentLevel)}
            {renderMetaChip(t('meeting.duration'), formatElapsed(activeNote?.durationMs || elapsedMs))}
            {renderMetaChip(t('meeting.audioSource'), getAudioSourceLabel((activeNote?.audioSource || audioSource) as MeetingAudioSource))}
            {renderMetaChip(t('meeting.targetLanguage'), getTargetLanguageLabel((activeNote?.targetLanguage || targetLanguage) as MeetingTranslationTarget))}
          </Box>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(360px, 100%), 1fr))', gap: 1.2 }}>
          {renderStructuredSection(t('meeting.meetingSummary'), summaryItems, { accent: true })}
          {renderStructuredSection(t('meeting.decisions'), structuredDecisionLines)}
          {renderStructuredSection(t('meeting.actionItems'), actionLines)}
          {renderStructuredSection(t('meeting.scheduleItems'), structuredScheduleLines)}
          {renderStructuredSection(t('meeting.risks'), structuredRiskLines)}
          {renderStructuredSection(t('meeting.questions'), structuredQuestionLines)}
          {renderStructuredSection(t('meeting.followUps'), structuredFollowUpLines)}
          {renderStructuredSection(t('meeting.topicSegments'), structuredTopicLines)}
        </Box>
        {!summaryItems.length && !actionLines.length ? (
          <Typography sx={{ ...bodyTextSx, color: MUTED_COLOR }}>{t('meeting.noSummaryYet')}</Typography>
        ) : null}
      </Box>
    )
  }

  const renderTranscriptTab = () => {
    if (transcriptSegments.length) {
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.9, maxWidth: 980 }}>
          {transcriptSegments.map((segment) => (
            <Box key={`${segment.index}-${segment.text}`} sx={{ bgcolor: PANEL_COLOR, borderRadius: '12px', p: 1.4, border: `1px solid ${BORDER_COLOR}` }}>
              <Typography sx={{ ...captionTextSx, color: MUTED_COLOR, mb: 0.6 }}>
                {t('meeting.segment')} {segment.index}{segment.contentLevel ? ` · ${segment.contentLevel}` : ''}
              </Typography>
              <Typography sx={{ ...bodyTextSx, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{segment.text}</Typography>
            </Box>
          ))}
          {activeTranslation ? <Typography sx={{ ...bodyTextSx, color: BLUE_COLOR, mt: 1, whiteSpace: 'pre-wrap' }}>{activeTranslation}</Typography> : null}
        </Box>
      )
    }

    return (
      <Box sx={{ bgcolor: PANEL_COLOR, borderRadius: '14px', p: 2, ...bodyTextSx, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {activeTranscript || t('meeting.noTranscriptYet')}
        {activeTranslation ? <Typography sx={{ ...bodyTextSx, color: BLUE_COLOR, mt: 2, whiteSpace: 'pre-wrap' }}>{activeTranslation}</Typography> : null}
      </Box>
    )
  }

  const renderDetailView = () => (
    <Box sx={{ ...pageFrameSx, height: '100%', overflow: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.2 }}>
          <IconButton onClick={() => void handleBack()} aria-label={t('meeting.back')} sx={{ width: 36, height: 36 }}>
            <ArrowBackIosNewIcon sx={{ fontSize: 20 }} />
          </IconButton>
          {(['note', 'transcript'] as DetailTab[]).map((tab) => (
            <Button
              key={tab}
              onClick={() => setDetailTab(tab)}
              sx={{
                minWidth: 0,
                borderRadius: 0,
                color: detailTab === tab ? BLUE_COLOR : '#4b5563',
                borderBottom: detailTab === tab ? `3px solid ${BLUE_COLOR}` : '3px solid transparent',
                ...sectionTitleSx,
              }}
            >
              {tab === 'note' ? t('meeting.noteTab') : t('meeting.transcriptTab')}
            </Button>
          ))}
        </Box>
        <IconButton aria-label={t('meeting.share')} sx={{ width: 36, height: 36 }}>
          <IosShareIcon sx={{ fontSize: 22, color: '#6b7280' }} />
        </IconButton>
      </Box>

      {detailTab === 'note' ? (
        renderStructuredNoteTab()
      ) : (
        renderTranscriptTab()
      )}
    </Box>
  )

  const renderImportView = () => (
    <Box
      sx={{ ...pageFrameSx, height: '100%', display: 'flex', flexDirection: 'column', gap: 1.8 }}
      onDragOver={(event) => {
        event.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setIsDragging(false)
        const file = event.dataTransfer.files?.[0]
        if (file) void handleImportFile(file, 'import')
      }}
    >
      {renderHiddenFileInput()}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
        <IconButton onClick={() => setView('list')} aria-label={t('meeting.back')} sx={{ width: 36, height: 36 }}>
          <ArrowBackIosNewIcon sx={{ fontSize: 20 }} />
        </IconButton>
        <Typography sx={pageTitleSx}>{t('meeting.importTitle')}</Typography>
      </Box>

      <Box
        component="button"
        type="button"
        disabled={busy}
        onClick={() => requestFile('import')}
        sx={{
          border: `2px dashed ${isDragging ? BLUE_COLOR : '#d1d1d4'}`,
          borderRadius: '12px',
          bgcolor: isDragging ? '#edf4ff' : '#fff',
          minHeight: 190,
          display: 'grid',
          placeItems: 'center',
          textAlign: 'center',
          cursor: 'pointer',
        }}
      >
        <Box>
          <FileUploadOutlinedIcon sx={{ fontSize: 32, color: '#bfc1c6' }} />
          <Typography sx={{ ...itemTitleSx, mt: 1.2 }}>{t('meeting.dropFile')}</Typography>
          <Typography sx={{ ...helperTextSx, mt: 0.9, color: MUTED_COLOR }}>{t('meeting.supportedFormats')}</Typography>
          <Typography sx={{ ...helperTextSx, mt: 0.4, color: MUTED_COLOR }}>{t('meeting.maxFileSize')}</Typography>
        </Box>
      </Box>

      {importItem ? (
        <Box sx={{ border: `1px solid ${BORDER_COLOR}`, borderRadius: '12px', minHeight: 60, px: 1.6, display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto auto', alignItems: 'center', gap: 1 }}>
          <CheckCircleIcon sx={{ color: importItem.status === 'error' ? DANGER_COLOR : '#54a96a', fontSize: 22 }} />
          <Typography sx={{ ...itemTitleSx, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{importItem.name}</Typography>
          <Typography sx={{ ...helperTextSx, color: MUTED_COLOR }}>{formatFileSize(importItem.size)}</Typography>
          <Typography sx={{ ...helperTextSx, color: importItem.status === 'error' ? DANGER_COLOR : '#27804a' }}>
            {importItem.status === 'error' ? t('meeting.status.error') : t('meeting.uploaded')}
          </Typography>
        </Box>
      ) : null}
      {message ? <Typography sx={{ ...helperTextSx, color: DANGER_COLOR }}>{message}</Typography> : null}
    </Box>
  )

  return (
    <>
      {view === 'recording' ? renderRecordingView() : view === 'liveSetup' ? renderLiveSetupView() : view === 'processing' ? renderProcessingView() : view === 'detail' ? renderDetailView() : view === 'import' ? renderImportView() : renderListView()}
      <Dialog open={exitConfirmOpen} onClose={() => setExitConfirmOpen(false)} maxWidth={false} slotProps={{ paper: { sx: { width: 570, borderRadius: '18px' } }, backdrop: { sx: { bgcolor: 'rgba(17,17,17,0.48)' } } }}>
        <DialogContent sx={{ p: 0, textAlign: 'center' }}>
          <Box sx={{ px: 3, py: 3 }}>
            <Typography sx={{ fontSize: 24, fontWeight: 700 }}>{t('meeting.exitTitle')}</Typography>
            <Typography sx={{ ...bodyTextSx, color: '#5f6673', mt: 1.5 }}>{t('meeting.exitBody')}</Typography>
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: `1px solid ${BORDER_COLOR}` }}>
            <Button onClick={() => void discardRecording()} sx={{ height: 68, color: '#9aa0a6', ...sectionTitleSx, borderRadius: 0 }}>{t('meeting.exitDiscard')}</Button>
            <Button onClick={() => setExitConfirmOpen(false)} sx={{ height: 68, color: BLUE_COLOR, ...sectionTitleSx, borderRadius: 0, borderLeft: `1px solid ${BORDER_COLOR}` }}>{t('meeting.continueRecording')}</Button>
          </Box>
        </DialogContent>
      </Dialog>
    </>
  )
}
