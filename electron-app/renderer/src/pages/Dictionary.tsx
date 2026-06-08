import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  IconButton,
  InputAdornment,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import CloudDoneIcon from '@mui/icons-material/CloudDone'
import DeleteIcon from '@mui/icons-material/Delete'
import RemoveIcon from '@mui/icons-material/Remove'
import SearchIcon from '@mui/icons-material/Search'
import {
  createDictionaryEntry,
  deleteDictionaryEntry,
  ignoreDictionaryCandidate,
  listDictionaryCandidates,
  listDictionaryEntries,
  promoteDictionaryCandidate,
  subscribeDictionaryChanges,
  updateDictionaryEntry,
  type DictionaryCandidate,
  type DictionaryEntry,
} from '../services/dictionaryStore'
import { useI18n, type TranslationKey } from '../i18n'
import { adaptivePageSx, bodyTextSx, captionTextSx, itemTitleSx, pageTitleSx } from '../uiTokens'

const filters = [
  { labelKey: 'dictionary.filterAll', value: 'all' },
  { labelKey: 'dictionary.filterAuto', value: 'auto' },
  { labelKey: 'dictionary.filterManual', value: 'manual' },
] as const

type FilterValue = (typeof filters)[number]['value']

const itemSx = {
  bgcolor: '#fff',
  borderRadius: '8px',
  border: '1px solid rgba(119,119,119,0.10)',
  p: 1.5,
}

function matchesQuery(entry: DictionaryEntry, query: string) {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return true
  return entry.phrase.toLowerCase().includes(keyword)
    || entry.aliases.some((alias) => alias.toLowerCase().includes(keyword))
}

function candidateMatchesQuery(candidate: DictionaryCandidate, query: string) {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return true
  return candidate.wrong.toLowerCase().includes(keyword) || candidate.correct.toLowerCase().includes(keyword)
}

function FilterButton({
  active,
  label,
  value,
  onClick,
}: {
  active: boolean
  label: string
  value: FilterValue
  onClick: () => void
}) {
  return (
    <Button
      onClick={onClick}
      disableRipple
      sx={{
        minWidth: 0,
        height: 30,
        px: active ? 1.35 : 0.6,
        borderRadius: 999,
        color: 'text.primary',
        bgcolor: active ? 'rgba(17, 24, 39, 0.08)' : 'transparent',
        fontSize: 14,
        fontWeight: 700,
        '&:hover': {
          bgcolor: active ? 'rgba(17, 24, 39, 0.10)' : 'rgba(17, 24, 39, 0.04)',
        },
      }}
    >
      {value === 'auto' ? <AddIcon sx={{ mr: 0.35, fontSize: 11, color: '#14b8a6' }} /> : null}
      {value === 'manual' ? <RemoveIcon sx={{ mr: 0.35, fontSize: 13, color: 'text.secondary' }} /> : null}
      {label}
    </Button>
  )
}

function DictionaryAddDialog({
  open,
  phrase,
  saveError,
  onPhraseChange,
  onClose,
  onSave,
}: {
  open: boolean
  phrase: string
  saveError: string
  onPhraseChange: (value: string) => void
  onClose: () => void
  onSave: () => void
}) {
  const { t } = useI18n()

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      slotProps={{
        paper: {
          sx: {
            width: 444,
            maxWidth: 'calc(100vw - 32px)',
            borderRadius: '28px',
            p: 3,
            boxShadow: '0 26px 80px rgba(15, 23, 42, 0.32)',
          },
        },
        backdrop: { sx: { bgcolor: 'rgba(0, 0, 0, 0.50)' } },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Typography sx={{ fontSize: 21, fontWeight: 700, flex: 1 }}>
          {t('dictionary.addNewEntry')}
        </Typography>
        <IconButton size="small" aria-label={t('dictionary.closeAddDialog')} onClick={onClose}>
          <CloseIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </Box>
      <TextField
        autoFocus
        fullWidth
        value={phrase}
        placeholder={t('dictionary.addPlaceholder')}
        onChange={(event) => onPhraseChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && phrase.trim()) onSave()
        }}
        sx={{
          '& .MuiOutlinedInput-root': {
            height: 56,
            borderRadius: '18px',
            fontSize: 16,
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: '#2563eb',
              borderWidth: 2,
            },
          },
        }}
      />
      {saveError ? <Alert severity="error" sx={{ mt: 1.5 }}>{saveError}</Alert> : null}
      <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end', gap: 1.5 }}>
        <Button onClick={onClose} sx={{ color: '#2563eb', fontWeight: 700 }}>
          {t('dictionary.cancel')}
        </Button>
        <Button
          variant="contained"
          disabled={!phrase.trim()}
          onClick={onSave}
          sx={{
            minWidth: 76,
            borderRadius: 999,
            bgcolor: '#111',
            color: '#fff',
            fontWeight: 700,
            '&.Mui-disabled': {
              bgcolor: 'rgba(17, 24, 39, 0.12)',
              color: 'rgba(17, 24, 39, 0.28)',
            },
          }}
        >
          {t('dictionary.addEntry')}
        </Button>
      </Box>
    </Dialog>
  )
}

