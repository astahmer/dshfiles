import { describe, expect, it } from 'vitest'
import { tabStripLoaded } from './tab-strip.js'

const slots =
  (entries: Readonly<Record<string, readonly string[]>>) =>
  (slot: string): readonly string[] =>
    entries[slot] ?? []

describe('tabStripLoaded', () => {
  it('finds the main-tabs strip in the frame region it uses today', () => {
    expect(tabStripLoaded(slots({ 'shell.beforeMain': ['dshfiles-main-tabs'], 'shell.overlay': ['dshfiles-connection-banner'] }))).toBe(true)
  })

  it('still finds a strip registered as an overlay, and nothing when main-tabs is not loaded', () => {
    expect(tabStripLoaded(slots({ 'shell.overlay': ['dshfiles-main-tabs'] }))).toBe(true)
    expect(tabStripLoaded(slots({ 'shell.beforeMain': ['dshfiles-other'], 'shell.overlay': ['host-release-change'] }))).toBe(false)
  })
})
