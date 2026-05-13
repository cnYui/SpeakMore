import { Box, Typography, Select, MenuItem, Switch, Button } from '@mui/material';

const keybindChip = {
  borderRadius: '6px',
  border: '1px solid rgba(119,119,119,0.12)',
  padding: '4px 8px',
  fontSize: '13px',
  display: 'inline-block',
};

const rowSx = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 0',
  borderBottom: '1px solid rgba(119,119,119,0.08)',
};

const sectionTitle = { fontSize: 16, fontWeight: 500, mt: 3, mb: 1 };

function KeyChips({ keys }: { keys: string[] }) {
  return (
    <Box sx={{ display: 'flex', gap: 0.5 }}>
      {keys.map((k) => (
        <Box key={k} component="span" sx={keybindChip}>{k}</Box>
      ))}
    </Box>
  );
}

export default function Settings() {
  return (
    <Box sx={{ maxWidth: 680, p: 3 }}>
      <Typography sx={{ fontSize: 24, fontWeight: 500, mb: 2 }}>Settings</Typography>

      {/* 快捷键 */}
      <Typography sx={sectionTitle}>Keyboard shortcuts</Typography>
      <Box sx={rowSx}>
        <Typography>按下开始和停止语音输入。</Typography>
        <KeyChips keys={['Right Alt']} />
      </Box>
      <Box sx={rowSx}>
        <Typography>按下开始和停止随便提问。</Typography>
        <KeyChips keys={['Right Alt', 'Space']} />
      </Box>
      <Box sx={rowSx}>
        <Typography>按下开始和停止翻译。</Typography>
        <KeyChips keys={['Right Alt', 'Right Shift']} />
      </Box>

      {/* 麦克风 */}
      <Typography sx={sectionTitle}>Microphone</Typography>
      <Box sx={rowSx}>
        <Select size="small" value="default" sx={{ minWidth: 200 }}>
          <MenuItem value="default">系统默认</MenuItem>
        </Select>
      </Box>

      {/* 语言 */}
      <Typography sx={sectionTitle}>Language</Typography>
      <Box sx={rowSx}>
        <Typography>简体中文 (zh-CN)</Typography>
      </Box>

      {/* 其他设置 */}
      <Box sx={rowSx}>
        <Typography>开机启动</Typography>
        <Switch defaultChecked />
      </Box>
      <Box sx={rowSx}>
        <Typography>声音效果</Typography>
        <Switch defaultChecked />
      </Box>
      <Box sx={rowSx}>
        <Typography>显示悬浮条</Typography>
        <Switch defaultChecked />
      </Box>

      {/* 关于 */}
      <Box sx={{ ...rowSx, mt: 3 }}>
        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>Version v1.3.0-local</Typography>
        <Button variant="outlined" size="small">检查更新</Button>
      </Box>
    </Box>
  );
}
