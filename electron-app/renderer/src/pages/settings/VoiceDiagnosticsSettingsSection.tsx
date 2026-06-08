import { useEffect, useMemo, useState } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  Typography,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { useI18n, type TranslationKey } from '../../i18n'
import {
  clearVoiceDiagnostics,
  listVoiceDiagnostics,
  subscribeVoiceDiagnosticsChanges,
  type VoiceDiagnosticSession,
} from '../../services/voiceDiagnosticsStore'
import { bodyTextSx, captionTextSx, helperTextSx, itemTitleSx, sectionTitleSx } from '../../uiTokens'

const panelSx = {
  borderRadius: '12px',
  bgcolor: 'rgba(119,119,119,0.05)',
  border: '1px solid rgba(119,119,119,0.08)',
  boxShadow: 'none',
  '&::before': { display: 'none' },
}

const diagnosticRowSx = {
  display: 'grid',
  gridTemplateColumns: { xs: '1fr', md: 'minmax(170px, 0.75fr) minmax(0, 1fr)' },
  gap: { xs: 0.9, md: 1.5 },
  px: 1.2,
  py: 1,
  borderRadius: '10px',
  bgcolor: '#fff',
  border: '1px solid rgba(119,119,119,0.08)',
}

function formatMs(value: unknown) {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue) || numberValue <= 0) return '--'
  if (numberValue >= 1000) return `${(numberValue / 1000).toFixed(numberValue >= 10000 ? 0 : 1)}s`
  return `${Math.round(numberValue)}ms`
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function modeKey(mode: string): TranslationKey {
  if (mode === 'Ask') return 'settings.voiceDiagnostics.mode.ask'
  if (mode === 'Translate') return 'settings.voiceDiagnostics.mode.translate'
  if (mode === 'CustomCommand') return 'settings.voiceDiagnostics.mode.customCommand'
  if (mode === 'MeetingNotes') return 'settings.voiceDiagnostics.mode.meetingNotes'
  return 'settings.voiceDiagnostics.mode.dictate'
}

function statusKey(status: string): TranslationKey {
  if (status === 'completed') return 'settings.voiceDiagnostics.status.completed'
  if (status === 'cancelled') return 'settings.voiceDiagnostics.status.cancelled'
  return 'settings.voiceDiagnostics.status.error'
}

function qualityHintKey(hint: string): TranslationKey | null {
  if (hint === 'low_volume') return 'settings.voiceDiagnostics.hint.lowVolume'
  if (hint === 'clipping') return 'settings.voiceDiagnostics.hint.clipping'
  if (hint === 'likely_noisy') return 'settings.voiceDiagnostics.hint.likelyNoisy'
  if (hint === 'mostly_silence') return 'settings.voiceDiagnostics.hint.mostlySilence'
  return null
}

export default function VoiceDiagnosticsSettingsSection() {
  const { t } = useI18n()
  const [sessions, setSessions] = useState<VoiceDiagnosticSession[]>([])
  const [busy, setBusy] = useState(false)
  const recentSessions = useMemo(() => sessions.slice(0, 10), [sessions])

  const refresh = () => {
    void listVoiceDiagnostics().then(setSessions)
  }

  useEffect(() => {
    refresh()
    return subscribeVoiceDiagnosticsChanges(() => refresh())
  }, [])

  const handleClear = async () => {
    setBusy(true)
    try {
      await clearVoiceDiagnostics()
      setSessions([])
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Typography sx={{ ...sectionTitleSx, mt: 4, mb: 1 }}>{t('settings.voiceDiagnostics.title')}</Typography>
      <Accordion disableGutters sx={panelSx}>
        <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ fontSize: 20 }} />}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={itemTitleSx}>{t('settings.voiceDiagnostics.summary')}</Typography>
            <Typography sx={{ ...helperTextSx, color: 'text.secondary', mt: 0.4 }}>
              {t('settings.voiceDiagnostics.privacyHint')}
            </Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0, px: 1.5, pb: 1.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
            <Button size="small" disabled={busy || !sessions.length} onClick={() => void handleClear()}>
              {t('settings.voiceDiagnostics.clear')}
            </Button>
          </Box>
          {recentSessions.length ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.9 }}>
              {recentSessions.map((session) => {
                const hints = session.audioQuality?.hints || []
                return (
                  <Box key={session.id} sx={diagnosticRowSx}>
                    <Box sx={{ minWidth: 0 }}>
                      <Box sx={{ display: 'flex', gap: 0.7, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Typography sx={itemTitleSx}>{t(modeKey(session.mode))}</Typography>
                        <Chip
                          size="small"
                          label={t(statusKey(session.status))}
                          color={session.status === 'completed' ? 'success' : session.status === 'cancelled' ? 'default' : 'error'}
                          sx={{ height: 22, fontSize: 12, borderRadius: '6px' }}
                        />
                      </Box>
                      <Typography sx={{ ...captionTextSx, color: 'text.secondary', mt: 0.5 }}>
                        {formatTime(session.startedAt)} · {t('settings.voiceDiagnostics.duration')}: {formatMs(session.durationMs)}
                      </Typography>
                      {session.errorCode ? (
                        <Typography sx={{ ...captionTextSx, color: 'error.main', mt: 0.5 }}>
                          {t('settings.voiceDiagnostics.error')}: {session.errorCode}
                        </Typography>
                      ) : null}
                    </Box>
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 0.8, minWidth: 0 }}>
                      <Metric label={t('settings.voiceDiagnostics.startup')} value={formatMs(session.metrics.startupMs)} />
                      <Metric label={t('settings.voiceDiagnostics.ready')} value={formatMs(session.metrics.readyMs)} />
                      <Metric label={t('settings.voiceDiagnostics.microphone')} value={formatMs(session.metrics.microphoneMs)} />
                      <Metric label={t('settings.voiceDiagnostics.firstText')} value={formatMs(session.metrics.firstTranscriptionMs)} />
                      <Metric label={t('settings.voiceDiagnostics.firstStableText')} value={formatMs(session.metrics.firstStableTranscriptionMs)} />
                      <Metric label={t('settings.voiceDiagnostics.firstTranslation')} value={formatMs(session.metrics.firstTranslationMs)} />
                      <Metric label={t('settings.voiceDiagnostics.finalRefine')} value={formatMs(session.metrics.finalRefineMs)} />
                      {hints.length ? (
                        <Box sx={{ gridColumn: '1 / -1', display: 'flex', gap: 0.6, flexWrap: 'wrap' }}>
                          {hints.map((hint) => (
                            <Chip
                              key={hint}
                              size="small"
                              label={qualityHintKey(hint) ? t(qualityHintKey(hint) as TranslationKey) : hint}
                              sx={{ height: 22, fontSize: 12, borderRadius: '6px' }}
                            />
                          ))}
                        </Box>
                      ) : null}
                    </Box>
                  </Box>
                )
              })}
            </Box>
          ) : (
            <Typography sx={{ ...bodyTextSx, color: 'text.secondary', py: 1 }}>
              {t('settings.voiceDiagnostics.empty')}
            </Typography>
          )}
        </AccordionDetails>
      </Accordion>
    </>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ ...captionTextSx, color: 'text.secondary' }}>{label}</Typography>
      <Typography sx={{ ...bodyTextSx, fontWeight: 600 }}>{value}</Typography>
    </Box>
  )
}
