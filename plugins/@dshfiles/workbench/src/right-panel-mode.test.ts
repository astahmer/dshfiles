import { describe, expect, it } from 'vitest'
import { effectiveRightPanelMode } from './right-panel-mode.js'

describe('effective right-panel mode', () => {
  it('follows the setting while no native tab needs the column', () => {
    expect(effectiveRightPanelMode({ setting: 'native', nativeTabsOnScreen: false })).toBe('native')
    expect(effectiveRightPanelMode({ setting: 'dock', nativeTabsOnScreen: false })).toBe('dock')
  })

  it('gives the column back to the native surface while the on-screen session has an open tab', () => {
    expect(effectiveRightPanelMode({ setting: 'dock', nativeTabsOnScreen: true })).toBe('native')
  })

  it('never borrows the column from the native setting', () => {
    expect(effectiveRightPanelMode({ setting: 'native', nativeTabsOnScreen: true })).toBe('native')
  })
})
