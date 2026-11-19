import { createTheme } from '@mui/material/styles'

/** 玻璃表面（弹出菜单、对话框等浮层）：半透明填充 + 背景模糊 + 高光边，样式变量见 glass.css。 */
const glassPaper = {
  background: 'var(--glass-fill-strong)',
  WebkitBackdropFilter: 'var(--glass-blur)',
  backdropFilter: 'var(--glass-blur)',
  border: '1px solid var(--glass-border)',
  boxShadow: 'var(--glass-highlight), 0 18px 44px rgba(30, 40, 70, 0.18), 0 3px 10px rgba(30, 40, 70, 0.08)',
  borderRadius: 18,
  backgroundImage: 'none',
}

export const theme = createTheme({
  typography: {
    fontFamily: '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", system-ui, -apple-system, sans-serif',
    // 字号规范见 uiTokens.ts：正文 14、说明 12；没写字号的 <Typography> 是 body1。
    fontSize: 14,
    body1: { fontSize: 14, lineHeight: 1.5 },
    body2: { fontSize: 12, lineHeight: 1.5 },
    caption: { fontSize: 12, lineHeight: 1.5 },
    button: { textTransform: 'none', fontWeight: 500, fontSize: 14 },
  },
  palette: {
    background: {
      default: 'transparent',
      paper: 'transparent',
    },
    text: {
      primary: '#111111',
      secondary: 'rgba(17, 17, 17, 0.68)',
      disabled: 'rgba(17, 17, 17, 0.45)',
    },
    divider: 'rgba(60, 70, 100, 0.12)',
    primary: {
      main: '#0a84ff',
    },
    info: {
      main: '#5f5f5f',
    },
    error: {
      main: '#c62828',
    },
  },
  shape: {
    borderRadius: 16,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        'html, body': { background: 'transparent' },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: glassPaper,
      },
    },
    MuiMenu: {
      styleOverrides: {
        list: { padding: 6 },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          fontSize: 14,
          '&:hover': { background: 'rgba(255, 255, 255, 0.6)' },
          '&.Mui-selected': { background: 'rgba(10, 132, 255, 0.16)' },
          '&.Mui-selected:hover': { background: 'rgba(10, 132, 255, 0.22)' },
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 9999,
          paddingInline: 16,
          transition: 'background 160ms ease, box-shadow 160ms ease, transform 160ms ease',
          '&:active': { transform: 'scale(0.98)' },
        },
        contained: {
          color: '#fff',
          background: 'linear-gradient(180deg, rgba(86, 170, 255, 0.96), rgba(10, 132, 255, 0.90))',
          border: '1px solid rgba(255, 255, 255, 0.55)',
          boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.55), 0 6px 16px rgba(10, 132, 255, 0.28), 0 1px 3px rgba(10, 80, 200, 0.25)',
          '&:hover': {
            background: 'linear-gradient(180deg, rgba(106, 182, 255, 0.98), rgba(30, 144, 255, 0.94))',
          },
          '&.Mui-disabled': {
            color: 'rgba(255, 255, 255, 0.85)',
            background: 'rgba(10, 132, 255, 0.35)',
            boxShadow: 'none',
          },
        },
        outlined: {
          color: '#111',
          background: 'var(--glass-fill-flat)',
          WebkitBackdropFilter: 'var(--glass-blur-light)',
          backdropFilter: 'var(--glass-blur-light)',
          border: '1px solid var(--glass-border)',
          boxShadow: 'var(--glass-highlight), var(--glass-shadow-small)',
          '&:hover': { background: 'var(--glass-fill-strong)', border: '1px solid var(--glass-border)' },
          '&.Mui-disabled': { background: 'rgba(255, 255, 255, 0.25)', border: '1px solid rgba(255, 255, 255, 0.4)' },
        },
        text: {
          '&:hover': { background: 'rgba(255, 255, 255, 0.5)' },
        },
        sizeSmall: { fontSize: 12 },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          '&:hover': { background: 'rgba(255, 255, 255, 0.6)' },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 9999,
          fontWeight: 500,
          fontSize: 12,
        },
        outlined: {
          background: 'var(--glass-fill-flat)',
          border: '1px solid var(--glass-border)',
          boxShadow: 'var(--glass-highlight)',
        },
        filled: {
          background: 'var(--glass-fill-flat)',
          border: '1px solid var(--glass-border)',
          boxShadow: 'var(--glass-highlight)',
        },
        colorPrimary: {
          '&.MuiChip-filled': {
            color: '#fff',
            background: 'linear-gradient(180deg, rgba(86, 170, 255, 0.96), rgba(10, 132, 255, 0.90))',
          },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          fontSize: 14,
          background: 'var(--glass-fill-flat)',
          WebkitBackdropFilter: 'var(--glass-blur-light)',
          backdropFilter: 'var(--glass-blur-light)',
          boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.8)',
          '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--glass-border)' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(10, 132, 255, 0.45)' },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--glass-accent)', borderWidth: 1.5 },
        },
      },
    },
    MuiToggleButtonGroup: {
      styleOverrides: {
        root: {
          background: 'var(--glass-fill-flat)',
          border: '1px solid var(--glass-border)',
          borderRadius: 9999,
          padding: 3,
          boxShadow: 'var(--glass-highlight)',
          gap: 2,
        },
        grouped: {
          border: 0,
          borderRadius: '9999px !important',
          paddingInline: 14,
          // 小号分段按钮的文字是 12（规范里小按钮 = caption），默认号是 14。
          fontSize: 14,
          '&.MuiToggleButton-sizeSmall': { fontSize: 12 },
          '&.Mui-selected': {
            background: 'var(--glass-fill-strong)',
            boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.95), 0 2px 8px rgba(30, 40, 70, 0.14)',
            color: '#111',
          },
        },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { height: 8, borderRadius: 9999, background: 'rgba(60, 70, 100, 0.12)' },
        bar: { borderRadius: 9999 },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          background: 'rgba(30, 34, 46, 0.78)',
          WebkitBackdropFilter: 'blur(14px)',
          backdropFilter: 'blur(14px)',
          borderRadius: 10,
          fontSize: 12,
        },
      },
    },
  },
})
