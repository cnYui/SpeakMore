import { Box, TextField, Typography, Button } from '@mui/material'

export default function History() {
  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', p: 3, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Typography sx={{ fontSize: 24, fontWeight: 500, mb: 2 }}>History</Typography>
      <TextField
        placeholder="搜索历史记录..."
        size="small"
        fullWidth
        sx={{ mb: 3, '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
      />
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography sx={{ color: 'text.secondary' }}>暂无历史记录</Typography>
      </Box>
      <Button sx={{ color: 'red', alignSelf: 'center', mt: 2 }}>清除所有历史</Button>
    </Box>
  )
}
