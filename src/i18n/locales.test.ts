import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import vi from './locales/vi.json'
// Vite's `?raw` gives the file's exact text (unlike the parsed import above),
// which the duplicate-key scanner needs — `JSON.parse` silently collapses
// duplicate siblings, so the parsed object can't reveal them.
import enRaw from './locales/en.json?raw'
import viRaw from './locales/vi.json?raw'
import { findDuplicateKeys, flattenKeys } from '../lib/jsonLint'

// i18next appends a CLDR plural category to a key (`count_one`, `count_other`).
// English uses one/other; Vietnamese has a single plural form, so it only
// carries `_other`. Comparing the base keys (suffix stripped) lets the two
// files legitimately differ on plural variants without failing parity.
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/
const baseKeys = (keys: string[]): Set<string> =>
  new Set(keys.map((k) => k.replace(PLURAL_SUFFIX, '')))

describe('locale files', () => {
  it('en.json has no duplicate sibling keys', () => {
    expect(findDuplicateKeys(enRaw)).toEqual([])
  })

  it('vi.json has no duplicate sibling keys', () => {
    expect(findDuplicateKeys(viRaw)).toEqual([])
  })

  it('en and vi cover the same keys (ignoring plural variants)', () => {
    const enKeys = baseKeys(flattenKeys(en))
    const viKeys = baseKeys(flattenKeys(vi))
    const missingInVi = [...enKeys].filter((k) => !viKeys.has(k))
    const missingInEn = [...viKeys].filter((k) => !enKeys.has(k))
    expect({ missingInVi, missingInEn }).toEqual({ missingInVi: [], missingInEn: [] })
  })
})
