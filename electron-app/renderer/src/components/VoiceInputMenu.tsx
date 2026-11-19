/**
 * 顶栏“语音输入”菜单
 *
 * 不用快捷键也能直接开始一轮听写 / 自由提问 / 语音翻译；入口和快捷键走同一个 recorder，录音中点它就是停止。
 * 和 macOS 原生版主窗口工具栏的“语音输入”菜单一致。
 */
import { useState } from 'react'
import { Box, ButtonBase, Menu, MenuItem } from '@mui/material'
import MicIcon from '@mui/icons-material/Mic'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import { useI18n } from '../i18n'
import { toggleRecording } from '../services/recorder'
import type { VoiceMode } from '../services/voice/voiceTypes'

const items: { mode: VoiceMode; labelKey: 'toolbar.dictate' | 'toolbar.ask' | 'toolbar.translate' }[] = [
  { mode: 'Dictate', labelKey: 'toolbar.dictate' },
  { mode: 'Ask', labelKey: 'toolbar.ask' },
  { mode: 'Translate', labelKey: 'toolbar.translate' },
]

export default function VoiceInputMenu() {
  const { t } = useI18n()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  return (
    <>
      <ButtonBase
        className="glass-lens"
        onClick={(event) => setAnchor(event.currentTarget)}
        aria-haspopup="menu"
        aria-expanded={anchor ? 'true' : undefined}
        sx={{
          height: 34,
          px: '14px',
          gap: 0.75,
          borderRadius: 9999,
          fontSize: 13,
          fontWeight: 500,
          color: 'text.primary',
          // 拖动区域里的按钮必须声明 no-drag，否则点不到。
          WebkitAppRegion: 'no-drag',
        }}
      >
        <MicIcon sx={{ fontSize: 17, color: 'primary.main' }} />
        <Box component="span">{t('toolbar.voiceInput')}</Box>
        <KeyboardArrowDownIcon sx={{ fontSize: 17, color: 'text.secondary' }} />
      </ButtonBase>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { mt: 0.75, minWidth: 168 } } }}
      >
        {items.map((item) => (
          <MenuItem
            key={item.mode}
            onClick={() => {
              setAnchor(null)
              void toggleRecording(item.mode)
            }}
          >
            {t(item.labelKey)}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
