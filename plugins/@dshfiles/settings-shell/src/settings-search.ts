import type { PluginSettingsPage } from './plugin-settings.js'
import type { SettingField } from './schema-form/schema-model.js'
import { settingsSearchEntriesSchema, type SettingsSearchEntry } from '@dshfiles/dshx/settings'
import type { SectionRow } from './settings-view.js'

/** One control a live `settings.section` publishes, with the section that opens at it. */
export interface SectionEntryRow extends SettingsSearchEntry {
  readonly sectionId: string
  readonly sectionLabel: string
}

/** One page's matching settings, in schema order. */
interface PageHits {
  readonly page: PluginSettingsPage
  readonly fields: readonly SettingField[]
}

export interface SettingsSearchResult {
  /** Native sections whose name matches: their rows are drawn by their plugins, so only the section can be offered. */
  readonly sections: readonly SectionRow[]
  readonly pages: readonly PageHits[]
  /** Section controls whose text matches, in section order. */
  readonly entries: readonly SectionEntryRow[]
  /** Settings found, sections included, for "N Settings Found". */
  readonly total: number
  /** Matches per nav id, for the counts beside the tree. */
  readonly counts: ReadonlyMap<string, number>
}

/** Lower case without accents, so "prefere" finds "Préférences". */
const fold = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

const terms = (query: string): readonly string[] =>
  fold(query)
    .split(/\s+/u)
    .filter(term => term.length > 0)

const matchesAll = (haystack: string, needles: readonly string[]): boolean => needles.every(needle => haystack.includes(needle))

/** Entries whose title, description, keywords, id or section name hold every word of the query. */
const matchSectionEntries = (input: { readonly query: string; readonly entries: readonly SectionEntryRow[] }): readonly SectionEntryRow[] => {
  const needles = terms(input.query)
  if (needles.length === 0) return []
  return input.entries.filter(entry =>
    matchesAll(fold(`${entry.sectionLabel} ${entry.title} ${entry.description ?? ''} ${entry.keywords ?? ''} ${entry.id}`), needles),
  )
}

/**
 * VS Code's settings search: every word of the query must appear in a setting's title, description, key path, or its
 * page's title or namespace. Hidden and secret fields are never pages' fields, so they never match.
 */
const searchSettings = (input: {
  readonly query: string
  readonly sections: readonly SectionRow[]
  readonly pages: readonly PluginSettingsPage[]
  readonly entries: readonly SectionEntryRow[]
}): SettingsSearchResult => {
  const needles = terms(input.query)
  const counts = new Map<string, number>()
  if (needles.length === 0) return { sections: [], pages: [], entries: [], total: 0, counts }
  const sections = input.sections.filter(section => matchesAll(fold(section.label), needles))
  for (const section of sections) counts.set(section.id, 1)
  const entries = matchSectionEntries({ query: input.query, entries: input.entries })
  for (const entry of entries) counts.set(entry.sectionId, (counts.get(entry.sectionId) ?? 0) + 1)
  const pages = input.pages.flatMap(page => {
    const context = fold(`${page.title} ${page.ns}`)
    const fields = page.fields.filter(field =>
      matchesAll(`${context} ${fold(`${field.groups.join(' ')} ${field.title} ${field.description} ${field.path.join('.')} ${field.key}`)}`, needles),
    )
    if (fields.length === 0) return []
    counts.set(page.pageId, fields.length)
    return [{ page, fields }]
  })
  return {
    sections,
    pages,
    entries,
    total: sections.length + entries.length + pages.reduce((sum, hit) => sum + hit.fields.length, 0),
    counts,
  }
}

/**
 * Every live section's published entries, in section order; a section that left the ledger contributes none. Each
 * bundle publishes its own entries, so they are decoded here and a section whose set does not decode is reported and
 * skipped.
 */
const sectionEntryRows = (input: {
  readonly sections: readonly SectionRow[]
  readonly published: ReadonlyMap<string, unknown>
  readonly onInvalid: (failure: { readonly sectionId: string; readonly message: string }) => void
}): readonly SectionEntryRow[] =>
  input.sections.flatMap(section => {
    if (!input.published.has(section.id)) return []
    const decoded = settingsSearchEntriesSchema.safeParse(input.published.get(section.id))
    if (!decoded.success) {
      input.onInvalid({ sectionId: section.id, message: decoded.error.message })
      return []
    }
    return decoded.data.map(entry => ({ ...entry, sectionId: section.id, sectionLabel: section.label }))
  })

export class SettingsSearch {
  static readonly search = searchSettings
  static readonly matchEntries = matchSectionEntries
  static readonly entryRows = sectionEntryRows
}
