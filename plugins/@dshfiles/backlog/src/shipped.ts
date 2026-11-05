import { BacklogReference } from './backlog-reference.js'
import { BacklogItems, type BacklogEvent, type BacklogItem, type BacklogKind } from './item.js'

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
const MINUTE_MS = 60_000

const unitPeriods = ['hour', 'day', 'week', 'month', 'year'] as const
const periods = [...unitPeriods, 'custom'] as const
const defaultCounts = { hour: 24, day: 14, week: 12, month: 12, year: 5 } satisfies Record<ShippedUnit, number>
const MAX_COUNT = 60

export type ShippedUnit = (typeof unitPeriods)[number]
export type ShippedPeriod = (typeof periods)[number]

export interface ShippedQuery {
  readonly period: ShippedPeriod
  /** How many period units, newest first; a custom range is always one bucket. */
  readonly count?: number | undefined
  /** Custom range bounds in epoch ms, `from` inclusive and `to` exclusive. */
  readonly from?: number | undefined
  readonly to?: number | undefined
  /** Several project paths; null selects items without a project. Empty or absent applies no filter. */
  readonly projects?: readonly (string | null)[] | undefined
  /** Minutes east of UTC that bucket boundaries follow, like the browser's local midnight. */
  readonly tzOffsetMinutes?: number | undefined
}

export interface ShippedItem {
  readonly id: number
  readonly ref?: string
  readonly title: string
  readonly kind: BacklogKind
  readonly project: string | null
  readonly doneAt: number
  /** Who did it: the agent it was delegated to when a signal closed it, else whoever moved it to done. An actor id. */
  readonly doneBy: string
  /** Who it was done for: the actor who captured it. */
  readonly owner: string
  /** Captured by an agent: it counts, and the view marks it. */
  readonly byAgent: boolean
  readonly revisions: readonly string[]
  readonly pullRequests: readonly string[]
}

export interface ShippedProjectGroup {
  readonly project: string | null
  readonly items: readonly ShippedItem[]
}

export interface ShippedBucket {
  readonly start: number
  readonly end: number
  readonly count: number
  /** Items shipped in the period just before this one, for the delta. */
  readonly previousCount: number
  readonly projects: readonly ShippedProjectGroup[]
}

export interface ShippedDigest {
  readonly period: ShippedPeriod
  readonly tzOffsetMinutes: number
  readonly from: number
  readonly to: number
  readonly total: number
  readonly buckets: readonly ShippedBucket[]
}

const pullRequestPattern = /^https?:\/\/[^/\s]+\/[^/\s]+\/[^/\s]+\/(?:pull|pulls|merge_requests|-\/merge_requests)\/\d+/u
const movedToDonePattern = /→ done\b/u

/** When an item reached done, and who moved it there. */
interface DoneEvent {
  readonly at: number
  readonly actor: string
}

const reachesDone = (event: BacklogEvent): boolean =>
  event.fieldChanges === undefined
    ? event.kind === 'moved' && movedToDonePattern.test(event.detail)
    : event.fieldChanges.some(change => change.field === 'status' && change.after === 'done')

/**
 * When an item last reached `done`: the latest event that moved it there. Events written before field changes were
 * recorded say so only in their detail; an item captured straight into `done` shipped when it was created.
 */
const doneEventOf = (item: Pick<BacklogItem, 'events' | 'createdAt' | 'actors'>): DoneEvent => {
  const event = [...item.events].reverse().find(reachesDone)
  if (event !== undefined) return { at: event.at, actor: event.actor }
  return { at: item.createdAt, actor: BacklogItems.creatorOf({ actors: item.actors, events: item.events }) ?? 'user' }
}

/** Local wall time as a UTC instant, so calendar math on it follows the caller's day, week, month and year. */
const toLocal = (at: number, offsetMinutes: number): number => at + offsetMinutes * MINUTE_MS
const toUtc = (local: number, offsetMinutes: number): number => local - offsetMinutes * MINUTE_MS

const startOfLocal = (unit: ShippedUnit, local: number): number => {
  if (unit === 'hour') return Math.floor(local / HOUR_MS) * HOUR_MS
  const day = Math.floor(local / DAY_MS) * DAY_MS
  if (unit === 'day') return day
  const date = new Date(day)
  if (unit === 'week') return day - ((date.getUTCDay() + 6) % 7) * DAY_MS
  if (unit === 'month') return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
  return Date.UTC(date.getUTCFullYear(), 0, 1)
}

const shiftLocal = (unit: ShippedUnit, start: number, steps: number): number => {
  if (unit === 'hour') return start + steps * HOUR_MS
  if (unit === 'day') return start + steps * DAY_MS
  if (unit === 'week') return start + steps * 7 * DAY_MS
  const date = new Date(start)
  if (unit === 'month') return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + steps, 1)
  return Date.UTC(date.getUTCFullYear() + steps, 0, 1)
}

