import { createTheme } from '@mui/material/styles'

export const theme = createTheme({
  typography: {
    fontFamily: 'Prompt, SF Pro, -apple-system, BlinkMacSystemFont, Arial, sans-serif',
    fontSize: 14,
    body1: {
      fontSize: 14,
      lineHeight: 1.45,
    },
    body2: {
      fontSize: 13,
      lineHeight: 1.45,
    },
    button: {
      fontSize: 14,
      textTransform: 'none',
    },
  },
  palette: {
    background: {
      default: 'rgba(242, 241, 240, 1)',
      paper: '#ffffff',
    },
    text: {
      primary: '#111111',
      secondary: 'rgba(17, 17, 17, 0.75)',
      disabled: 'rgba(17, 17, 17, 0.5)',
    },
    divider: 'rgba(119, 119, 119, 0.15)',
    primary: {
      main: '#1d1a1a',
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
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 9999,
        },
      },
    },
  },
})
