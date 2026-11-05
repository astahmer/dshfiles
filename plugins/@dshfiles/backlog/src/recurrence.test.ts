import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer, Schema } from 'effect'
import { TestClock } from 'effect/testing'
import { DueDates } from './due-date.js'
import { Recurrence } from './recurrence.js'
import { BacklogStore } from './store.js'
import { backlogRows, backlogStoreLayer } from './test-support.js'

const openStore = Effect.map(Layer.build(backlogStoreLayer({ rows: backlogRows() })), context => Context.get(context, BacklogStore))
const user = { kind: 'user' } as const

describe('recurrence', () => {
  it('steps daily, weekly, monthly and cron rules past today', () => {
    expect(Recurrence.nextDue({ recurrence: 'daily', due: '2026-11-05', today: '2026-11-05' })).toBe('2026-11-06')
    expect(Recurrence.nextDue({ recurrence: 'daily', due: '2026-11-01', today: '2026-11-05' })).toBe('2026-11-06')
    expect(Recurrence.nextDue({ recurrence: 'weekly', due: undefined, today: '2026-11-05' })).toBe('2026-11-12')
    expect(Recurrence.nextDue({ recurrence: 'monthly', due: '2026-01-31', today: '2026-01-31' })).toBe('2026-02-28')
    // 2026-11-05 is a Thursday: the next Monday is the 9th.
    expect(Recurrence.nextDue({ recurrence: 'cron:0 9 * * 1', due: undefined, today: '2026-11-05' })).toBe('2026-11-09')
    expect(Recurrence.nextDue({ recurrence: 'cron:0 0 1 */3 *', due: '2026-11-05', today: '2026-11-05' })).toBe('2027-01-01')
    expect(Schema.is(Recurrence.schema)('cron:0 9 * *')).toBe(false)
    expect(Schema.is(Recurrence.schema)('hourly')).toBe(false)
  })

  it.effect('creates the next occurrence when a recurring item is done, once, with criteria unchecked', () =>
    Effect.gen(function* () {
      const now = Date.parse('2026-11-05T12:00:00')
      yield* TestClock.setTime(now)
      const today = DueDates.dateOf(now)
      const store = yield* openStore
      const created = yield* store.capture({ text: 'weekly review #ops', due: today, recurrence: 'weekly', priority: 'high', actor: user })
      const id = created.item.id
      yield* store.update({ id, criteria: [{ text: 'inbox zero', done: true }], actor: user })

      const done = yield* store.update({ id, status: 'done', actor: user })
      expect(done.ok && done.value.item.recurrence).toBeUndefined()
      const occurrences = (yield* store.list({ query: 'weekly review', freshness: 'all' })).items.filter(item => item.id !== id)
      expect(occurrences).toHaveLength(1)
      const next = occurrences[0]
      expect(next).toEqual(
        expect.objectContaining({ status: 'todo', due: DueDates.addDays(today, 7), recurrence: 'weekly', priority: 'high', tags: ['ops'], criteriaProgress: { total: 1, done: 0 } }),
      )
      expect(done.ok && done.value.item.links.some(link => link.type === 'item' && link.target === next?.ref)).toBe(true)

      yield* store.update({ id, status: 'todo', actor: user })
      yield* store.update({ id, status: 'done', actor: user })
      expect((yield* store.list({ query: 'weekly review', freshness: 'all' })).total).toBe(2)
    }).pipe(Effect.scoped),
  )
})
