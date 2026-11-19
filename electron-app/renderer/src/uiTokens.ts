/**
 * 字号规范（全项目统一，Windows 与 macOS 原生版一致）
 *
 * 只有 5 个字号，页面里不要再写死数字，直接用下面的 token：
 *
 *   title    24 / 600  页面标题（每页只有一个）
 *   stat     20 / 600  大数字（统计值）
 *   heading  16 / 600  卡片 / 区块标题、侧边栏产品名
 *   body     14 / 400  正文、表单行、列表内容、按钮、输入框、菜单、导航（强调用 bodyMedium 500 / bodyStrong 600）
 *   caption  12 / 400  说明、提示、日期、状态标签、键帽
 *
 * 字重只用 400 / 500 / 600。图标尺寸不属于字号：行内小图标 16，导航 / 操作图标 18。
 * MUI 的默认字号（正文 body1、输入框、按钮、芯片等）在 theme.ts 里按这套规范覆盖，所以没写字号的 <Typography> 就是 body。
 */
export const typo = {
  title: { fontSize: 24, fontWeight: 600, lineHeight: 1.3, letterSpacing: '-0.01em' },
  stat: { fontSize: 20, fontWeight: 600, lineHeight: 1.25 },
  heading: { fontSize: 16, fontWeight: 600, lineHeight: 1.4 },
  body: { fontSize: 14, fontWeight: 400, lineHeight: 1.5 },
  bodyMedium: { fontSize: 14, fontWeight: 500, lineHeight: 1.5 },
  bodyStrong: { fontSize: 14, fontWeight: 600, lineHeight: 1.5 },
  caption: { fontSize: 12, fontWeight: 400, lineHeight: 1.5 },
} as const

export const iconSize = { inline: 16, standard: 18 } as const

/**
 * 界面样式 token（Liquid Glass 风格）
 *
 * 需要统一卡片、面板、键帽等玻璃表面样式时看这里；玻璃变量（填充、模糊、高光边、阴影）定义在 glass.css。
 */
const glassSurface = {
  background: 'var(--glass-fill)',
  WebkitBackdropFilter: 'var(--glass-blur)',
  backdropFilter: 'var(--glass-blur)',
  border: '1px solid var(--glass-border)',
  boxShadow: 'var(--glass-highlight), var(--glass-shadow)',
}

/** 条目 / 行级的玻璃：不开背景模糊（成批出现时太费 GPU），只保留半透明填充和高光边。 */
const glassFlatSurface = {
  background: 'var(--glass-fill-flat)',
  border: '1px solid var(--glass-border)',
  boxShadow: 'var(--glass-highlight), var(--glass-shadow-small)',
}

export const cardSx = {
  ...glassSurface,
  borderRadius: '22px',
}

/** 成组卡片外面的容器：玻璃卡片放在玻璃容器里会糊成一团，所以容器本身不画任何东西。 */
export const subtlePanelSx = {
  borderRadius: '26px',
}

export const glassItemSx = {
  ...glassFlatSurface,
  borderRadius: '16px',
}

/** 设置页 / 初始化页的一整段内容：玻璃卡片。 */
export const glassSectionSx = {
  ...glassSurface,
  borderRadius: '22px',
  px: 2.5,
  py: 2,
  mb: 2,
}

export const pageSx = {
  p: 3,
}

export const pageTitleSx = {
  ...typo.title,
}

export const overlayCardSx = {
  ...glassSurface,
  borderRadius: '18px',
  boxShadow: 'var(--glass-highlight), 0 16px 36px rgba(17,17,17,0.16), 0 4px 12px rgba(17,17,17,0.08)',
}

/** 键帽：小玻璃块（带边缘折射，见 glass.css 的 .glass-lens）。 */
export const shortcutChipSx = {
  borderRadius: '9px',
  px: '8px',
  py: '2px',
  ...typo.caption,
  fontWeight: 500,
  display: 'inline-flex',
  alignItems: 'center',
  background: 'var(--glass-fill-strong)',
  border: '1px solid var(--glass-border)',
  boxShadow: 'var(--glass-highlight), var(--glass-shadow-small)',
}
