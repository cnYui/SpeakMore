import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Chip, IconButton, Switch, TextField, Typography } from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import DeleteIcon from '@mui/icons-material/Delete'
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
import { splitDictionaryAliases } from '../services/dictionaryForm'
import { useI18n, type TranslationKey } from '../i18n'
import { glassItemSx, pageSx, pageTitleSx, typo } from '../uiTokens'

const filters = [
  { labelKey: 'dictionary.filterAll', value: 'all' },
  { labelKey: 'dictionary.filterAuto', value: 'auto' },
  { labelKey: 'dictionary.filterManual', value: 'manual' },
  { labelKey: 'dictionary.filterCandidate', value: 'candidate' },
] as const

type FilterValue = (typeof filters)[number]['value']

const itemSx = {
  ...glassItemSx,
  borderRadius: '14px',
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

export default function Dictionary() {
  const { language, t } = useI18n()
  const [entries, setEntries] = useState<DictionaryEntry[]>([])
  const [candidates, setCandidates] = useState<DictionaryCandidate[]>([])
  const [filter, setFilter] = useState<FilterValue>('all')
  const [query, setQuery] = useState('')
  const [phrase, setPhrase] = useState('')
  const [aliases, setAliases] = useState('')
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
    .filter((entry) => filter === 'all' || filter === 'candidate' || entry.source === filter)
    .filter((entry) => matchesQuery(entry, query)), [entries, filter, query])

  const visibleCandidates = useMemo(() => candidates
    .filter((candidate) => candidate.status === 'candidate')
    .filter(() => filter === 'all' || filter === 'candidate')
    .filter((candidate) => candidateMatchesQuery(candidate, query)), [candidates, filter, query])

  const handleCreateEntry = async () => {
    const nextPhrase = phrase.trim()
    if (!nextPhrase) return

    setSaveError('')
    const created = await createDictionaryEntry({
      phrase: nextPhrase,
      aliases: splitDictionaryAliases(aliases),
      source: 'manual',
      status: 'active',
    })

    if (!created) {
      setSaveError(t('dictionary.saveError'))
      return
    }

    setPhrase('')
    setAliases('')
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
    <Box sx={{ ...pageSx, maxWidth: 920, display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <Box sx={{ mb: 2 }}>
        <Typography sx={pageTitleSx}>{t('dictionary.title')}</Typography>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr auto' }, gap: 1.5, mb: 2, alignItems: 'start' }}>
        <TextField
          size="small"
          label={t('dictionary.correctLabel')}
          value={phrase}
          onChange={(event) => setPhrase(event.target.value)}
          helperText={!phrase.trim() ? t('dictionary.correctHelper') : ' '}
        />
        <TextField
          size="small"
          label={t('dictionary.aliasLabel')}
          placeholder={t('dictionary.aliasPlaceholder')}
          value={aliases}
          onChange={(event) => setAliases(event.target.value)}
        />
        <Button
          variant="contained"
          onClick={handleCreateEntry}
          disabled={!phrase.trim()}
          sx={{ minWidth: 96, height: 40 }}
        >
          {t('dictionary.saveEntry')}
        </Button>
      </Box>

      {saveError ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {saveError}
        </Alert>
      ) : null}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 2 }}>
        {filters.map((item) => (
          <Chip
            key={item.value}
            label={t(item.labelKey as TranslationKey)}
            color={filter === item.value ? 'primary' : 'default'}
            variant={filter === item.value ? 'filled' : 'outlined'}
            onClick={() => setFilter(item.value)}
          />
        ))}
        <TextField
          size="small"
          placeholder={t('dictionary.searchPlaceholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          sx={{ ml: { xs: 0, md: 'auto' }, width: { xs: '100%', md: 260 } }}
        />
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {visibleCandidates.map((candidate) => (
          <Box key={candidate.id} sx={itemSx}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'space-between' }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ ...typo.bodyMedium }}>
                  {candidate.wrong} → {candidate.correct}
                </Typography>
                <Typography sx={{ ...typo.caption, color: 'text.secondary', mt: 0.5 }}>
                  {t('dictionary.candidate')} · {t('dictionary.seenCount')} {candidate.count} {t('dictionary.times')} · {t('dictionary.lastLearned')} {new Date(candidate.lastSeenAt).toLocaleString(language)}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
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
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'space-between' }}>
              <Box sx={{ minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography sx={{ ...typo.bodyMedium }}>{entry.phrase}</Typography>
                  <Chip size="small" label={entry.source === 'auto' ? t('dictionary.autoAdded') : t('dictionary.manualAdded')} variant="outlined" />
                  {entry.status === 'disabled' ? <Chip size="small" label={t('dictionary.disabled')} /> : null}
                </Box>
                <Typography sx={{ ...typo.caption, color: 'text.secondary', mt: 0.75 }}>
                  {entry.aliases.length ? `${t('dictionary.aliases')}: ${entry.aliases.join('、')}` : t('dictionary.noAliases')}
                </Typography>
                <Typography sx={{ ...typo.caption, color: 'text.secondary', mt: 0.25 }}>
                  {t('dictionary.hit')} {entry.hitCount} {t('dictionary.times')} · {t('dictionary.updated')} {new Date(entry.updatedAt).toLocaleString(language)}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                <Typography sx={{ ...typo.caption, color: 'text.secondary' }}>{t('dictionary.enabled')}</Typography>
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
          <Box sx={{ py: 8, display: 'flex', justifyContent: 'center' }}>
            <Typography sx={{ color: 'text.secondary' }}>{t('dictionary.empty')}</Typography>
          </Box>
        ) : null}
      </Box>
    </Box>
  )
}
