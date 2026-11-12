import type { SidebarPreferences } from './organization.js'
import { DEFAULT_THREAD_BOARD_VIEW, type ThreadBoardViewSettings } from './thread-board-view.js'
import { ThreadViewPreferencesModel, type ThreadViewSettings } from './thread-view-preferences.js'

/** The browser view settings an earlier build wrote, plus the one-shot flags that recorded their migration. */
export interface LegacyThreadViews {
  readonly settings: ThreadViewSettings
  readonly doneFiltersMigrated: boolean
  readonly shippedFiltersMigrated: boolean
}

/**
 * Browser copies the Host-owned preferences replaced. The preferences machine hands each over once, then drops it —
 * only after the Host write that holds its value settled.
 */
export interface LegacyPreferences {
  readonly threadViews: LegacyThreadViews
  readonly collapsedGroups: readonly string[]
  /**
   * The Board view this browser kept before it followed the user (E9); null while the Host's settings cannot hold it yet
   * (a Host older than the field), so it stays the live browser copy until that Host restarts.
   */
  readonly boardView: ThreadBoardViewSettings | null
}

const isDefaultBoardView = (view: ThreadBoardViewSettings): boolean => JSON.stringify(view) === JSON.stringify(DEFAULT_THREAD_BOARD_VIEW)

/**
 * One Host patch carrying every legacy value worth moving: an untouched Host view document adopts the browser one and
 * still gets the shipped filter upgrades, while a Host that already holds group collapse keys keeps them.
 */
export const planLegacyPreferencesMigration = (input: {
  readonly legacy: LegacyPreferences
  readonly host: SidebarPreferences
}): Partial<SidebarPreferences> => {
  const threadViews = input.legacy.threadViews
  const adoptLegacy =
    !ThreadViewPreferencesModel.isDefaultThreadViewSettings(threadViews.settings) &&
    ThreadViewPreferencesModel.isDefaultThreadViewSettings(input.host.threadViews)
  const source = adoptLegacy ? threadViews.settings : input.host.threadViews
  const shouldMigrateDone = adoptLegacy || !threadViews.doneFiltersMigrated || ThreadViewPreferencesModel.isDefaultThreadViewSettings(source)
  const shouldUpgradeShipped = adoptLegacy || !threadViews.shippedFiltersMigrated || ThreadViewPreferencesModel.isDefaultThreadViewSettings(source)
  const doneMigrated = shouldMigrateDone ? ThreadViewPreferencesModel.migrateDoneViewSettings(source) : source
  const migrated = shouldUpgradeShipped ? ThreadViewPreferencesModel.upgradeShippedViewFilters(doneMigrated) : doneMigrated
  const collapsedGroups = input.legacy.collapsedGroups.length > 0 && input.host.collapsedGroups.length === 0 ? [...input.legacy.collapsedGroups] : null
  const threadViewsChanged = adoptLegacy || migrated !== source
  // A browser's own Board view moves once, onto a Host that still holds the default one; a Host that already holds a
  // chosen Board view keeps it (another device chose it).
  const legacyBoard = input.legacy.boardView
  const boardView = legacyBoard !== null && !isDefaultBoardView(legacyBoard) && isDefaultBoardView(input.host.boardView) ? legacyBoard : null
  // Only what moved is written: an absent key leaves the Host's value as it is.
  let changes: Partial<SidebarPreferences> = {}
  if (threadViewsChanged) changes = { ...changes, threadViews: migrated }
  if (collapsedGroups !== null) changes = { ...changes, collapsedGroups }
  if (boardView !== null) changes = { ...changes, boardView }
  return changes
}
