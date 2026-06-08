import CloseIcon from '@mui/icons-material/Close'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteIcon from '@mui/icons-material/Delete'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import RefreshIcon from '@mui/icons-material/Refresh'
import SearchIcon from '@mui/icons-material/Search'
import {
  Box,
  Button,
  Dialog,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { useI18n } from '../../i18n'
import type { VoiceHistoryItem } from '../../services/historyStore'
import type { RecentDashboardResult } from '../../services/recentDashboardResults'
import { bodyTextSx, captionTextSx, helperTextSx, sectionTitleSx } from '../../uiTokens'

type HistoryDisplayItem = {
  id: string
  createdAt: string
  text: string
  status: 'completed' | 'error'
  retryable?: boolean
  rawText?: string
  refinedText?: string
  errorMessage?: string
  errorCode?: string
}

type HistoryResultsPanelProps = {
  recentResults: RecentDashboardResult[]
  historyItems: VoiceHistoryItem[]
  modalOpen: boolean
  retryingId: string
  onOpenModal: () => void
  onCloseModal: () => void
  onCopy: (text: string) => void
  onDelete: (id: string) => void
  onRetry: (id: string) => void
}

function historyItemText(item: VoiceHistoryItem) {
  if (item.status === 'error') {
    return (item.errorMessage || item.errorCode || item.refinedText || item.rawText).trim()
  }
  return (item.refinedText || item.rawText).trim()
}

function toDisplayItem(item: VoiceHistoryItem): HistoryDisplayItem | null {
  const text = historyItemText(item)
  if (!text) return null
  return {
    id: item.id,
    createdAt: item.createdAt,
    text,
    status: item.status,
    retryable: item.retryable,
    rawText: item.rawText,
    refinedText: item.refinedText,
    errorMessage: item.errorMessage,
    errorCode: item.errorCode,
  }
}

function recentToDisplayItem(item: RecentDashboardResult): HistoryDisplayItem {
  return {
    id: item.id,
    createdAt: item.createdAt,
    text: item.text,
    status: item.status,
    retryable: item.retryable,
    errorMessage: item.errorMessage,
  }
}

function formatTime(value: string, language: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })
}

function dateKey(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function formatDateGroup(value: string, language: string, todayLabel: string, yesterdayLabel: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (dateKey(value) === dateKey(today.toISOString())) return todayLabel
  if (dateKey(value) === dateKey(yesterday.toISOString())) return yesterdayLabel
  return date.toLocaleDateString(language, { month: 'short', day: 'numeric', weekday: 'short' })
}

function groupItems(items: HistoryDisplayItem[]) {
  const groups: Array<{ key: string; firstCreatedAt: string; items: HistoryDisplayItem[] }> = []
  for (const item of items) {
    const key = dateKey(item.createdAt)
    const group = groups.find((candidate) => candidate.key === key)
    if (group) {
      group.items.push(item)
    } else {
      groups.push({ key, firstCreatedAt: item.createdAt, items: [item] })
    }
  }
  return groups
}

function HistoryResultRow({
  item,
  retrying,
  onCopy,
  onDelete,
  onRetry,
}: {
  item: HistoryDisplayItem
  retrying: boolean
  onCopy: (text: string) => void
  onDelete: (id: string) => void
  onRetry: (id: string) => void
}) {
  const { t, language } = useI18n()
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const isError = item.status === 'error'

  const closeMenu = () => setMenuAnchor(null)

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '52px minmax(0, 1fr) auto', sm: '64px minmax(0, 1fr) auto' },
        alignItems: 'start',
        gap: 1,
        px: 1.5,
        py: 1.25,
        borderBottom: '1px solid rgba(17,17,17,0.07)',
        '&:last-of-type': { borderBottom: 0 },
      }}
    >
      <Typography sx={{ ...captionTextSx, color: '#8a8a8a', pt: '2px' }}>
        {formatTime(item.createdAt, language)}
      </Typography>
      <Typography
        sx={{
          ...bodyTextSx,
          color: isError ? '#d93025' : '#252525',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {item.text}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
        {item.retryable ? (
          <Button
            size="small"
            startIcon={<RefreshIcon sx={{ fontSize: 15 }} />}
            disabled={retrying}
            onClick={() => onRetry(item.id)}
            sx={{
              minWidth: 0,
              height: 28,
              px: 0.75,
              color: '#111827',
              fontSize: 12,
              borderRadius: '7px',
              textTransform: 'none',
            }}
          >
            {retrying ? t('dashboard.history.retrying') : t('dashboard.history.retry')}
          </Button>
        ) : null}
        <IconButton
          size="small"
          aria-label={t('dashboard.history.menuLabel')}
          onClick={(event) => setMenuAnchor(event.currentTarget)}
          sx={{ width: 28, height: 28 }}
        >
          <MoreVertIcon sx={{ fontSize: 17 }} />
        </IconButton>
      </Box>
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        <MenuItem
          onClick={() => {
            closeMenu()
            onCopy(item.text)
          }}
        >
          <ContentCopyIcon sx={{ fontSize: 16, mr: 1 }} />
          {t('dashboard.history.copy')}
        </MenuItem>
        <MenuItem
          onClick={() => {
            closeMenu()
            onDelete(item.id)
          }}
        >
          <DeleteIcon sx={{ fontSize: 16, mr: 1 }} />
          {t('dashboard.history.delete')}
        </MenuItem>
      </Menu>
    </Box>
  )
}

