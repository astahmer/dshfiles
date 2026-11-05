import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer, Schema } from 'effect'
import { TestClock } from 'effect/testing'
import { sortBacklogItems } from './backlog-sort.js'
import { DueDates } from './due-date.js'
import { BacklogStore } from './store.js'
import { backlogRows, backlogStoreLayer } from './test-support.js'

const openStore = Effect.map(Layer.build(backlogStoreLayer({ rows: backlogRows() })), context => Context.get(context, BacklogStore))
const user = { kind: 'user' } as const
const DAY_MS = 86_400_000

describe('due dates', () => {
  it('adds days and months on the calendar, clamping short months', () => {
    expect(DueDates.addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(DueDates.addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(DueDates.addMonths('2026-11-15', 2)).toBe('2027-01-15')
    expect(DueDates.daysBetween('2026-11-05', '2026-11-12')).toBe(7)
    expect(DueDates.label({ due: '2026-11-04', today: '2026-11-05' })).toBe('Yesterday')
    expect(DueDates.label({ due: '2026-11-01', today: '2026-11-05' })).toBe('4d late')
    expect(Schema.is(DueDates.schema)('2026-02-30')).toBe(false)
    expect(Schema.is(DueDates.schema)('2026-02-28')).toBe(true)
  })

  it.effect('flags an open item past its date as overdue, lists it in the Inbox and finds it by due operators', () =>
    Effect.gen(function* () {
      const now = Date.parse('2026-11-05T12:00:00')
      yield* TestClock.setTime(now)
      const store = yield* openStore
      const today = DueDates.dateOf(now)
      const late = (yield* store.capture({ text: 'late one', due: DueDates.addDays(today, -2), actor: user })).item.id
      const soon = (yield* store.capture({ text: 'soon one', actor: user })).item.id
      yield* store.update({ id: soon, due: DueDates.addDays(today, 3), actor: user })
      const far = (yield* store.capture({ text: 'far one', due: DueDates.addDays(today, 40), actor: user })).item.id

      const lateSummary = (yield* store.list({ query: 'is:overdue' })).items
      expect(lateSummary.map(item => [item.id, item.overdue])).toEqual([[late, true]])
      expect((yield* store.list({ inbox: true })).items.map(item => item.id)).toEqual([late])
      expect((yield* store.list({ query: 'due:<7d' })).items.map(item => item.id).sort()).toEqual([late, soon])
      expect((yield* store.list({ query: 'due:>30d' })).items.map(item => item.id)).toEqual([far])
      expect((yield* store.list({ query: '-has:due' })).total).toBe(0)

      const all = (yield* store.list({})).items
      expect(sortBacklogItems(all, 'due').map(item => item.id)).toEqual([late, soon, far])

      yield* store.update({ id: late, status: 'done', actor: user })
      expect((yield* store.list({ inbox: true })).total).toBe(0)
      yield* TestClock.adjust(DAY_MS)
      const cleared = yield* store.update({ id: far, due: null, actor: user })
      expect(cleared.ok && cleared.value.item.due).toBeUndefined()
    }).pipe(Effect.scoped),
  )
})
