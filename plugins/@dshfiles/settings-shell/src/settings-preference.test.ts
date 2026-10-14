import { describe, expect, it } from 'vitest'
import { preferredSurface } from './settings-preference.js'

describe('preferredSurface', () => {
  it('opens a tab when main-tabs is loaded, the dialog otherwise, unless the user chose', () => {
    expect(preferredSurface({ settings: { openIn: 'auto' }, tabsLoaded: true })).toBe('tab')
    expect(preferredSurface({ settings: { openIn: 'auto' }, tabsLoaded: false })).toBe('modal')
    expect(preferredSurface({ settings: { openIn: 'modal' }, tabsLoaded: true })).toBe('modal')
    expect(preferredSurface({ settings: { openIn: 'tab' }, tabsLoaded: false })).toBe('tab')
  })

  it('treats an unserved or malformed namespace as automatic', () => {
    expect(preferredSurface({ settings: undefined, tabsLoaded: true })).toBe('tab')
    expect(preferredSurface({ settings: { openIn: 'sideways' }, tabsLoaded: false })).toBe('modal')
  })
})
