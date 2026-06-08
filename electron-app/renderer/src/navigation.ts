import { type TranslationKey } from './i18n'

export type Page = 'home' | 'dictionary' | 'shortcuts' | 'meetingNotes' | 'settings'

export const pages: { labelKey: TranslationKey; page: Page }[] = [
  { labelKey: 'nav.home', page: 'home' },
  { labelKey: 'nav.dictionary', page: 'dictionary' },
  { labelKey: 'nav.shortcuts', page: 'shortcuts' },
  { labelKey: 'nav.meetingNotes', page: 'meetingNotes' },
  { labelKey: 'nav.settings', page: 'settings' },
]
