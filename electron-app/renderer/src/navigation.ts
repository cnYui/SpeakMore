export type Page = 'home' | 'history' | 'settings' | 'diagnostics'

export const pages: { label: string; page: Page }[] = [
  { label: '首页', page: 'home' },
  { label: '历史记录', page: 'history' },
  { label: '设置', page: 'settings' },
  { label: '诊断', page: 'diagnostics' },
]
