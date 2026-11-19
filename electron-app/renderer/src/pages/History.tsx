import { useEffect, useMemo, useState } from 'react'
import { Box, TextField, Typography, Button, IconButton } from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { listVoiceHistory, clearVoiceHistory, VOICE_HISTORY_UPDATED_EVENT } from '../services/historyStore'
import { ipcClient } from '../services/ipc'
import { useI18n } from '../i18n'
import { glassItemSx, pageSx, pageTitleSx } from '../uiTokens'

export default function History() {
  const { language, t } = useI18n()
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<Awaited<ReturnType<typeof listVoiceHistory>>>([])

  useEffect(() => {
    const refreshHistory = () => {
      listVoiceHistory().then(setItems).catch(() => setItems([]))
    }

    refreshHistory()
    window.addEventListener(VOICE_HISTORY_UPDATED_EVENT, refreshHistory)
    return () => window.removeEventListener(VOICE_HISTORY_UPDATED_EVENT, refreshHistory)
  }, [])

  const filteredItems = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return items
    return items.filter((item) => item.rawText.toLowerCase().includes(keyword) || item.refinedText.toLowerCase().includes(keyword))
  }, [items, query])

  const handleCopy = (text: string) => {
    if (!text) return
    ipcClient.invoke('clipboard:write-text', text).catch(() => navigator.clipboard.writeText(text))
  }

  const handleClear = async () => {
    await clearVoiceHistory()
    setItems([])
  }

  return (
    <Box sx={{ ...pageSx, maxWidth: 800, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Typography sx={{ ...pageTitleSx, mb: 2 }}>{t('history.title')}</Typography>
      <TextField
        placeholder={t('history.searchPlaceholder')}
        size="small"
        fullWidth
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        sx={{ mb: 3, '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
      />
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {filteredItems.length === 0 ? (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography sx={{ color: 'text.secondary' }}>{t('history.empty')}</Typography>
          </Box>
        ) : (
          filteredItems.map((item) => (
            <Box
              key={item.id}
              sx={{ ...glassItemSx, p: 2 }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                  {new Date(item.createdAt).toLocaleString(language)}
                </Typography>
                <IconButton
                  size="small"
                  aria-label={t('history.copyResult')}
                  onClick={() => handleCopy(item.refinedText || item.rawText)}
                >
                  <ContentCopyIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Box>
              <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 1 }}>{item.rawText || '-'}</Typography>
              <Typography sx={{ fontSize: 15 }}>{item.refinedText || '-'}</Typography>
            </Box>
          ))
        )}
      </Box>
      <Button sx={{ color: 'red', alignSelf: 'center', mt: 2 }} onClick={handleClear}>{t('history.clearAll')}</Button>
    </Box>
  )
}
