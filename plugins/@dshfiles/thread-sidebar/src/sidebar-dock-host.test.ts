// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { LayoutMerge, SidebarDockHost } from './sidebar-dock-host.js'
import { SidebarPreferencesModel } from './preferences.js'
import { DEFAULT_PREFERENCES } from './organization.js'

const fixed = { layoutMode: 'fixed', layoutMerge: null } as const
const docking = { layoutMode: 'docking', layoutMerge: null } as const

describe('LayoutMerge.decide (b:952m)', () => {
  it('waits while the Host settings are still loading, so a fallback read never decides', () => {
    expect(LayoutMerge.decide({ settled: false, hostBacked: false, markerOnHost: false, preferences: docking })).toBeNull()
  })

  it('migrates a former Fixed user: the Host marker only, no other Host change', () => {
    expect(LayoutMerge.decide({ settled: true, hostBacked: true, markerOnHost: true, preferences: fixed })).toEqual({
      request: { former: 'fixed', firstOnHost: true },
      hostPatch: { layoutMerge: 'fixed' },
    })
  })

  it('migrates a former Free docking user: marker plus the row under the list, which Free docking always showed', () => {
    expect(LayoutMerge.decide({ settled: true, hostBacked: true, markerOnHost: true, preferences: docking })).toEqual({
      request: { former: 'docking', firstOnHost: true },
      hostPatch: { layoutMerge: 'docking', showFooter: true },
    })
  })

  it('a later browser reads the recorded former layout and changes no Host setting', () => {
    expect(LayoutMerge.decide({ settled: true, hostBacked: true, markerOnHost: true, preferences: { layoutMode: 'docking', layoutMerge: 'docking' } })).toEqual(
      { request: { former: 'docking', firstOnHost: false }, hostPatch: null },
    )
  })

  it('an older Host without the marker (before its restart) gets the browser-side merge only', () => {
    expect(LayoutMerge.decide({ settled: true, hostBacked: true, markerOnHost: false, preferences: docking })).toEqual({
      request: { former: 'docking', firstOnHost: false },
      hostPatch: null,
    })
  })

  it('keeps layoutMode decodable and decodes a missing marker as not migrated', () => {
    const decoded = SidebarPreferencesModel.decode({ ...DEFAULT_PREFERENCES, layoutMode: 'docking', layoutMerge: undefined })
    expect(decoded?.layoutMode).toBe('docking')
    expect(decoded?.layoutMerge).toBeNull()
    expect(SidebarPreferencesModel.decode({ ...DEFAULT_PREFERENCES, layoutMerge: 'docking' })?.layoutMerge).toBe('docking')
  })
})

describe('SidebarDockHost', () => {
  it('publishes the lent element and ignores a stale release', () => {
    let notified = 0
    const unsubscribe = SidebarDockHost.subscribe(() => {
      notified += 1
    })
    const first = document.createElement('div')
    const second = document.createElement('div')
    const releaseFirst = SidebarDockHost.attach(first)
    const releaseSecond = SidebarDockHost.attach(second)
    releaseFirst()
    expect(SidebarDockHost.get()).toBe(second)
    releaseSecond()
    expect(SidebarDockHost.get()).toBeNull()
    expect(notified).toBe(3)
    unsubscribe()
  })
})
