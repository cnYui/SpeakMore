import { Box, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { subscribeVoiceSession } from '../services/recorder'
import {
  emptyVoiceStats,
  formatAverageSpeed,
  formatDurationMinutes,
  formatSavedMinutes,
  loadVoiceStats,
  type VoiceStats,
  VOICE_HISTORY_UPDATED_EVENT,
} from '../services/historyStore'
import { cardSx, subtlePanelSx } from '../uiTokens'

export default function Dashboard() {
  const [recentResult, setRecentResult] = useState('')
  const [stats, setStats] = useState<VoiceStats>(emptyVoiceStats)

  useEffect(() => {
    return subscribeVoiceSession((voiceSession) => {
      if (voiceSession.status === 'completed') {
        const { refinedText, rawText } = voiceSession
        const result = refinedText || rawText
        if (result) setRecentResult(result)
      }
    })
  }, [])

  useEffect(() => {
    const refreshStats = () => {
      loadVoiceStats().then(setStats).catch(() => setStats(emptyVoiceStats))
    }

    refreshStats()
    window.addEventListener(VOICE_HISTORY_UPDATED_EVENT, refreshStats)
    return () => window.removeEventListener(VOICE_HISTORY_UPDATED_EVENT, refreshStats)
  }, [])

  return (
    <Box sx={{ maxWidth: 980, mx: 'auto', p: 3, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box>
        <Typography sx={{ fontSize: 24, fontWeight: 500 }}>首页</Typography>
        <Typography sx={{ fontSize: 14, color: '#5d5d5d', mt: 0.5 }}>
          请短按{' '}
          <Box component="kbd" sx={{ bgcolor: 'rgba(119,119,119,0.08)', borderRadius: '5px', px: '5px', py: '2px', fontWeight: 500 }}>
            Right Alt
          </Box>{' '}
          或按{' '}
          <Box component="kbd" sx={{ bgcolor: 'rgba(119,119,119,0.08)', borderRadius: '5px', px: '5px', py: '2px', fontWeight: 500 }}>
            Right Alt + Right Shift
          </Box>{' '}
          或按{' '}
          <Box component="kbd" sx={{ bgcolor: 'rgba(119,119,119,0.08)', borderRadius: '5px', px: '5px', py: '2px', fontWeight: 500 }}>
            Right Alt + Space
          </Box>{' '}
          开始听写
        </Typography>
      </Box>

      <Box sx={{ ...subtlePanelSx, p: 2, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
        <Box sx={{ ...cardSx, p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography sx={{ fontSize: 24, fontWeight: 600 }}>暂未启用</Typography>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>整体个性化</Typography>
          </Box>
          <Box sx={{ width: 56, height: 56, borderRadius: '50%', background: 'conic-gradient(#d0d0d0 0% 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Box sx={{ width: 40, height: 40, borderRadius: '50%', bgcolor: '#fff' }} />
          </Box>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          {[
            { label: '总听写时长', value: formatDurationMinutes(stats.totalDurationMs) },
            { label: '累计听写字数', value: String(stats.totalTextLength) },
            { label: '节省时间', value: formatSavedMinutes(stats.savedMs) },
            { label: '平均速度', value: formatAverageSpeed(stats.averageCharsPerMinute) },
          ].map((item) => (
            <Box key={item.label} sx={{ ...cardSx, p: '12px' }}>
              <Typography sx={{ fontSize: 18, fontWeight: 600 }}>{item.value}</Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{item.label}</Typography>
            </Box>
          ))}
        </Box>
      </Box>

      <Box>
        <Box sx={{ ...cardSx, p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 500 }}>最近结果</Typography>
          <Box sx={{ bgcolor: 'rgba(119,119,119,0.03)', borderRadius: '12px', p: 1.5, minHeight: 64 }}>
            <Typography sx={{ fontSize: 15, whiteSpace: 'pre-wrap' }}>{recentResult || '-'}</Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
