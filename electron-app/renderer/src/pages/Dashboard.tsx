import { Box, Typography, IconButton } from '@mui/material'
import { useState, useEffect, useRef, useCallback } from 'react'
import MicIcon from '@mui/icons-material/Mic'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { toggleRecording, connectWs, getIsRecording } from '../services/recorder'

const card = {
  bgcolor: '#fff',
  borderRadius: '16px',
  border: '1px solid rgba(119,119,119,0.08)',
}

const modes = ['Dictate', 'Ask', 'Translate'] as const
type VoiceMode = typeof modes[number]

function findKeyboardShortcutMode(keys: unknown): VoiceMode | null {
  if (!Array.isArray(keys)) return null

  const rightAlt = keys.find((key) => key.keyName === 'RightAlt')
  if (!rightAlt?.isKeydown) return null

  if (keys.some((key) => key.keyName === 'Space' && key.isKeydown)) return 'Ask'
  if (keys.some((key) => key.keyName === 'RightShift' && key.isKeydown)) return 'Translate'
  return 'Dictate'
}

export default function Dashboard() {
  const [activeMode, setActiveMode] = useState<VoiceMode>('Dictate')
  const [rawText, setRawText] = useState('')
  const [refinedText, setRefinedText] = useState('')
  const [status, setStatus] = useState('准备就绪')
  const [recording, setRecording] = useState(false)

  const callbacksRef = useRef({
    onTranscription: (text: string) => setRawText(text),
    onRefined: (text: string) => { setRefinedText(text); setRecording(false) },
    onStatusChange: (s: string) => setStatus(s),
    onError: (e: string) => { setStatus(e); setRecording(false) },
  })

  useEffect(() => {
    connectWs(callbacksRef.current)
  }, [])

  const handleToggle = useCallback((mode = activeMode) => {
    setActiveMode(mode)
    toggleRecording(mode, callbacksRef.current)
    // 延迟同步状态，因为 toggleRecording 内部是异步的
    setTimeout(() => setRecording(getIsRecording()), 200)
  }, [activeMode])

  // 监听全局快捷键
  useEffect(() => {
    const ipc = (window as any).ipcRenderer
    if (!ipc) return
    const handler = (_event: unknown, keys: unknown) => {
      const shortcutMode = findKeyboardShortcutMode(keys)
      if (!shortcutMode) return
      handleToggle(shortcutMode)
    }
    ipc.on('global-keyboard', handler)
    return () => { ipc.removeListener('global-keyboard', handler) }
  }, [handleToggle])

  const handleCopy = () => {
    const text = refinedText || rawText
    if (!text) return
    const ipc = (window as any).ipcRenderer
    if (ipc) ipc.invoke('clipboard:write-text', text)
    else navigator.clipboard.writeText(text)
  }

  return (
    <Box sx={{ maxWidth: 980, mx: 'auto', p: 3, display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* 页面头部 */}
      <Box>
        <Typography sx={{ fontSize: 24, fontWeight: 500 }}>Home</Typography>
        <Typography sx={{ fontSize: 14, color: '#5d5d5d', mt: 0.5 }}>
          按住{' '}
          <Box component="kbd" sx={{ bgcolor: 'rgba(119,119,119,0.08)', borderRadius: '5px', px: '5px', py: '2px', fontWeight: 500 }}>
            Right Alt
          </Box>{' '}
          或按{' '}
          <Box component="kbd" sx={{ bgcolor: 'rgba(119,119,119,0.08)', borderRadius: '5px', px: '5px', py: '2px', fontWeight: 500 }}>
            Alt+Space
          </Box>{' '}
          开始听写
        </Typography>
      </Box>

      {/* 统计卡片区域 */}
      <Box sx={{ borderRadius: '16px', bgcolor: 'rgba(119,119,119,0.05)', p: 2, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
        <Box sx={{ ...card, p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography sx={{ fontSize: 28, fontWeight: 600 }}>23.4%</Typography>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>Overall personalization</Typography>
          </Box>
          <Box sx={{ width: 56, height: 56, borderRadius: '50%', background: `conic-gradient(#44bedf 0% 23.4%, #e8e8e8 23.4% 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
            <Box key={item.label} sx={{ ...card, p: '12px' }}>
              <Typography sx={{ fontSize: 18, fontWeight: 600 }}>{item.value}</Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{item.label}</Typography>
            </Box>
          ))}
        </Box>
      </Box>

      {/* 录音控件区 + 结果展示区 */}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}>
        {/* 左列录音卡片 */}
        <Box sx={{ ...card, p: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 500, alignSelf: 'flex-start' }}>Voice dictation</Typography>
          <Box sx={{ display: 'flex', bgcolor: 'rgba(119,119,119,0.08)', borderRadius: '20px', p: '3px' }}>
            {modes.map((m) => (
              <Box
                key={m}
                onClick={() => setActiveMode(m)}
                sx={{ px: 2, py: 0.5, borderRadius: '16px', fontSize: 13, cursor: 'pointer', fontWeight: 500, bgcolor: activeMode === m ? '#fff' : 'transparent', boxShadow: activeMode === m ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}
              >
                {m}
              </Box>
            ))}
          </Box>
          {/* 录音按钮 */}
          <IconButton
            onClick={() => handleToggle()}
            sx={{ width: 68, height: 68, bgcolor: recording ? '#e53935' : '#111', color: '#fff', '&:hover': { bgcolor: recording ? '#c62828' : '#333' } }}
          >
            <MicIcon sx={{ fontSize: 28 }} />
          </IconButton>
          <Typography sx={{ fontSize: 13, color: 'rgba(17,17,17,0.5)' }}>{status}</Typography>
        </Box>

        {/* 右列结果卡片 */}
        <Box sx={{ ...card, p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography sx={{ fontSize: 16, fontWeight: 500 }}>Latest result</Typography>
            <IconButton size="small" onClick={handleCopy}><ContentCopyIcon sx={{ fontSize: 16 }} /></IconButton>
          </Box>
          {/* 原始转写区 */}
          <Box sx={{ bgcolor: 'rgba(119,119,119,0.06)', borderRadius: '12px', p: 1.5, minHeight: 48 }}>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{rawText || '—'}</Typography>
          </Box>
          {/* 润色结果区 */}
          <Box sx={{ bgcolor: 'rgba(119,119,119,0.03)', borderRadius: '12px', p: 1.5, minHeight: 64 }}>
            <Typography sx={{ fontSize: 15 }}>{refinedText || '—'}</Typography>
          </Box>
        </Box>
      </Box>

      {/* 历史记录区 */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 500 }}>Recent history</Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>0</Typography>
        </Box>
        <Box sx={{ ...card, p: 3, textAlign: 'center' }}>
          <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>暂无历史记录</Typography>
        </Box>
      </Box>
    </Box>
  )
}
