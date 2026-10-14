import type { PluginSettingsPage } from './plugin-settings.js'
import type { SettingField } from './schema-form/schema-model.js'
import type { SectionRow } from './settings-view.js'

/** One page's matching settings, in schema order. */
export interface PageHits {
  readonly page: PluginSettingsPage
  readonly fields: readonly SettingField[]
}

export interface SettingsSearchResult {
  /** Native sections whose name matches: their rows are drawn by their plugins, so only the section can be offered. */
  readonly sections: readonly SectionRow[]
  readonly pages: readonly PageHits[]
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

/**
 * VS Code's settings search: every word of the query must appear in a setting's title, description, key path, or its
 * page's title or namespace. Hidden and secret fields are never pages' fields, so they never match.
 */
export const searchSettings = (input: {
  readonly query: string
  readonly sections: readonly SectionRow[]
  readonly pages: readonly PluginSettingsPage[]
}): SettingsSearchResult => {
  const needles = terms(input.query)
  const counts = new Map<string, number>()
  if (needles.length === 0) return { sections: [], pages: [], total: 0, counts }
  const sections = input.sections.filter(section => matchesAll(fold(section.label), needles))
  for (const section of sections) counts.set(section.id, 1)
  const pages = input.pages.flatMap(page => {
    const context = fold(`${page.title} ${page.ns}`)
    const fields = page.fields.filter(field =>
      matchesAll(`${context} ${fold(`${field.groups.join(' ')} ${field.title} ${field.description} ${field.path.join('.')} ${field.key}`)}`, needles),
    )
    if (fields.length === 0) return []
    counts.set(page.pageId, fields.length)
    return [{ page, fields }]
  })
  return { sections, pages, total: sections.length + pages.reduce((sum, hit) => sum + hit.fields.length, 0), counts }
}
