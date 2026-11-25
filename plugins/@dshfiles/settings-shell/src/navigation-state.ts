import { SettingsGroups, type GroupedEntries, type SettingsEntry } from './settings-groups.js'
import type { SettingsNavigationGroup, SettingsNavigationItem, SettingsNavigationState } from './settings-navigation.js'

/** How many matches one entry holds: a page that is the whole entry shares its id with it, so each id counts once. */
const matchCount = (entry: SettingsEntry, counts: ReadonlyMap<string, number>): number => {
  const ids = new Set([entry.id, ...(entry.sectionId === undefined ? [] : [entry.sectionId]), ...entry.pages.map(page => page.pageId)])
  return [...ids].reduce((sum, id) => sum + (counts.get(id) ?? 0), 0)
}

const itemOf = (entry: SettingsEntry, counts: ReadonlyMap<string, number> | undefined): SettingsNavigationItem => ({
  id: entry.id,
  label: entry.label,
  opens: entry.opens,
  page: entry.page,
  linkOnly: entry.link !== undefined && entry.sectionId === undefined && entry.pages.length === 0 ? true : undefined,
  count: counts === undefined ? undefined : matchCount(entry, counts),
})

/**
 * The list a column draws for Settings (council round 4 B1): every category by task group. The Pages group stays out:
 * it lists the Settings destination's own pages for a page without a column, and the column lists those itself.
 */
const navigationState = (input: {
  readonly groups: readonly GroupedEntries[]
  readonly open: boolean
  readonly sectionId: string | undefined
  /** Match counts by id while searching; undefined otherwise. */
  readonly counts: ReadonlyMap<string, number> | undefined
}): SettingsNavigationState => {
  const searching = input.counts !== undefined
  const groups: SettingsNavigationGroup[] = input.groups
    .filter(({ group }) => group.id !== 'pages')
    .map(({ group, entries }) => ({ id: group.id, label: group.label, items: entries.map(entry => itemOf(entry, input.counts)) }))
  // The page shows the first entry when none is picked: the column marks the same one.
  const shown = SettingsGroups.entryFor(input.groups, input.sectionId) ?? input.groups[0]?.entries[0]
  return { groups, open: input.open, searching, activeId: input.open && !searching ? shown?.id : undefined }
}

export class SettingsNavigationModel {
  static readonly matchCount = matchCount
  static readonly state = navigationState
}
