import { describe, expect, it } from 'vitest'
import { HeldUpdates, IDLE_MS, RESUME_GRACE_MS, UpdateDeferral, type ApplyUpdates, type PageMoment } from './update-deferral.js'

const NOW = 1_000_000

/** A visible, connected desktop page whose reader came back long ago and is busy right now. */
const page = (overrides: Partial<PageMoment> = {}): PageMoment => ({
  now: NOW,
  hidden: false,
  connected: true,
  phone: false,
  visibleSince: NOW - 10 * IDLE_MS,
  lastInputAt: NOW - 1_000,
  editing: false,
  pointerActive: false,
  ...overrides,
})

const canApply = (mode: ApplyUpdates, moment: PageMoment, ids: readonly string[] = ['@dshfiles/usage']): boolean =>
  UpdateDeferral.canApply({ mode, page: moment, ids })

describe('when a plugin code update may apply', () => {
  it('never applies before the connection is live again, in any mode', () => {
    for (const mode of ['auto', 'immediately', 'when-hidden-or-idle'] as const) {
      expect(canApply(mode, page({ connected: false }))).toBe(false)
      expect(canApply(mode, page({ connected: false, hidden: true }))).toBe(false)
    }
  })

  it('applies at once while the page is hidden', () => {
    expect(canApply('when-hidden-or-idle', page({ hidden: true, phone: true }), ['@dshfiles/chat'])).toBe(true)
    expect(canApply('auto', page({ hidden: true, phone: true }), ['@dshfiles/workbench'])).toBe(true)
  })

  it('holds a phone update the reader would see: just back, busy, or typing', () => {
    expect(canApply('auto', page({ phone: true, visibleSince: NOW - 2_000, lastInputAt: 0 }))).toBe(false)
    expect(canApply('auto', page({ phone: true }))).toBe(false)
    expect(canApply('auto', page({ phone: true, lastInputAt: NOW - 2 * IDLE_MS, editing: true }))).toBe(false)
    expect(canApply('auto', page({ phone: true, lastInputAt: NOW - 2 * IDLE_MS, pointerActive: true }))).toBe(false)
  })

  it('applies a phone update once the reader has been idle since coming back', () => {
    expect(canApply('auto', page({ phone: true, lastInputAt: NOW - IDLE_MS }))).toBe(true)
    // Coming back is not idleness: a reader reads without touching the page.
    expect(canApply('auto', page({ phone: true, lastInputAt: 0, visibleSince: NOW - IDLE_MS + 1 }))).toBe(false)
  })

  it('keeps live updates on a visible desktop, except for the packages that draw the thread', () => {
    expect(canApply('auto', page())).toBe(true)
    for (const id of ['@dshfiles/chat', '@dshfiles/workbench', '@dshfiles/rich-composer', '@dshfiles/session-controller']) {
      expect(canApply('auto', page(), [id])).toBe(false)
      expect(canApply('auto', page({ lastInputAt: NOW - IDLE_MS }), [id])).toBe(true)
    }
  })

  it('holds even an unrelated desktop update during the grace after the page comes back', () => {
    expect(canApply('auto', page({ visibleSince: NOW - RESUME_GRACE_MS + 1 }))).toBe(false)
    expect(canApply('auto', page({ visibleSince: NOW - RESUME_GRACE_MS }))).toBe(true)
  })

  it('treats a desktop like a phone under when-hidden-or-idle, and keeps today’s behaviour under immediately', () => {
    expect(canApply('when-hidden-or-idle', page())).toBe(false)
    expect(canApply('immediately', page({ phone: true, visibleSince: NOW, editing: true }), ['@dshfiles/chat'])).toBe(true)
  })
})

describe('held updates', () => {
  it('keeps the newest graph and the newest rebuild per package, graph first', () => {
    const held = new HeldUpdates<string>()
    held.add({ type: 'rebuilt', id: '@dshfiles/chat', rev: 'a' })
    held.add({ type: 'graph', frame: 'old', ids: ['@dshfiles/usage'] })
    held.add({ type: 'rebuilt', id: '@dshfiles/workbench', rev: 'b' })
    held.add({ type: 'rebuilt', id: '@dshfiles/chat', rev: 'c' })
    held.add({ type: 'graph', frame: 'new', ids: ['@dshfiles/memory'] })
    expect(held.size).toBe(3)
    expect(held.ids()).toEqual(['@dshfiles/memory', '@dshfiles/workbench', '@dshfiles/chat'])
    expect(held.take()).toEqual([
      { type: 'graph', frame: 'new', ids: ['@dshfiles/memory'] },
      { type: 'rebuilt', id: '@dshfiles/workbench', rev: 'b' },
      { type: 'rebuilt', id: '@dshfiles/chat', rev: 'c' },
    ])
    expect(held.size).toBe(0)
  })
})
