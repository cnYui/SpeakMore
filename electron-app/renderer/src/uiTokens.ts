export const cardSx = {
  bgcolor: '#fff',
  borderRadius: '16px',
  border: '1px solid rgba(119,119,119,0.08)',
}

export const subtlePanelSx = {
  bgcolor: 'rgba(119,119,119,0.05)',
  borderRadius: '16px',
}

export const pageSx = {
  p: 3,
}

export const adaptivePageSx = {
  ...pageSx,
  p: { xs: 2, md: 2.5, xl: 3 },
  width: '100%',
  maxWidth: 'none',
  minHeight: '100%',
  boxSizing: 'border-box',
}

export const adaptiveTwoColumnGridSx = {
  display: 'grid',
  gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' },
}

export const adaptiveAutoGridSx = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))',
}

export const pageTitleSx = {
  fontSize: 24,
  fontWeight: 500,
}

export const pageDescriptionSx = {
  fontSize: 14,
  fontWeight: 400,
  lineHeight: 1.5,
}

export const sectionTitleSx = {
  fontSize: 16,
  fontWeight: 500,
}

export const itemTitleSx = {
  fontSize: 15,
  fontWeight: 600,
}

export const metricValueSx = {
  ...itemTitleSx,
  fontSize: 18,
}

export const bodyTextSx = {
  fontSize: 14,
  fontWeight: 400,
  lineHeight: 1.45,
}

export const helperTextSx = {
  fontSize: 13,
  fontWeight: 400,
  lineHeight: 1.45,
}

export const captionTextSx = {
  fontSize: 12,
  fontWeight: 400,
  lineHeight: 1.35,
}

export const navTextSx = {
  fontSize: 14.5,
  fontWeight: 700,
  letterSpacing: 0,
  lineHeight: 1,
}

export const overlayCardSx = {
  bgcolor: '#fff',
  borderRadius: '12px',
  border: '1px solid rgba(119,119,119,0.12)',
  boxShadow: '0 16px 36px rgba(17,17,17,0.16), 0 4px 12px rgba(17,17,17,0.08)',
}

export const shortcutChipSx = {
  borderRadius: '6px',
  border: '1px solid rgba(119,119,119,0.12)',
  px: 1,
  py: 0.5,
  fontSize: '13px',
  display: 'inline-flex',
  alignItems: 'center',
}
