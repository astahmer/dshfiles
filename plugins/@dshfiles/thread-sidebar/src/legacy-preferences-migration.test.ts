import { describe, expect, it } from 'vitest'
import { planLegacyPreferencesMigration, type LegacyPreferences } from './legacy-preferences-migration.js'
import { DEFAULT_PREFERENCES, type SidebarPreferences } from './organization.js'
import { DEFAULT_THREAD_VIEW_SETTINGS, type ThreadViewSettings } from './thread-view-preferences.js'

const customThreadViews: ThreadViewSettings = { ...DEFAULT_THREAD_VIEW_SETTINGS, showFilterControl: false }

const legacyOf = (overrides: Partial<LegacyPreferences> = {}): LegacyPreferences => ({
  threadViews: { settings: DEFAULT_THREAD_VIEW_SETTINGS, doneFiltersMigrated: true, shippedFiltersMigrated: true },
  collapsedGroups: [],
  ...overrides,
})

const hostOf = (overrides: Partial<SidebarPreferences> = {}): SidebarPreferences => ({ ...DEFAULT_PREFERENCES, ...overrides })

describe('planLegacyPreferencesMigration', () => {
  it('adopts a browser view document the Host never replaced, in the same patch', () => {
    const patch = planLegacyPreferencesMigration({
      legacy: legacyOf({ threadViews: { settings: customThreadViews, doneFiltersMigrated: false, shippedFiltersMigrated: false } }),
      host: hostOf(),
    })
    expect(patch).toEqual({ threadViews: customThreadViews })
  })

  it('keeps a Host view document that already moved past the browser copy', () => {
    const hostThreadViews: ThreadViewSettings = { ...DEFAULT_THREAD_VIEW_SETTINGS, showGroupControl: false }
    const patch = planLegacyPreferencesMigration({
      legacy: legacyOf({ threadViews: { settings: customThreadViews, doneFiltersMigrated: false, shippedFiltersMigrated: false } }),
      host: hostOf({ threadViews: hostThreadViews }),
    })
    expect(patch).toEqual({})
  })

  it('upgrades the shipped filters of an untouched Host document once per migration flag', () => {
    const patch = planLegacyPreferencesMigration({
      legacy: legacyOf({ threadViews: { settings: DEFAULT_THREAD_VIEW_SETTINGS, doneFiltersMigrated: false, shippedFiltersMigrated: true } }),
      host: hostOf(),
    })
    expect(patch).toEqual({})
  })

  it('moves the browser group collapse list only into a Host with none', () => {
    expect(planLegacyPreferencesMigration({ legacy: legacyOf({ collapsedGroups: ['project:alpha'] }), host: hostOf() })).toEqual({
      collapsedGroups: ['project:alpha'],
    })
    expect(
      planLegacyPreferencesMigration({ legacy: legacyOf({ collapsedGroups: ['project:alpha'] }), host: hostOf({ collapsedGroups: ['project:beta'] }) }),
    ).toEqual({})
  })

  it('carries both browser copies in one Host patch', () => {
    const patch = planLegacyPreferencesMigration({
      legacy: legacyOf({
        threadViews: { settings: customThreadViews, doneFiltersMigrated: true, shippedFiltersMigrated: true },
        collapsedGroups: ['status:working'],
      }),
      host: hostOf(),
    })
    expect(patch).toEqual({ threadViews: customThreadViews, collapsedGroups: ['status:working'] })
  })
})
