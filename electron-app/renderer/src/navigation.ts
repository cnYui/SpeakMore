export type Page = 'home' | 'history' | 'settings' | 'diagnostics'

export const pages: { label: string; page: Page }[] = [
  { label: 'Home', page: 'home' },
  { label: 'History', page: 'history' },
  { label: 'Settings', page: 'settings' },
  { label: 'Diagnostics', page: 'diagnostics' },
]
