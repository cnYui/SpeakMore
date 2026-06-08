import { Box, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { ipcClient } from '../services/ipc'
import { listDictionaryEntries, subscribeDictionaryChanges } from '../services/dictionaryStore'
import { calculateDashboardPersonalization } from '../services/dashboardPersonalization'
import { ShortcutBindingDialog, ShortcutDisplayButtons } from '../components/ShortcutBindingDialog'
import { useVoiceShortcutDisplay } from '../components/useVoiceShortcutDisplay'
import {
  deleteVoiceHistory,
  emptyVoiceStats,
  formatAverageSpeed,
  formatDurationMinutes,
  formatSavedMinutes,
  listVoiceHistory,
  loadVoiceStats,
  retryVoiceHistory,
  type VoiceHistoryItem,
  type VoiceStats,
  VOICE_HISTORY_UPDATED_EVENT,
} from '../services/historyStore'
import type { ShortcutCommand } from '../services/shortcutCommandStore'
import { selectRecentDashboardResults } from '../services/recentDashboardResults'
import { useI18n } from '../i18n'
import HistoryResultsPanel from './dashboard/HistoryResultsPanel'
import {
  adaptivePageSx,
  captionTextSx,
  cardSx,
  helperTextSx,
  itemTitleSx,
  metricValueSx,
  pageDescriptionSx,
  pageTitleSx,
  subtlePanelSx,
} from '../uiTokens'

const PERSONALIZATION_BLUE = '#2563eb'

export default function Dashboard() {
  const { t } = useI18n()
  const [historyItems, setHistoryItems] = useState<VoiceHistoryItem[]>([])
  const [historyModalOpen, setHistoryModalOpen] = useState(false)
  const [retryingHistoryId, setRetryingHistoryId] = useState('')
  const [bindingShortcutCommand, setBindingShortcutCommand] = useState<ShortcutCommand | null>(null)
  const [stats, setStats] = useState<VoiceStats>(emptyVoiceStats)
  const [activeDictionaryCount, setActiveDictionaryCount] = useState(0)
  const {
    voiceInputCommand,
    voiceShortcutDisplay,
    smartAssistantAvailable,
    saveCommand: saveShortcutCommand,
  } = useVoiceShortcutDisplay()
  const recentResults = selectRecentDashboardResults(historyItems)
  const personalization = calculateDashboardPersonalization({
    totalDurationMs: stats.totalDurationMs,
    totalTextLength: stats.totalTextLength,
    activeDictionaryCount,
  })

  const refreshHistory = useCallback(() => {
    return listVoiceHistory()
      .then((items) => setHistoryItems(items))
      .catch(() => setHistoryItems([]))
  }, [])

  const handleCopyHistoryText = (text: string) => {
    if (!text) return
    ipcClient.invoke('clipboard:write-text', text).catch(() => navigator.clipboard.writeText(text))
  }

  const emitHistoryUpdated = () => window.dispatchEvent(new Event(VOICE_HISTORY_UPDATED_EVENT))

  const handleDeleteHistoryItem = (id: string) => {
    void deleteVoiceHistory(id).then((success) => {
      if (!success) return
      return refreshHistory().then(emitHistoryUpdated)
    })
  }

  const handleRetryHistoryItem = (id: string) => {
    if (!id || retryingHistoryId) return
    setRetryingHistoryId(id)
    void retryVoiceHistory(id)
      .then(() => refreshHistory())
      .then(emitHistoryUpdated)
      .finally(() => setRetryingHistoryId(''))
  }

  const openVoiceShortcutBinding = () => {
    if (voiceInputCommand) setBindingShortcutCommand(voiceInputCommand)
  }

  const handleSaveShortcutBinding = async (command: Partial<ShortcutCommand>) => {
    await saveShortcutCommand(command)
    setBindingShortcutCommand(null)
  }

  useEffect(() => {
    refreshHistory()
    window.addEventListener(VOICE_HISTORY_UPDATED_EVENT, refreshHistory)
    return () => window.removeEventListener(VOICE_HISTORY_UPDATED_EVENT, refreshHistory)
  }, [refreshHistory])

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
    <Box sx={{ ...adaptivePageSx, display: 'flex', flexDirection: 'column', gap: { xs: 2, lg: 2.5 } }}>
      <Box>
        <Typography sx={pageTitleSx}>{t('dashboard.title')}</Typography>
        <Typography component="div" sx={{ ...pageDescriptionSx, color: '#5d5d5d', mt: 0.5, display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 0.75 }}>
          <Box component="span">{t('dashboard.shortcut.hold')}</Box>
          <ShortcutDisplayButtons
            display={voiceShortcutDisplay}
            ariaLabel={t('dashboard.shortcut.bindVoiceInput')}
            onClick={openVoiceShortcutBinding}
          />
          <Box component="span">{t('dashboard.shortcut.voiceInputAction')}</Box>
          <Box component="span" sx={{ ml: 1.1, color: smartAssistantAvailable ? 'inherit' : 'text.disabled' }}>
            {t('dashboard.shortcut.doubleTap')}
          </Box>
          <ShortcutDisplayButtons
            display={voiceShortcutDisplay}
            disabled={!smartAssistantAvailable}
            ariaLabel={t('dashboard.shortcut.bindVoiceInput')}
            onClick={smartAssistantAvailable ? openVoiceShortcutBinding : undefined}
          />
          <Box component="span" sx={{ color: smartAssistantAvailable ? 'inherit' : 'text.disabled' }}>
            {t('dashboard.shortcut.smartAssistantAction')}
          </Box>
        </Typography>
      </Box>

      <Box
        sx={{
          ...subtlePanelSx,
          p: { xs: 1.5, md: 2 },
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: 'minmax(280px, 0.9fr) minmax(0, 1.35fr)' },
          gap: { xs: 1.5, md: 2 },
          alignItems: 'stretch',
        }}
      >
        <Box sx={{ ...cardSx, p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ minWidth: 0, flex: 1, pr: 2 }}>
            <Typography sx={{ ...helperTextSx, color: 'text.secondary' }}>{t('dashboard.personalization.label')}</Typography>
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
            <Box sx={{ width: 48, height: 48, borderRadius: '50%', bgcolor: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography sx={itemTitleSx}>{personalization}%</Typography>
            </Box>
          </Box>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))', gap: { xs: 1, md: 1.5 } }}>
          {[
            { label: t('dashboard.stats.totalDuration'), value: formatDurationMinutes(stats.totalDurationMs) },
            { label: t('dashboard.stats.totalTextLength'), value: String(stats.totalTextLength) },
            { label: t('dashboard.stats.savedTime'), value: formatSavedMinutes(stats.savedMs) },
            { label: t('dashboard.stats.averageSpeed'), value: formatAverageSpeed(stats.averageCharsPerMinute) },
          ].map((item) => (
            <Box key={item.label} sx={{ ...cardSx, p: '12px' }}>
              <Typography sx={metricValueSx}>{item.value}</Typography>
              <Typography sx={{ ...captionTextSx, color: 'text.secondary' }}>{item.label}</Typography>
            </Box>
          ))}
        </Box>
      </Box>

      <Box>
        <Box sx={{ ...cardSx, p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <HistoryResultsPanel
            recentResults={recentResults}
            historyItems={historyItems}
            modalOpen={historyModalOpen}
            retryingId={retryingHistoryId}
            onOpenModal={() => setHistoryModalOpen(true)}
            onCloseModal={() => setHistoryModalOpen(false)}
            onCopy={handleCopyHistoryText}
            onDelete={handleDeleteHistoryItem}
            onRetry={handleRetryHistoryItem}
          />
        </Box>
      </Box>

      <ShortcutBindingDialog
        command={bindingShortcutCommand}
        onClose={() => setBindingShortcutCommand(null)}
        onSave={handleSaveShortcutBinding}
      />
    </Box>
  )
}