/** Every bucket of the query, newest first, plus the one before the oldest so each bucket has a previous count. */
const rangesOf = (query: ShippedQuery, now: number, offset: number): { readonly start: number; readonly end: number }[] => {
  if (query.period === 'custom') {
    const to = query.to ?? now
    const from = Math.min(query.from ?? to - DAY_MS, to)
    const span = Math.max(to - from, 1)
    return [
      { start: from, end: to },
      { start: from - span, end: from },
    ]
  }
  const unit = query.period
  const count = Math.min(Math.max(Math.trunc(query.count ?? defaultCounts[unit]), 1), MAX_COUNT)
  const current = startOfLocal(unit, toLocal(now, offset))
  return Array.from({ length: count + 1 }, (_, index) => {
    const start = shiftLocal(unit, current, -index)
    return { start: toUtc(start, offset), end: toUtc(shiftLocal(unit, start, 1), offset) }
  })
}

const shippedItemOf = (item: BacklogItem, done: DoneEvent): ShippedItem => {
  const shipped: ShippedItem = {
    id: item.id,
    title: item.title,
    kind: item.kind,
    project: item.project,
    doneAt: done.at,
    doneBy: done.actor === 'system' && item.delegate !== undefined ? item.delegate : done.actor,
    owner: BacklogItems.creatorOf(item) ?? 'user',
    byAgent: BacklogItems.creatorOf(item)?.startsWith('agent:') ?? false,
    revisions: item.links.filter(link => link.type === 'revision').map(link => link.target),
    pullRequests: item.links.filter(link => link.type === 'url' && pullRequestPattern.test(link.target)).map(link => link.target),
  }
  if (item.ref === undefined) return shipped
  return { ...shipped, ref: item.ref }
}

const byProject = (items: readonly ShippedItem[]): ShippedProjectGroup[] => {
  const groups = new Map<string | null, ShippedItem[]>()
  for (const item of items) groups.set(item.project, [...(groups.get(item.project) ?? []), item])
  return [...groups]
    .map(([project, grouped]) => ({ project, items: [...grouped].sort((left, right) => right.doneAt - left.doneAt) }))
    .sort(
      (left, right) =>
        Number(left.project === null) - Number(right.project === null) ||
        right.items.length - left.items.length ||
        (left.project ?? '').localeCompare(right.project ?? ''),
    )
}

/**
 * What shipped, as of now: items currently `done` (a reopened one leaves until it is done again, and then counts once,
 * in the bucket of its last move to done), bucketed by when they reached done. Dropped items never count; items an
 * agent captured do, marked as such. Derived from the items' events on every read, so nothing but summaries is stored.
 */
const digest = (input: { readonly items: Iterable<BacklogItem>; readonly query: ShippedQuery; readonly now: number }): ShippedDigest => {
  const offset = Math.trunc(input.query.tzOffsetMinutes ?? 0)
  const ranges = rangesOf(input.query, input.now, offset)
  const projectFilter = input.query.projects?.map(project => (project === null ? null : BacklogItems.projectOf(project))) ?? []
  const shipped: ShippedItem[] = []
  for (const item of input.items) {
    if (item.status !== 'done') continue
    const project = BacklogItems.projectOf(item.project)
    if (projectFilter.length > 0 && !projectFilter.includes(project)) continue
    shipped.push(shippedItemOf({ ...item, project }, doneEventOf(item)))
  }
  const inRange = (range: { readonly start: number; readonly end: number }) => shipped.filter(item => item.doneAt >= range.start && item.doneAt < range.end)
  const counted = ranges.map(range => ({ ...range, items: inRange(range) }))
  const buckets = counted.slice(0, -1).map((bucket, index) => ({
    start: bucket.start,
    end: bucket.end,
    count: bucket.items.length,
    previousCount: counted[index + 1]?.items.length ?? 0,
    projects: byProject(bucket.items),
  }))
  return {
    period: input.query.period,
    tzOffsetMinutes: offset,
    from: buckets.at(-1)?.start ?? input.now,
    to: buckets[0]?.end ?? input.now,
    total: buckets.reduce((sum, bucket) => sum + bucket.count, 0),
    buckets,
  }
}

/** One line per bucket and item: what the agent tool shows. */
const render = (shippedDigest: ShippedDigest): string => {
  if (shippedDigest.total === 0) return `Nothing shipped in this ${shippedDigest.period === 'custom' ? 'range' : `${shippedDigest.period} range`}.`
  return shippedDigest.buckets
    .filter(bucket => bucket.count > 0)
    .map(bucket => {
      const heading = `${new Date(bucket.start).toISOString()} → ${new Date(bucket.end).toISOString()}: ${String(bucket.count)} shipped (previous ${String(bucket.previousCount)})`
      const lines = bucket.projects.flatMap(group =>
        group.items.map(
          item =>
            `  ${BacklogReference.labelOf(item)} ${item.title} · ${item.kind}${group.project === null ? '' : ` · ${group.project}`}${item.byAgent ? ' · agent' : ''}`,
        ),
      )
      return [heading, ...lines].join('\n')
    })
    .join('\n')
}

export class BacklogShipped {
  static readonly periods = periods
  static readonly unitPeriods = unitPeriods
  static readonly defaultCounts = defaultCounts
  static readonly maxCount = MAX_COUNT
  static readonly digest = digest
  static readonly doneEventOf = doneEventOf
  static readonly render = render
}
