import { useState } from 'react'
import { Box, Typography, Button } from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import BugReportIcon from '@mui/icons-material/BugReport'
import { runDiagnostics, type DiagnosticItem } from '../services/diagnostics'

const iconByStatus = {
  ok: <CheckCircleIcon sx={{ color: 'green' }} />,
  warning: <WarningAmberIcon sx={{ color: '#b7791f' }} />,
  error: <BugReportIcon sx={{ color: '#c62828' }} />,
}

export default function Diagnostics() {
  const [items, setItems] = useState<DiagnosticItem[]>([])
  const [loading, setLoading] = useState(false)

  const handleRun = async () => {
    setLoading(true)
    try {
      setItems(await runDiagnostics())
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', p: 3, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Typography sx={{ fontSize: 24, fontWeight: 500, mb: 2 }}>Diagnostics</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
        {items.length === 0 ? (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography sx={{ color: 'text.secondary' }}>点击下方按钮运行诊断</Typography>
          </Box>
        ) : (
          items.map((item) => (
            <Box
              key={item.name}
              sx={{ bgcolor: '#fff', borderRadius: '12px', p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <Box>
                <Typography>{item.name}</Typography>
                <Typography sx={{ fontSize: 13, color: item.status === 'error' ? '#c62828' : 'text.secondary' }}>
                  {item.message}
                </Typography>
              </Box>
              {iconByStatus[item.status]}
            </Box>
          ))
        )}
      </Box>
      <Button
        variant="contained"
        onClick={handleRun}
        disabled={loading}
        sx={{ bgcolor: '#000', borderRadius: 9999, alignSelf: 'center', mt: 3, '&:hover': { bgcolor: '#222' } }}
      >
        {loading ? '诊断中...' : '运行诊断'}
      </Button>
    </Box>
  )
}
