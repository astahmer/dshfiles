import type { SettingsNavigationState } from '@dshfiles/settings-shell/settings-navigation'
import type { ResolvedEntry } from './sidebar-tree.js'

/**
 * One Settings navigation (council round 4 B1). While the Settings destination shows, its column lists Settings'
 * categories by task group and the destination's pages in one list, with no entry twice: a page a category stands for
 * (AI accounts, MCP servers, Secrets) or names (Plugins, Plugin market) is listed once, in the category's place, and
 * opens the page; the category's own settings stay one row below it, shown while that row is the current place. The
 * pages no category claims follow under Pages.
 */
export interface SettingsColumnRow {
  /** The category id, or the page's view id for a page no category claims. */
  readonly id: string
  readonly label: string
  /** The stage page the row opens; undefined for a category that opens in the Settings page. */
  readonly page?: string | undefined
  /** The destination's row for that page, for its ⋯ menu and drag. */
  readonly entry?: ResolvedEntry | undefined
  /** The category a page row also stands for: its settings open from a sub-row. */
  readonly category?: string | undefined
  /** While searching: the category's matches. */
  readonly count?: number | undefined
}

export interface SettingsColumnGroup {
  readonly id: string
  readonly label: string
  /** Draw the label as a heading; General's first row names it, so it draws none. */
  readonly named: boolean
  readonly rows: readonly SettingsColumnRow[]
}

/** The column's list: the categories by group, and the destination's pages no category claims. */
export interface SettingsColumnLayout {
  readonly groups: readonly SettingsColumnGroup[]
  readonly rest: readonly ResolvedEntry[]
}

const sameLabel = (left: string, right: string): boolean => left.trim().toLowerCase() === right.trim().toLowerCase()

const merge = (input: {
  readonly state: SettingsNavigationState
  /** The destination's mapped pages (not Other pages, not Developer). */
  readonly entries: readonly ResolvedEntry[]
}): SettingsColumnLayout => {
  const pages = input.entries.filter(entry => entry.kind === 'page')
  const pageOf = (id: string): ResolvedEntry | undefined => pages.find(entry => entry.viewId === id)
  const claimed = new Set<string>()
  // A category's page: the one it opens or links, or a destination page of the same name.
  const items = input.state.groups.flatMap(group =>
    group.items.map(item => ({ group, item, page: item.opens ?? item.page ?? pages.find(entry => sameLabel(entry.title, item.label))?.viewId })),
  )
  // A category that only links a page another category already stands for adds nothing (Installed plugins beside Plugins).
  const standsFor = (page: string | undefined, id: string): boolean =>
    page !== undefined && items.some(other => other.item.id !== id && other.page === page && other.item.linkOnly !== true)
  const groups = input.state.groups.flatMap((group, index): SettingsColumnGroup[] => {
    const rows = items
      .filter(candidate => candidate.group === group)
      .flatMap(({ item, page }): SettingsColumnRow[] => {
        if (item.linkOnly === true && standsFor(page, item.id)) return []
        if (page !== undefined && claimed.has(page)) return []
        if (page !== undefined) claimed.add(page)
        const entry = page === undefined ? undefined : pageOf(page)
        return [
          {
            id: item.id,
            // A category that only links its page is that page: the row carries the page's own name (Plugins, not
            // Installed plugins), the one the rest of the app uses for it.
            label: item.linkOnly === true && entry !== undefined ? entry.title : item.label,
            page,
            entry,
            category: page !== undefined && item.opens === undefined && item.linkOnly !== true ? item.id : undefined,
            count: item.count,
          },
        ]
      })
    return rows.length === 0 ? [] : [{ id: group.id, label: group.label, named: index !== 0, rows }]
  })
  return { groups, rest: input.entries.filter(entry => !claimed.has(entry.viewId)) }
}

/** Which row is the current place: a page row while its page shows, a category while the Settings page shows it. */
const isCurrent = (row: SettingsColumnRow, input: { readonly state: SettingsNavigationState; readonly activePanelId: string | null }): boolean =>
  row.page === undefined ? input.state.activeId === row.id : input.activePanelId === row.page

export class SettingsColumn {
  static readonly merge = merge
  static readonly isCurrent = isCurrent
}
