import { describe, expect, it } from 'vitest'
import type { BacklogEvent, BacklogItem } from './item.js'
import { BacklogShipped } from './shipped.js'

const HOUR = 3_600_000
const DAY = 24 * HOUR
/** Wednesday 2026-11-04 15:30 UTC. */
const NOW = Date.UTC(2026, 10, 4, 15, 30)

const moved = (at: number, before: string, after: string, actor = 'user'): BacklogEvent => ({
  at,
  actor,
  kind: 'moved',
  detail: `${before} → ${after}`,
  fieldChanges: [{ field: 'status', before, after }],
})

const item = (id: number, fields: Partial<BacklogItem> = {}): BacklogItem => ({
  id,
  ref: `k${String(id).padStart(3, '0')}`,
  title: `Item ${String(id)}`,
  body: '',
  kind: 'task',
  status: 'done',
  project: '/repo/app',
  tags: [],
  links: [],
  attachments: [],
  actors: [{ id: 'user', role: 'owner' }],
  pinned: false,
  humanFields: [],
  createdAt: NOW - 30 * DAY,
  lastActivityAt: NOW,
  events: [{ at: NOW - 30 * DAY, actor: 'user', kind: 'created', detail: '' }],
  ...fields,
})

const doneAt = (id: number, at: number, fields: Partial<BacklogItem> = {}): BacklogItem =>
  item(id, { ...fields, events: [{ at: NOW - 30 * DAY, actor: 'user', kind: 'created', detail: '' }, moved(at, 'doing', 'done'), ...(fields.events ?? [])] })

const idsOf = (bucket: { readonly projects: readonly { readonly items: readonly { readonly id: number }[] }[] } | undefined): number[] =>
  bucket?.projects.flatMap(group => group.items.map(entry => entry.id)) ?? []

