/**
 * Settings' category list, for the column that draws it (council round 4 B1: one Settings navigation). Settings is one
 * page in the stage; while it shows, the side column lists its categories and the other Settings pages in one list,
 * and the page drops its own. Published as the `@dshfiles/settings-shell/settings-navigation` dshx module: importing it
 * loads none of the shell's runtime. Without a column that attaches (no thread sidebar, a collapsed column, a phone, a
 * docked Settings pane) the page keeps drawing its own list.
 */
import { defineContract, type Subscribable } from '@dshfiles/dshx/client'

/** One row: a category of the Settings page, or a Settings page that opens in the stage. */
export interface SettingsNavigationItem {
  /** The entry id `select` takes. */
  readonly id: string
  readonly label: string
  /** A stage page this row opens instead of a category (Plugin market, Capabilities hub). */
  readonly opens?: string | undefined
  /** A stage page this category stands for (its link): the column lists the page once, here. */
  readonly page?: string | undefined
  /** The category only links `page`: it holds no settings of its own. */
  readonly linkOnly?: boolean | undefined
  /** While searching: how many settings it holds that match. */
  readonly count?: number | undefined
}

export interface SettingsNavigationGroup {
  readonly id: string
  /** Its heading; the first group (General) is named by its first row and draws none. */
  readonly label: string
  readonly items: readonly SettingsNavigationItem[]
}

export interface SettingsNavigationState {
  readonly groups: readonly SettingsNavigationGroup[]
  /** The Settings page is on the stage. */
  readonly open: boolean
  /** The category the page shows; undefined while searching, while closed, or before the list loads. */
  readonly activeId: string | undefined
  readonly searching: boolean
}

/** Provided while `@dshfiles/settings-shell` runs. */
export interface SettingsNavigationService {
  readonly state: Subscribable<SettingsNavigationState>
  /** Show one category (opening the page when needed); a row with `opens` opens its stage page; while searching, a row
   * with matches scrolls the results to them. */
  select(id: string): void
  /** A column that draws this list says so while it shows; the page drops its own list until the release runs. */
  attach(): () => void
}

export const SettingsNavigation = defineContract<SettingsNavigationService>('@dshfiles/settings-shell.navigation', {
  owner: '@dshfiles/settings-shell',
})
