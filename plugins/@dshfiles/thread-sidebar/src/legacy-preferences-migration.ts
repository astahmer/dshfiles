import type { SidebarPreferences } from './organization.js'
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
}

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
  if (collapsedGroups === null) return threadViewsChanged ? { threadViews: migrated } : {}
  return threadViewsChanged ? { threadViews: migrated, collapsedGroups } : { collapsedGroups }
}
