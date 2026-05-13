import { Box, Typography, Button } from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'

const checks = ['系统信息检查', '麦克风测试', '快捷键测试', '网络连接测试']

export default function Diagnostics() {
  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', p: 3, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Typography sx={{ fontSize: 24, fontWeight: 500, mb: 2 }}>Diagnostics</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
        {checks.map((name) => (
          <Box
            key={name}
            sx={{ bgcolor: '#fff', borderRadius: '12px', p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Typography>{name}</Typography>
            <CheckCircleIcon sx={{ color: 'green' }} />
          </Box>
        ))}
      </Box>
      <Button variant="contained" sx={{ bgcolor: '#000', borderRadius: 9999, alignSelf: 'center', mt: 3, '&:hover': { bgcolor: '#222' } }}>
        运行诊断
      </Button>
    </Box>
  )
}