export default function Dictionary() {
  const { language, t } = useI18n()
  const [entries, setEntries] = useState<DictionaryEntry[]>([])
  const [candidates, setCandidates] = useState<DictionaryCandidate[]>([])
  const [filter, setFilter] = useState<FilterValue>('all')
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [phrase, setPhrase] = useState('')
  const [saveError, setSaveError] = useState('')

  const refreshDictionary = useCallback(async () => {
    const [nextEntries, nextCandidates] = await Promise.all([
      listDictionaryEntries(),
      listDictionaryCandidates(),
    ])
    setEntries(nextEntries)
    setCandidates(nextCandidates)
  }, [])

  useEffect(() => {
    void refreshDictionary()
    return subscribeDictionaryChanges(() => {
      void refreshDictionary()
    })
  }, [refreshDictionary])

  const visibleEntries = useMemo(() => entries
    .filter((entry) => filter === 'all' || entry.source === filter)
    .filter((entry) => matchesQuery(entry, query)), [entries, filter, query])

  const visibleCandidates = useMemo(() => candidates
    .filter((candidate) => candidate.status === 'candidate')
    .filter(() => filter === 'all')
    .filter((candidate) => candidateMatchesQuery(candidate, query)), [candidates, filter, query])

  const emptyCopy = useMemo(() => {
    if (query.trim()) {
      return {
        title: t('dictionary.emptySearchTitle'),
        body: t('dictionary.emptySearchDescription'),
      }
    }
    if (filter === 'auto') {
      return {
        title: t('dictionary.emptyAutoTitle'),
        body: t('dictionary.emptyAutoDescription'),
      }
    }
    return {
      title: t('dictionary.empty'),
      body: t('dictionary.emptyDescription'),
    }
  }, [filter, query, t])

  const handleOpenAdd = () => {
    setSaveError('')
    setPhrase('')
    setAddOpen(true)
  }

  const handleCloseAdd = () => {
    setAddOpen(false)
    setSaveError('')
    setPhrase('')
  }

  const handleCreateEntry = async () => {
    const nextPhrase = phrase.trim()
    if (!nextPhrase) return

    setSaveError('')
    const created = await createDictionaryEntry({
      phrase: nextPhrase,
      aliases: [],
      source: 'manual',
      status: 'active',
    })

    if (!created) {
      setSaveError(t('dictionary.saveError'))
      return
    }

    handleCloseAdd()
    setFilter('manual')
    await refreshDictionary()
  }

  const handleToggleEntry = async (entry: DictionaryEntry) => {
    await updateDictionaryEntry({
      id: entry.id,
      status: entry.status === 'active' ? 'disabled' : 'active',
    })
    await refreshDictionary()
  }

  const handleDeleteEntry = async (id: string) => {
    await deleteDictionaryEntry(id)
    await refreshDictionary()
  }

  const handlePromoteCandidate = async (id: string) => {
    await promoteDictionaryCandidate(id)
    await refreshDictionary()
  }

  const handleIgnoreCandidate = async (id: string) => {
    await ignoreDictionaryCandidate(id)
    await refreshDictionary()
  }

  return (
    <Box sx={{ ...adaptivePageSx, display: 'flex', flexDirection: 'column', gap: { xs: 2, lg: 2.5 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography sx={pageTitleSx}>{t('dictionary.title')}</Typography>
        <CloudDoneIcon sx={{ fontSize: 17, color: 'text.secondary', mt: 0.2 }} />
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, flex: '1 1 360px', minWidth: 0, flexWrap: 'wrap' }}>
          {filters.map((item) => (
            <FilterButton
              key={item.value}
              active={filter === item.value}
              label={t(item.labelKey as TranslationKey)}
              value={item.value}
              onClick={() => setFilter(item.value)}
            />
          ))}
        </Box>
        {filter === 'manual' ? (
          <Button
            variant="contained"
            startIcon={<AddIcon sx={{ fontSize: 18 }} />}
            onClick={handleOpenAdd}
            sx={{
              height: 38,
              px: 2,
              borderRadius: 999,
              bgcolor: '#111',
              color: '#fff',
              fontWeight: 800,
              whiteSpace: 'nowrap',
              boxShadow: '0 8px 18px rgba(0,0,0,0.18)',
              '&:hover': { bgcolor: '#111' },
            }}
          >
            {t('dictionary.addEntry')}
          </Button>
        ) : null}
        <IconButton
          aria-label={t('dictionary.searchAria')}
          onClick={() => setSearchOpen((current) => !current)}
          sx={{
            color: searchOpen ? '#2563eb' : 'text.secondary',
            width: 38,
            height: 38,
          }}
        >
          <SearchIcon />
        </IconButton>
      </Box>

      {searchOpen ? (
        <TextField
          autoFocus
          fullWidth
          value={query}
          placeholder={t('dictionary.searchPlaceholder')}
          onChange={(event) => setQuery(event.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ color: 'text.secondary', fontSize: 19 }} />
                </InputAdornment>
              ),
            },
          }}
          sx={{
            mt: -1,
            '& .MuiOutlinedInput-root': {
              height: 42,
              borderRadius: 999,
              bgcolor: '#fff',
              '& .MuiOutlinedInput-notchedOutline': {
                borderColor: '#2563eb',
                borderWidth: 2,
              },
              '&:hover .MuiOutlinedInput-notchedOutline': {
                borderColor: '#2563eb',
              },
              '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                borderColor: '#2563eb',
                borderWidth: 2,
              },
            },
          }}
        />
      ) : null}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {visibleCandidates.map((candidate) => (
          <Box key={candidate.id} sx={itemSx}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 1fr) auto' }, alignItems: 'center', gap: 1 }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={itemTitleSx}>
                  {candidate.wrong} -&gt; {candidate.correct}
                </Typography>
                <Typography sx={{ ...captionTextSx, color: 'text.secondary', mt: 0.5 }}>
                  {t('dictionary.candidate')} · {t('dictionary.seenCount')} {candidate.count} {t('dictionary.times')} · {t('dictionary.lastLearned')} {new Date(candidate.lastSeenAt).toLocaleString(language)}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0, justifySelf: { xs: 'start', sm: 'end' } }}>
                <IconButton size="small" aria-label={t('dictionary.confirmCandidate')} onClick={() => void handlePromoteCandidate(candidate.id)}>
                  <CheckIcon sx={{ fontSize: 18 }} />
                </IconButton>
                <IconButton size="small" aria-label={t('dictionary.ignoreCandidate')} onClick={() => void handleIgnoreCandidate(candidate.id)}>
                  <CloseIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Box>
            </Box>
          </Box>
        ))}

        {visibleEntries.map((entry) => (
          <Box key={entry.id} sx={itemSx}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 1fr) auto' }, alignItems: 'center', gap: 1 }}>
              <Box sx={{ minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography sx={itemTitleSx}>{entry.phrase}</Typography>
                  <Chip size="small" label={entry.source === 'auto' ? t('dictionary.autoAdded') : t('dictionary.manualAdded')} variant="outlined" />
                  {entry.status === 'disabled' ? <Chip size="small" label={t('dictionary.disabled')} /> : null}
                </Box>
                <Typography sx={{ ...captionTextSx, color: 'text.secondary', mt: 0.75 }}>
                  {entry.aliases.length ? `${t('dictionary.aliases')}: ${entry.aliases.join(', ')}` : t('dictionary.noAliases')}
                </Typography>
                <Typography sx={{ ...captionTextSx, color: 'text.secondary', mt: 0.25 }}>
                  {t('dictionary.hit')} {entry.hitCount} {t('dictionary.times')} · {t('dictionary.updated')} {new Date(entry.updatedAt).toLocaleString(language)}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0, justifySelf: { xs: 'start', sm: 'end' } }}>
                <Typography sx={{ ...captionTextSx, color: 'text.secondary' }}>{t('dictionary.enabled')}</Typography>
                <Switch
                  size="small"
                  checked={entry.status === 'active'}
                  onChange={() => void handleToggleEntry(entry)}
                />
                <IconButton size="small" aria-label={t('dictionary.deleteEntry')} onClick={() => void handleDeleteEntry(entry.id)}>
                  <DeleteIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Box>
            </Box>
          </Box>
        ))}

        {visibleEntries.length === 0 && visibleCandidates.length === 0 ? (
          <Box
            sx={{
              mt: 0.5,
              minHeight: 156,
              border: '1px solid rgba(119,119,119,0.18)',
              borderRadius: '16px',
              bgcolor: '#fff',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              px: 3,
              textAlign: 'center',
            }}
          >
            <Typography sx={{ ...bodyTextSx, color: 'text.secondary', fontSize: 21, fontWeight: 700 }}>
              {emptyCopy.title}
            </Typography>
            <Typography sx={{ ...captionTextSx, color: 'text.secondary', mt: 1, fontSize: 14 }}>
              {emptyCopy.body}
            </Typography>
          </Box>
        ) : null}
      </Box>

      <DictionaryAddDialog
        open={addOpen}
        phrase={phrase}
        saveError={saveError}
        onPhraseChange={setPhrase}
        onClose={handleCloseAdd}
        onSave={() => void handleCreateEntry()}
      />
    </Box>
  )
}
