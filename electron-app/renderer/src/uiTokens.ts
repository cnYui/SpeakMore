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
  fontSize: 24,
  fontWeight: 600,
  letterSpacing: '-0.01em',
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
  fontSize: '13px',
  fontWeight: 500,
  display: 'inline-flex',
  alignItems: 'center',
  background: 'var(--glass-fill-strong)',
  border: '1px solid var(--glass-border)',
  boxShadow: 'var(--glass-highlight), var(--glass-shadow-small)',
}
