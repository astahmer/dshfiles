import { describe, expect, it } from 'vitest'
import { BacklogBackfill, type TriageOutcome } from './backfill.js'
import type { BacklogEvent, BacklogItem } from './item.js'
import { BacklogModel, type BacklogFileRecord } from './store.js'

const memoryTable = <Value>() => {
  const rows = new Map<string, Value>()
  return {
    get: (key: string) => rows.get(key),
    entries: () => rows.entries(),
    keys: () => rows.keys(),
    get size() {
      return rows.size
    },
    put: async (key: string, value: Value) => {
      rows.set(key, value)
    },
    delete: async (key: string) => rows.delete(key),
    update: async (key: string, change: (current: Value) => Value) => {
      const current = rows.get(key)
      if (current === undefined) throw new Error('missing row')
      const next = change(current)
      rows.set(key, next)
      return next
    },
  }
}

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
  const items = [item(4, { events: [{ at: 40, actor: 'user', kind: 'created', detail: '' }, triaged] }), item(2, { status: 'done' }), item(3), item(1), item(5)]

  it('takes open items nothing triaged yet, oldest first, and says how many a later run leaves', () => {
    expect(BacklogBackfill.select(items, { statuses: BacklogBackfill.openStatuses, limit: 2 })).toEqual({ ids: [1, 3], total: 3, remaining: 1 })
  })

  it('re-triages what triage already looked at, and reaches closed items when no status is scoped', () => {
    expect(BacklogBackfill.select(items, { statuses: BacklogBackfill.openStatuses, retriage: true, limit: 100 }).ids).toEqual([1, 3, 4, 5])
    expect(BacklogBackfill.select(items, { limit: 100 }).ids).toEqual([1, 2, 3, 5])
    expect(BacklogBackfill.select(items, { retriage: true, limit: 100 }).ids).toEqual([1, 2, 3, 4, 5])
  })

  it('asks only how much is in scope when the limit is zero', () => {
    expect(BacklogBackfill.select(items, { statuses: BacklogBackfill.openStatuses, limit: 0 })).toEqual({ ids: [], total: 3, remaining: 3 })
  })
})

describe('backfill run', () => {
  it('counts what each item became, marks only the unchanged ones, and leaves failures for the next run', async () => {
    const marked: number[] = []
    const outcomes = new Map<number, TriageOutcome>([
      [1, 'applied'],
      [2, 'proposed'],
      [3, 'unchanged'],
      [4, 'failed'],
    ])
    const report = await BacklogBackfill.run({
      selection: { ids: [1, 2, 3, 4], total: 6, remaining: 2 },
      triage: async id => outcomes.get(id) ?? 'failed',
      markTriaged: async id => {
        marked.push(id)
      },
    })

    expect(report).toEqual({ considered: 4, applied: 1, proposed: 1, unchanged: 1, failed: 1, remaining: 3 })
    expect(marked).toEqual([3])
  })

  it('counts a throwing or vanished item as failed instead of stopping the run', async () => {
    const report = await BacklogBackfill.run({
      selection: { ids: [1, 2], total: 2, remaining: 0 },
      triage: async id => {
        if (id === 1) throw new Error('down')
        return 'missing'
      },
      markTriaged: async () => undefined,
    })

    expect(report).toEqual({ considered: 2, applied: 0, proposed: 0, unchanged: 0, failed: 2, remaining: 2 })
  })
})

describe('backfill store', () => {
  it('records that triage looked at an item without making it look recently active', async () => {
    const store = BacklogModel.createStore({ files: memoryTable<BacklogFileRecord>(), items: memoryTable<BacklogItem>(), now: () => 5 })
    await store.capture({ text: 'captured before triage was set up', actor: { kind: 'user' } })
    const scope = { statuses: BacklogBackfill.openStatuses, limit: 25 }

    expect(store.triageCandidates(scope)).toEqual({ ids: [1], total: 1, remaining: 0 })

    await store.markTriaged(1)
    const reopened = store.get(1)
    expect(store.triageCandidates(scope)).toEqual({ ids: [], total: 0, remaining: 0 })
    expect(reopened.ok && reopened.value.item.lastActivityAt).toBe(5)
    expect(reopened.ok && reopened.value.item.events.at(-1)?.detail).toBe('found nothing to change')
    // The marker is history, not activity: the item does not read as freshly touched in the feed.
    expect(store.list({}).items[0]?.activity).toEqual({ count: 0, agents: 0, comments: 0, last: null })
  })
})