function HistoryResultGroups({
  items,
  retryingId,
  onCopy,
  onDelete,
  onRetry,
}: {
  items: HistoryDisplayItem[]
  retryingId: string
  onCopy: (text: string) => void
  onDelete: (id: string) => void
  onRetry: (id: string) => void
}) {
  const { t, language } = useI18n()
  const groups = groupItems(items)

  if (!items.length) {
    return (
      <Box sx={{ px: 1.5, py: 2 }}>
        <Typography sx={{ ...helperTextSx, color: 'text.secondary' }}>{t('dashboard.history.empty')}</Typography>
      </Box>
    )
  }

  return (
    <Box>
      {groups.map((group) => (
        <Box key={group.key}>
          <Typography sx={{ ...captionTextSx, color: '#7b7b7b', px: 1.5, pt: 1.25, pb: 0.5, fontWeight: 500 }}>
            {formatDateGroup(
              group.firstCreatedAt,
              language,
              t('dashboard.history.today'),
              t('dashboard.history.yesterday'),
            )}
          </Typography>
          <Box>
            {group.items.map((item) => (
              <HistoryResultRow
                key={item.id}
                item={item}
                retrying={retryingId === item.id}
                onCopy={onCopy}
                onDelete={onDelete}
                onRetry={onRetry}
              />
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

export default function HistoryResultsPanel({
  recentResults,
  historyItems,
  modalOpen,
  retryingId,
  onOpenModal,
  onCloseModal,
  onCopy,
  onDelete,
  onRetry,
}: HistoryResultsPanelProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const recentDisplayItems = useMemo(() => recentResults.map(recentToDisplayItem), [recentResults])
  const modalDisplayItems = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const items = historyItems.map(toDisplayItem).filter((item): item is HistoryDisplayItem => Boolean(item))
    if (!keyword) return items
    return items.filter((item) => [
      item.text,
      item.rawText,
      item.refinedText,
      item.errorMessage,
      item.errorCode,
    ].some((value) => String(value || '').toLowerCase().includes(keyword)))
  }, [historyItems, query])

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography sx={sectionTitleSx}>{t('dashboard.recentResults')}</Typography>
        <Button
          size="small"
          onClick={onOpenModal}
          sx={{ color: '#111827', fontSize: 13, fontWeight: 500, minWidth: 0, px: 0.75 }}
        >
          {t('dashboard.history.viewMore')}
        </Button>
      </Box>
      <Box sx={{ bgcolor: 'rgba(119,119,119,0.03)', borderRadius: '12px', minHeight: 64, overflow: 'hidden' }}>
        <HistoryResultGroups
          items={recentDisplayItems}
          retryingId={retryingId}
          onCopy={onCopy}
          onDelete={onDelete}
          onRetry={onRetry}
        />
      </Box>

      <Dialog
        open={modalOpen}
        onClose={onCloseModal}
        fullWidth
        maxWidth="md"
        slotProps={{
          backdrop: { sx: { bgcolor: 'rgba(17,17,17,0.42)' } },
          paper: {
            sx: {
              borderRadius: '18px',
              boxShadow: '0 24px 70px rgba(17,17,17,0.2)',
              overflow: 'hidden',
            },
          },
        }}
      >
        <Box sx={{ p: 2, pb: 1.25, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography sx={{ ...sectionTitleSx, fontSize: 18 }}>{t('dashboard.history.title')}</Typography>
          <IconButton aria-label={t('dashboard.history.close')} onClick={onCloseModal} sx={{ width: 32, height: 32 }}>
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>
        <Box sx={{ px: 2, pb: 1.25 }}>
          <TextField
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('dashboard.history.searchPlaceholder')}
            fullWidth
            size="small"
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: 17, color: '#8a8a8a' }} />
                  </InputAdornment>
                ),
              },
            }}
          />
        </Box>
        <Box sx={{ maxHeight: 'min(62vh, 560px)', overflow: 'auto', px: 1, pb: 1.5 }}>
          <Box sx={{ border: '1px solid rgba(17,17,17,0.08)', borderRadius: '12px', overflow: 'hidden', bgcolor: '#fff' }}>
            <HistoryResultGroups
              items={modalDisplayItems}
              retryingId={retryingId}
              onCopy={onCopy}
              onDelete={onDelete}
              onRetry={onRetry}
            />
          </Box>
        </Box>
      </Dialog>
    </>
  )
}
