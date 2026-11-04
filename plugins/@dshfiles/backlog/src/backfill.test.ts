import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { TestClock } from 'effect/testing'
import { BacklogBackfill, type BackfillProgress, type TriageOutcome } from './backfill.js'
import type { BacklogEvent, BacklogItem } from './item.js'
import { BacklogStore } from './store.js'
import { backlogStoreLayer } from './test-support.js'

const triaged: BacklogEvent = { at: 1, actor: 'system', kind: 'triaged', detail: 'suggested kind bug' }

const item = (id: number, overrides: Partial<BacklogItem> = {}): BacklogItem => ({
  id,
  title: `item ${String(id)}`,
  body: '',
  kind: 'task',
  status: 'inbox',
  project: null,
  tags: [],
  links: [],
  attachments: [],
  actors: [{ id: 'user', role: 'owner' }],
  pinned: false,
  humanFields: [],
  createdAt: id * 10,
  lastActivityAt: id * 10,
  events: [{ at: id * 10, actor: 'user', kind: 'created', detail: '' }],
  ...overrides,
})

describe('backfill selection', () => {
  const items = [
    item(4, { events: [{ at: 40, actor: 'user', kind: 'created', detail: '' }, triaged] }),
    item(2, { status: 'done' }),
    item(3),
    item(1),
    item(5),
    item(6, { kind: 'bug' }),
    item(7, { status: 'doing' }),
  ]

  it('selects only inbox/todo tasks, oldest first, and says how many a later run leaves', () => {
    expect(BacklogBackfill.select(items, { statuses: BacklogBackfill.openStatuses, limit: 2 })).toEqual({ ids: [1, 3], total: 3, remaining: 1 })
  })

  it('re-triages only inbox/todo tasks it already looked at', () => {
    expect(BacklogBackfill.select(items, { statuses: BacklogBackfill.openStatuses, retriage: true, limit: 100 }).ids).toEqual([1, 3, 4, 5])
    expect(BacklogBackfill.select(items, { statuses: BacklogBackfill.openStatuses, retriage: true, limit: 100 }).ids).not.toContain(6)
    expect(BacklogBackfill.select(items, { statuses: BacklogBackfill.openStatuses, retriage: true, limit: 100 }).ids).not.toContain(7)
    expect(BacklogBackfill.select(items, { limit: 100 }).ids).toEqual([1, 3, 5])
    expect(BacklogBackfill.select(items, { retriage: true, limit: 100 }).ids).toEqual([1, 3, 4, 5])
  })

  it('asks only how much is in scope when the limit is zero', () => {
    expect(BacklogBackfill.select(items, { statuses: BacklogBackfill.openStatuses, limit: 0 })).toEqual({ ids: [], total: 3, remaining: 3 })
  })
})

describe('backfill run', () => {
  it.effect('counts what each item became, reports progress, marks only unchanged ones, and leaves failures for later', () =>
    Effect.gen(function* () {
      const marked: number[] = []
      const progress: BackfillProgress[] = []
      const outcomes = new Map<number, TriageOutcome>([
        [1, 'applied'],
        [2, 'proposed'],
        [3, 'unchanged'],
        [4, 'failed'],
      ])
      const report = yield* BacklogBackfill.run({
        selection: { ids: [1, 2, 3, 4], total: 6, remaining: 2 },
        triage: id => Effect.succeed(outcomes.get(id) ?? 'failed'),
        markTriaged: id => Effect.sync(() => void marked.push(id)),
        onProgress: entry => Effect.sync(() => void progress.push(entry)),
      })

      expect(report).toEqual({ considered: 4, applied: 1, proposed: 1, unchanged: 1, failed: 1, remaining: 3 })
      expect(marked).toEqual([3])
      expect(progress.at(-1)).toEqual({ completed: 4, total: 4, applied: 1, proposed: 1, unchanged: 1, failed: 1 })
    }),
  )

  it.effect('counts a failing or vanished item as failed instead of stopping the run', () =>
    Effect.gen(function* () {
      const report = yield* BacklogBackfill.run({
        selection: { ids: [1, 2], total: 2, remaining: 0 },
        triage: id => (id === 1 ? Effect.fail('down') : Effect.succeed('missing' as const)),
        markTriaged: () => Effect.void,
      })

      expect(report).toEqual({ considered: 2, applied: 0, proposed: 0, unchanged: 0, failed: 2, remaining: 2 })
    }),
  )
})

describe('backfill store', () => {
  it.effect('records that triage looked at an item without making it look recently active', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(5)
      const store = yield* BacklogStore
      yield* store.capture({ text: 'captured before triage was set up', actor: { kind: 'user' } })
      const scope = { statuses: BacklogBackfill.openStatuses, limit: 25 }

      expect(yield* store.triageCandidates(scope)).toEqual({ ids: [1], total: 1, remaining: 0 })

      yield* store.markTriaged(1)
      const reopened = yield* store.get(1)
      expect(yield* store.triageCandidates(scope)).toEqual({ ids: [], total: 0, remaining: 0 })
      expect(reopened.ok && reopened.value.item.lastActivityAt).toBe(5)
      expect(reopened.ok && reopened.value.item.events.at(-1)?.detail).toBe('found nothing to change')
      // The marker is history, not activity: the item does not read as freshly touched in the feed.
      expect((yield* store.list({})).items[0]?.activity).toEqual({ count: 0, agents: 0, comments: 0, last: null })
    }).pipe(Effect.provide(backlogStoreLayer())),
  )
})
