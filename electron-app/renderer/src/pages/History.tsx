import { useMemo, useState } from 'react'
import { Box, TextField, Typography, Button, IconButton } from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { listVoiceHistory, clearVoiceHistory } from '../services/historyStore'
import { ipcClient } from '../services/ipc'

export default function History() {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState(listVoiceHistory())

  const filteredItems = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return items
    return items.filter((item) => item.rawText.toLowerCase().includes(keyword) || item.refinedText.toLowerCase().includes(keyword))
  }, [items, query])

  const handleCopy = (text: string) => {
    if (!text) return
    ipcClient.invoke('clipboard:write-text', text).catch(() => navigator.clipboard.writeText(text))
  }

  const handleClear = () => {
    clearVoiceHistory()
    setItems([])
  }

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', p: 3, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Typography sx={{ fontSize: 24, fontWeight: 500, mb: 2 }}>历史记录</Typography>
      <TextField
        placeholder="搜索历史记录..."
        size="small"
        fullWidth
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        sx={{ mb: 3, '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
      />
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {filteredItems.length === 0 ? (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography sx={{ color: 'text.secondary' }}>暂无历史记录</Typography>
          </Box>
        ) : (
          filteredItems.map((item) => (
            <Box
              key={item.id}
              sx={{ bgcolor: '#fff', borderRadius: '12px', border: '1px solid rgba(119,119,119,0.08)', p: 2 }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                  {new Date(item.createdAt).toLocaleString()}
                </Typography>
                <IconButton size="small" onClick={() => handleCopy(item.refinedText || item.rawText)}>
                  <ContentCopyIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Box>
              <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 1 }}>{item.rawText || '-'}</Typography>
              <Typography sx={{ fontSize: 15 }}>{item.refinedText || '-'}</Typography>
            </Box>
          ))
        )}
      </Box>
      <Button sx={{ color: 'red', alignSelf: 'center', mt: 2 }} onClick={handleClear}>清除所有历史</Button>
    </Box>
  )
}
