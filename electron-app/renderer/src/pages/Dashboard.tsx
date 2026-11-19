import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { Box, IconButton, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { subscribeVoiceSession } from '../services/recorder'
import { ipcClient } from '../services/ipc'
import { listDictionaryEntries, subscribeDictionaryChanges } from '../services/dictionaryStore'
import { calculateDashboardPersonalization } from '../services/dashboardPersonalization'
import { formatShortcut, getShortcutLabelSet } from '../services/shortcutLabels'
import {
  emptyVoiceStats,
  formatAverageSpeed,
  formatDurationMinutes,
  formatSavedMinutes,
  listVoiceHistory,
  loadVoiceStats,
  type VoiceStats,
  VOICE_HISTORY_UPDATED_EVENT,
} from '../services/historyStore'
import {
  prependRecentDashboardResult,
  selectRecentDashboardResults,
  type RecentDashboardResult,
} from '../services/recentDashboardResults'
import { useI18n } from '../i18n'
import { cardSx, glassItemSx, pageSx, pageTitleSx, shortcutChipSx, subtlePanelSx, typo } from '../uiTokens'

const PERSONALIZATION_BLUE = '#2563eb'

export default function Dashboard() {
  const { t } = useI18n()
  const [recentResults, setRecentResults] = useState<RecentDashboardResult[]>([])
  const [stats, setStats] = useState<VoiceStats>(emptyVoiceStats)
  const [activeDictionaryCount, setActiveDictionaryCount] = useState(0)
  const shortcuts = getShortcutLabelSet()
  const personalization = calculateDashboardPersonalization({
    totalDurationMs: stats.totalDurationMs,
    totalTextLength: stats.totalTextLength,
    activeDictionaryCount,
  })

  const handleCopyRecentResult = (text: string) => {
    if (!text) return
    ipcClient.invoke('clipboard:write-text', text).catch(() => navigator.clipboard.writeText(text))
  }

  useEffect(() => {
    return subscribeVoiceSession((voiceSession) => {
      if (voiceSession.status === 'completed' && voiceSession.mode !== 'Ask') {
        const { refinedText, rawText } = voiceSession
        const result = refinedText || rawText
        const id = voiceSession.audioId || `live-${Date.now()}`
        if (result) {
          setRecentResults((current) => prependRecentDashboardResult(current, { id, text: result }))
        }
      }
    })
  }, [])

  useEffect(() => {
    const refreshRecentResults = () => {
      listVoiceHistory()
        .then((items) => setRecentResults(selectRecentDashboardResults(items)))
        .catch(() => undefined)
    }

    refreshRecentResults()
    window.addEventListener(VOICE_HISTORY_UPDATED_EVENT, refreshRecentResults)
    return () => window.removeEventListener(VOICE_HISTORY_UPDATED_EVENT, refreshRecentResults)
  }, [])

  useEffect(() => {
    const refreshStats = () => {
      loadVoiceStats().then(setStats).catch(() => setStats(emptyVoiceStats))
    }

    refreshStats()
    window.addEventListener(VOICE_HISTORY_UPDATED_EVENT, refreshStats)
    return () => window.removeEventListener(VOICE_HISTORY_UPDATED_EVENT, refreshStats)
  }, [])

  useEffect(() => {
    const refreshDictionaryPersonalization = () => {
      listDictionaryEntries()
        .then((entries) => setActiveDictionaryCount(entries.filter((entry) => entry.status === 'active').length))
        .catch(() => setActiveDictionaryCount(0))
    }

    refreshDictionaryPersonalization()
    return subscribeDictionaryChanges(() => {
      refreshDictionaryPersonalization()
    })
  }, [])

  return (
    <Box sx={{ ...pageSx, maxWidth: 980, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box>
        <Typography sx={pageTitleSx}>{t('dashboard.title')}</Typography>
        <Typography sx={{ ...typo.body, color: 'text.secondary', mt: 0.5 }}>
          {t('dashboard.shortcut.prefix')}{' '}
          <Box component="kbd" className="glass-lens" sx={{ ...shortcutChipSx, fontFamily: 'inherit' }}>
            {formatShortcut(shortcuts.dictation)}
          </Box>{' '}
          {t('dashboard.shortcut.orPress')}{' '}
          <Box component="kbd" className="glass-lens" sx={{ ...shortcutChipSx, fontFamily: 'inherit' }}>
            {formatShortcut(shortcuts.translate)}
          </Box>{' '}
          {t('dashboard.shortcut.orPress')}{' '}
          <Box component="kbd" className="glass-lens" sx={{ ...shortcutChipSx, fontFamily: 'inherit' }}>
            {formatShortcut(shortcuts.ask)}
          </Box>{' '}
          {t('dashboard.shortcut.suffix')}
        </Typography>
      </Box>

      <Box sx={{ ...subtlePanelSx, p: 2, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
        <Box sx={{ ...cardSx, p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ minWidth: 0, flex: 1, pr: 2 }}>
            <Typography sx={{ ...typo.caption, color: 'text.secondary' }}>{t('dashboard.personalization.label')}</Typography>
            <Box sx={{ mt: 1.5, height: 8, borderRadius: 999, bgcolor: 'rgba(119,119,119,0.12)', overflow: 'hidden' }}>
              <Box sx={{ height: '100%', width: `${personalization}%`, borderRadius: 999, bgcolor: PERSONALIZATION_BLUE }} />
            </Box>
          </Box>
          <Box sx={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: `conic-gradient(${PERSONALIZATION_BLUE} 0% ${personalization}%, rgba(119,119,119,0.14) ${personalization}% 100%)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Box sx={{ width: 48, height: 48, borderRadius: '50%', bgcolor: 'rgba(255,255,255,0.86)', boxShadow: 'inset 0 1px 0 #fff, 0 1px 4px rgba(30,40,70,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography sx={{ ...typo.bodyStrong }}>{personalization}%</Typography>
            </Box>
          </Box>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          {[
            { label: t('dashboard.stats.totalDuration'), value: formatDurationMinutes(stats.totalDurationMs) },
            { label: t('dashboard.stats.totalTextLength'), value: String(stats.totalTextLength) },
            { label: t('dashboard.stats.savedTime'), value: formatSavedMinutes(stats.savedMs) },
            { label: t('dashboard.stats.averageSpeed'), value: formatAverageSpeed(stats.averageCharsPerMinute) },
          ].map((item) => (
            <Box key={item.label} sx={{ ...cardSx, p: '12px' }}>
              <Typography sx={{ ...typo.stat }}>{item.value}</Typography>
              <Typography sx={{ ...typo.caption, color: 'text.secondary' }}>{item.label}</Typography>
            </Box>
          ))}
        </Box>
      </Box>

      <Box>
        <Box sx={{ ...cardSx, p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography sx={{ ...typo.heading }}>{t('dashboard.recentResults')}</Typography>
          </Box>
          <Box sx={{ ...glassItemSx, borderRadius: '16px', minHeight: 64, overflow: 'hidden' }}>
            {recentResults.length > 0 ? recentResults.map((item, index) => (
              <Box
                key={item.id}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto',
                  alignItems: 'start',
                  gap: 1,
                  p: 1.5,
                  borderBottom: index === recentResults.length - 1 ? 'none' : '1px solid var(--glass-hairline)',
                }}
              >
                <Typography sx={{ ...typo.body, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{item.text}</Typography>
                <IconButton
                  size="small"
                  aria-label={`${t('dashboard.copyRecentResult')} ${index + 1}`}
                  onClick={() => handleCopyRecentResult(item.text)}
                >
                  <ContentCopyIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Box>
            )) : (
              <Box sx={{ p: 1.5 }}>
                <Typography sx={{ ...typo.body, whiteSpace: 'pre-wrap' }}>-</Typography>
              </Box>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