describe('shipped digest', () => {
  it('buckets done items by local day, newest first, with the previous day as delta', () => {
    const digest = BacklogShipped.digest({
      items: [doneAt(1, NOW - HOUR), doneAt(2, NOW - DAY), doneAt(3, NOW - DAY - HOUR), doneAt(4, NOW - 3 * DAY)],
      query: { period: 'day', count: 3 },
      now: NOW,
    })
    expect(digest.buckets).toHaveLength(3)
    expect(digest.buckets.map(bucket => [bucket.start, bucket.count, bucket.previousCount])).toEqual([
      [Date.UTC(2026, 10, 4), 1, 2],
      [Date.UTC(2026, 10, 3), 2, 0],
      [Date.UTC(2026, 10, 2), 0, 1],
    ])
    expect(digest.total).toBe(3)
    expect(digest.from).toBe(Date.UTC(2026, 10, 2))
    expect(digest.to).toBe(Date.UTC(2026, 10, 5))
  })

  it('follows the caller time zone for day boundaries', () => {
    // 23:30 local in UTC-2 is 01:30 UTC the next day: a UTC reader would put it on the 4th.
    const lateEvening = Date.UTC(2026, 10, 4, 1, 30)
    const digest = BacklogShipped.digest({ items: [doneAt(1, lateEvening)], query: { period: 'day', count: 2, tzOffsetMinutes: -120 }, now: NOW })
    expect(digest.buckets[0]?.start).toBe(Date.UTC(2026, 10, 4, 2))
    expect(digest.buckets.map(bucket => bucket.count)).toEqual([0, 1])
  })

  it('starts weeks on Monday and months and years on their first day', () => {
    const items = [doneAt(1, Date.UTC(2026, 10, 2, 9)), doneAt(2, Date.UTC(2026, 10, 1, 9)), doneAt(3, Date.UTC(2025, 11, 31))]
    const week = BacklogShipped.digest({ items, query: { period: 'week', count: 2 }, now: NOW })
    expect(week.buckets[0]?.start).toBe(Date.UTC(2026, 10, 2))
    expect(week.buckets.map(bucket => bucket.count)).toEqual([1, 1])
    const month = BacklogShipped.digest({ items, query: { period: 'month', count: 2 }, now: NOW })
    expect(month.buckets.map(bucket => [bucket.start, bucket.end, bucket.count])).toEqual([
      [Date.UTC(2026, 10, 1), Date.UTC(2026, 11, 1), 2],
      [Date.UTC(2026, 9, 1), Date.UTC(2026, 10, 1), 0],
    ])
    const year = BacklogShipped.digest({ items, query: { period: 'year', count: 1 }, now: NOW })
    expect(year.buckets.map(bucket => [bucket.start, bucket.count, bucket.previousCount])).toEqual([[Date.UTC(2026, 0, 1), 2, 1]])
    const hour = BacklogShipped.digest({ items: [doneAt(4, NOW - 10 * 60_000)], query: { period: 'hour', count: 1 }, now: NOW })
    expect(hour.buckets.map(bucket => [bucket.start, bucket.count])).toEqual([[Date.UTC(2026, 10, 4, 15), 1]])
  })

  it('counts an item reopened then done again once, at its last done, and leaves reopened and dropped items out', () => {
    const redone = doneAt(1, NOW - 3 * DAY, { events: [moved(NOW - 2 * DAY, 'done', 'doing'), moved(NOW - HOUR, 'doing', 'done')] })
    const reopened = doneAt(2, NOW - 2 * HOUR, { status: 'doing', events: [moved(NOW - HOUR, 'done', 'doing')] })
    const dropped = item(3, { status: 'dropped', events: [moved(NOW - HOUR, 'doing', 'dropped')] })
    const digest = BacklogShipped.digest({ items: [redone, reopened, dropped], query: { period: 'day', count: 5 }, now: NOW })
    expect(digest.total).toBe(1)
    expect(idsOf(digest.buckets[0])).toEqual([1])
    expect(digest.buckets[0]?.projects[0]?.items[0]?.doneAt).toBe(NOW - HOUR)
  })

  it('marks agent-captured items, keeps linked revisions and pull requests, and groups by project', () => {
    const agentItem = doneAt(1, NOW - HOUR, {
      actors: [{ id: 'agent:session-abc', role: 'owner' }],
      links: [
        { type: 'revision', target: '94526da8' },
        { type: 'url', target: 'https://github.com/acme/app/pull/42' },
        { type: 'url', target: 'https://github.com/acme/app/issues/7' },
        { type: 'url', target: 'https://gitlab.com/acme/app/-/merge_requests/3' },
      ],
    })
    const other = doneAt(2, NOW - 2 * HOUR, { project: '/repo/site' })
    const workspace = doneAt(3, NOW - 3 * HOUR, { project: '/repo/app-threads/thread-1a2b' })
    const loose = doneAt(4, NOW - 4 * HOUR, { project: null })
    const digest = BacklogShipped.digest({ items: [agentItem, other, workspace, loose], query: { period: 'day', count: 1 }, now: NOW })
    const groups = digest.buckets[0]?.projects ?? []
    expect(groups.map(group => [group.project, group.items.map(entry => entry.id)])).toEqual([
      ['/repo/app', [1, 3]],
      ['/repo/site', [2]],
      [null, [4]],
    ])
    expect(groups[0]?.items[0]).toMatchObject({
      ref: 'k001',
      byAgent: true,
      doneBy: 'user',
      revisions: ['94526da8'],
      pullRequests: ['https://github.com/acme/app/pull/42', 'https://gitlab.com/acme/app/-/merge_requests/3'],
    })
    expect(groups[0]?.items[1]?.byAgent).toBe(false)
  })

  it('filters by project, including items without one', () => {
    const items = [doneAt(1, NOW - HOUR), doneAt(2, NOW - HOUR, { project: '/repo/site' }), doneAt(3, NOW - HOUR, { project: null })]
    const query = { period: 'day', count: 1 } as const
    expect(idsOf(BacklogShipped.digest({ items, query: { ...query, projects: ['/repo/site'] }, now: NOW }).buckets[0])).toEqual([2])
    expect(idsOf(BacklogShipped.digest({ items, query: { ...query, projects: [null, '/repo/app-threads/x'] }, now: NOW }).buckets[0])).toEqual([1, 3])
    expect(idsOf(BacklogShipped.digest({ items, query: { ...query, projects: [] }, now: NOW }).buckets[0])).toHaveLength(3)
  })

  it('reads a custom range as one bucket and compares it with the same span before', () => {
    const items = [doneAt(1, NOW - 2 * HOUR), doneAt(2, NOW - 5 * HOUR), doneAt(3, NOW - 7 * HOUR)]
    const digest = BacklogShipped.digest({ items, query: { period: 'custom', from: NOW - 4 * HOUR, to: NOW }, now: NOW })
    expect(digest.buckets.map(bucket => [bucket.start, bucket.end, bucket.count, bucket.previousCount])).toEqual([[NOW - 4 * HOUR, NOW, 1, 2]])
  })

  it('reads legacy moves without field changes from their detail, and an item captured as done at its creation', () => {
    const legacy = item(1, { events: [{ at: NOW - HOUR, actor: 'agent:session-x', kind: 'moved', detail: 'doing → done (revision closed it)' }] })
    const captured = item(2, { createdAt: NOW - 2 * HOUR, events: [{ at: NOW - 2 * HOUR, actor: 'user', kind: 'created', detail: '' }] })
    const digest = BacklogShipped.digest({ items: [legacy, captured], query: { period: 'day', count: 1 }, now: NOW })
    const shipped = digest.buckets[0]?.projects[0]?.items ?? []
    expect(shipped.map(entry => [entry.id, entry.doneAt, entry.doneBy])).toEqual([
      [1, NOW - HOUR, 'agent:session-x'],
      [2, NOW - 2 * HOUR, 'user'],
    ])
  })

  it('renders a tool answer line per item and says when nothing shipped', () => {
    const digest = BacklogShipped.digest({
      items: [doneAt(1, NOW - HOUR, { actors: [{ id: 'agent:s', role: 'owner' }] })],
      query: { period: 'day', count: 1 },
      now: NOW,
    })
    expect(BacklogShipped.render(digest)).toContain('b:k001 Item 1 · task · /repo/app · agent')
    expect(BacklogShipped.render(BacklogShipped.digest({ items: [], query: { period: 'week' }, now: NOW }))).toBe('Nothing shipped in this week range.')
  })
})
