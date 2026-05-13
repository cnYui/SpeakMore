import { Box, Typography, IconButton } from '@mui/material'
import { useState, useEffect } from 'react'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { ipcClient } from '../services/ipc'
import { getVoiceStatusLabel, initialVoiceSession, voiceModes, type VoiceMode, type VoiceSession } from '../services/voiceTypes'
import { subscribeVoiceSession } from '../services/recorder'
import { saveVoiceHistory } from '../services/historyStore'
import { cardSx, subtlePanelSx } from '../uiTokens'

export default function Dashboard() {
  const [activeMode, setActiveMode] = useState<VoiceMode>('Dictate')
  const [voiceSession, setVoiceSession] = useState<VoiceSession>(initialVoiceSession)
  const [savedAudioIds, setSavedAudioIds] = useState<Set<string>>(() => new Set())
  const statusLabel = getVoiceStatusLabel(voiceSession)

  useEffect(() => {
    const unsubscribe = subscribeVoiceSession(setVoiceSession)
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!voiceSession.audioId) return
    if (voiceSession.status !== 'completed' && voiceSession.status !== 'error') return
    if (savedAudioIds.has(voiceSession.audioId)) return

    saveVoiceHistory({
      id: voiceSession.audioId,
      createdAt: new Date().toISOString(),
      mode: voiceSession.mode,
      status: voiceSession.status === 'completed' ? 'completed' : 'error',
      rawText: voiceSession.rawText,
      refinedText: voiceSession.refinedText,
      errorCode: voiceSession.error?.code,
    })

    setSavedAudioIds((prev) => new Set(prev).add(voiceSession.audioId!))
  }, [savedAudioIds, voiceSession])

  const handleCopy = () => {
    const text = voiceSession.refinedText || voiceSession.rawText
    if (!text) return
    ipcClient.invoke('clipboard:write-text', text).catch(() => navigator.clipboard.writeText(text))
  }

  return (
    <Box sx={{ maxWidth: 980, mx: 'auto', p: 3, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box>
        <Typography sx={{ fontSize: 24, fontWeight: 500 }}>Home</Typography>
        <Typography sx={{ fontSize: 14, color: '#5d5d5d', mt: 0.5 }}>
          请短按{' '}
          <Box component="kbd" sx={{ bgcolor: 'rgba(119,119,119,0.08)', borderRadius: '5px', px: '5px', py: '2px', fontWeight: 500 }}>
            Right Alt
          </Box>{' '}
          或按{' '}
          <Box component="kbd" sx={{ bgcolor: 'rgba(119,119,119,0.08)', borderRadius: '5px', px: '5px', py: '2px', fontWeight: 500 }}>
            Right Alt + Shift
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
            <Typography sx={{ fontSize: 28, fontWeight: 600 }}>23.4%</Typography>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>Overall personalization</Typography>
          </Box>
          <Box sx={{ width: 56, height: 56, borderRadius: '50%', background: 'conic-gradient(#44bedf 0% 23.4%, #e8e8e8 23.4% 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Box sx={{ width: 40, height: 40, borderRadius: '50%', bgcolor: '#fff' }} />
          </Box>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          {[
            { label: 'Total dictation time', value: '0 min' },
            { label: 'Words dictated', value: '0' },
            { label: 'Time saved', value: '0' },
            { label: 'Average speed', value: '--' },
          ].map((item) => (
            <Box key={item.label} sx={{ ...cardSx, p: '12px' }}>
              <Typography sx={{ fontSize: 18, fontWeight: 600 }}>{item.value}</Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{item.label}</Typography>
            </Box>
          ))}
        </Box>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}>
        <Box sx={{ ...cardSx, p: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 500, alignSelf: 'flex-start' }}>Voice dictation</Typography>
          <Box sx={{ display: 'flex', bgcolor: 'rgba(119,119,119,0.08)', borderRadius: '20px', p: '3px' }}>
            {voiceModes.map((mode) => (
              <Box
                key={mode}
                onClick={() => setActiveMode(mode)}
                sx={{ px: 2, py: 0.5, borderRadius: '16px', fontSize: 13, cursor: 'pointer', fontWeight: 500, bgcolor: activeMode === mode ? '#fff' : 'transparent', boxShadow: activeMode === mode ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}
              >
                {mode}
              </Box>
            ))}
          </Box>
          <Typography sx={{ fontSize: 13, color: voiceSession.error ? '#c62828' : 'rgba(17,17,17,0.5)' }}>{statusLabel}</Typography>
        </Box>

        <Box sx={{ ...cardSx, p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography sx={{ fontSize: 16, fontWeight: 500 }}>Latest result</Typography>
            <IconButton size="small" onClick={handleCopy}>
              <ContentCopyIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>
          <Box sx={{ bgcolor: 'rgba(119,119,119,0.06)', borderRadius: '12px', p: 1.5, minHeight: 48 }}>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{voiceSession.rawText || '-'}</Typography>
          </Box>
          <Box sx={{ bgcolor: 'rgba(119,119,119,0.03)', borderRadius: '12px', p: 1.5, minHeight: 64 }}>
            <Typography sx={{ fontSize: 15 }}>{voiceSession.refinedText || '-'}</Typography>
          </Box>
        </Box>
      </Box>

      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 500 }}>Recent history</Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>0</Typography>
        </Box>
        <Box sx={{ ...cardSx, p: 3, textAlign: 'center' }}>
          <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>暂无历史记录</Typography>
        </Box>
      </Box>
    </Box>
  )
}
