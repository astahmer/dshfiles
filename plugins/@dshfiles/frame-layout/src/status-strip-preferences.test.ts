import { describe, expect, it } from 'vitest'
import type { StatusItem } from './status-strip.js'
import { DEFAULT_STATUS_STRIP_PREFERENCES, StatusStripPreferencesModel, type StatusStripPreferences } from './status-strip-preferences.js'

const item = (id: string, side: StatusItem['side'], order: number): StatusItem => ({ id, side, order, label: id, component: () => null })

const working = item('working', 'global', 10)
const quota = item('quota', 'global', 20)
const restart = item('restart', 'global', 90)
const cost = item('cost', 'thread', 0)
const items = [restart, quota, working, cost]

const ids = (arranged: { readonly global: readonly StatusItem[]; readonly thread: readonly StatusItem[] }) => ({
  global: arranged.global.map(entry => entry.id),
  thread: arranged.thread.map(entry => entry.id),
})

const preferences = (input: Partial<StatusStripPreferences>): StatusStripPreferences => ({ ...DEFAULT_STATUS_STRIP_PREFERENCES, ...input })

describe('status strip preferences', () => {
  it('keeps the default order without saved preferences', () => {
    expect(ids(StatusStripPreferencesModel.visible(items, DEFAULT_STATUS_STRIP_PREFERENCES))).toEqual({
      global: ['working', 'quota', 'restart'],
      thread: ['cost'],
    })
  })

  it('applies the saved order and ignores ids nobody registered', () => {
    const saved = preferences({ order: ['gone', 'restart', 'working', 'quota'] })
    expect(ids(StatusStripPreferencesModel.visible(items, saved)).global).toEqual(['restart', 'working', 'quota'])
  })

  it('places an item missing from the saved order right after its default predecessor', () => {
    const saved = preferences({ order: ['restart', 'working'] })
    expect(ids(StatusStripPreferencesModel.visible(items, saved)).global).toEqual(['restart', 'working', 'quota'])
    const first = preferences({ order: ['restart', 'quota'] })
    expect(ids(StatusStripPreferencesModel.visible(items, first)).global).toEqual(['working', 'restart', 'quota'])
  })

  it('leaves hidden items out of the strip but lists them for Settings', () => {
    const saved = preferences({ hidden: ['quota', 'unknown'] })
    expect(ids(StatusStripPreferencesModel.visible(items, saved)).global).toEqual(['working', 'restart'])
    expect(ids(StatusStripPreferencesModel.list(items, saved)).global).toEqual(['working', 'quota', 'restart'])
  })

  it('moves an item within its side and keeps saved ids of absent items', () => {
    const saved = preferences({ order: ['gone'] })
    const moved = StatusStripPreferencesModel.move({ items, preferences: saved, id: 'restart', direction: 'up' })
    expect(moved.order).toEqual(['working', 'restart', 'quota', 'cost', 'gone'])
    expect(StatusStripPreferencesModel.move({ items, preferences: moved, id: 'working', direction: 'up' })).toBe(moved)
    expect(StatusStripPreferencesModel.move({ items, preferences: moved, id: 'cost', direction: 'down' })).toBe(moved)
    expect(StatusStripPreferencesModel.move({ items, preferences: moved, id: 'unknown', direction: 'down' })).toBe(moved)
  })

  it('hides and shows an item without duplicating ids', () => {
    const hidden = StatusStripPreferencesModel.setHidden({ preferences: DEFAULT_STATUS_STRIP_PREFERENCES, id: 'quota', hidden: true })
    expect(StatusStripPreferencesModel.setHidden({ preferences: hidden, id: 'quota', hidden: true }).hidden).toEqual(['quota'])
    expect(StatusStripPreferencesModel.setHidden({ preferences: hidden, id: 'quota', hidden: false }).hidden).toEqual([])
  })
})
