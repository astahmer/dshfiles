import { describe, expect, it } from 'vitest'
import { HeroSuggestionsModel, type HeroThreadRow } from './hero-suggestions.js'
import type { InboxThreadSignal } from './thread-status.js'

const signal = (severity: InboxThreadSignal['severity'], verb: InboxThreadSignal['verb']): InboxThreadSignal => ({
  itemId: `item-${severity}-${verb ?? 'none'}`,
  severity,
  reason: 'reason',
  verb,
  openedAt: 0,
})

const row = (id: string, overrides: Partial<HeroThreadRow> = {}): HeroThreadRow => ({
  id,
  title: `Thread ${id}`,
  blank: false,
  running: false,
  activityAt: 0,
  signal: undefined,
  cwd: `/work/${id}`,
  ...overrides,
})

describe('hero suggestion cards', () => {
  it('offers nothing without threads', () => {
    expect(HeroSuggestionsModel.pick([], undefined)).toEqual({ resume: undefined, review: undefined, inbox: { waiting: 0, failed: 0 } })
  })

  it('resumes the most recent quiet thread, never a running, blank or the hero thread', () => {
    const rows = [
      row('old', { activityAt: 1 }),
      row('recent', { activityAt: 5 }),
      row('running', { activityAt: 9, running: true }),
      row('blank', { activityAt: 9, blank: true }),
      row('hero', { activityAt: 9 }),
    ]
    expect(HeroSuggestionsModel.pick(rows, 'hero').resume).toEqual({ id: 'recent', title: 'Thread recent', at: 5 })
  })

  it('prefers a thread waiting to be resumed over a more recent quiet one', () => {
    const rows = [row('idle', { activityAt: 9 }), row('stopped', { activityAt: 2, signal: signal('blocking', 'Resume') })]
    expect(HeroSuggestionsModel.pick(rows, undefined).resume?.id).toBe('stopped')
  })

  it('reviews a thread ready to land and does not repeat it as Resume', () => {
    const rows = [row('ready', { activityAt: 9, signal: signal('ready', 'Land') }), row('idle', { activityAt: 3 })]
    const picked = HeroSuggestionsModel.pick(rows, undefined)
    expect(picked.review).toEqual({ id: 'ready', title: 'Thread ready', cwd: '/work/ready' })
    expect(picked.resume?.id).toBe('idle')
  })

  it('does not call a ready item without a Land verb ready to land', () => {
    expect(HeroSuggestionsModel.pick([row('read', { signal: signal('ready', undefined) })], undefined).review).toBeUndefined()
  })

  // Council round 6 B7: the card read "2 threads need you" while the Inbox badge said 3 (two waiting, one failed).
  it('splits the Inbox card the way the badge counts: waiting on you, and failed', () => {
    const rows = [
      row('a', { signal: signal('blocking', 'Answer') }),
      row('b', { signal: signal('blocking', 'Approve') }),
      row('c', { signal: signal('failed', 'Retry') }),
      row('d', { signal: signal('ready', 'Land') }),
    ]
    const inbox = HeroSuggestionsModel.pick(rows, undefined).inbox
    expect(inbox).toEqual({ waiting: 2, failed: 1 })
    expect(HeroSuggestionsModel.inboxLabel(inbox)).toBe('2 waiting on you · 1 failed')
    expect(HeroSuggestionsModel.inboxLabel({ waiting: 1, failed: 0 })).toBe('1 waiting on you')
    expect(HeroSuggestionsModel.inboxLabel({ waiting: 0, failed: 2 })).toBe('2 failed')
    expect(HeroSuggestionsModel.inboxLabel({ waiting: 0, failed: 0 })).toBeUndefined()
  })

  it('reads top-level threads from the Session list with their signal', () => {
    const ready = signal('ready', 'Land')
    const rows = HeroSuggestionsModel.rowsOf(
      {
        ids: ['a', 'child'],
        byId: {
          a: { id: 'a', title: undefined, displayTitle: 'A thread', blank: false, running: false, updatedAt: 7, cwd: '/w/a' },
          child: { id: 'child', parentId: 'a', displayTitle: 'Child', blank: false, running: false, updatedAt: 9 },
        },
      } as never,
      new Map([['a', ready]]),
    )
    expect(rows).toEqual([{ id: 'a', title: 'A thread', blank: false, running: false, activityAt: 7, signal: ready, cwd: '/w/a' }])
  })
})
