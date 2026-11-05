import { Effect } from 'effect'
import type { BacklogItem, BacklogStatus } from './item.js'

const openStatuses: readonly BacklogStatus[] = ['inbox', 'todo']
const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

export interface BackfillScope {
  /** Statuses to cover; `undefined` covers every status, closed items included. */
  readonly statuses?: readonly BacklogStatus[] | undefined
  /** Include items triage already looked at, e.g. after the prompt or the model changed. */
  readonly retriage?: boolean | undefined
  readonly limit?: number | undefined
}

export interface BackfillSelection {
  /** What one run triages, oldest first. */
  readonly ids: readonly number[]
  /** Every eligible item in scope, before the limit. */
  readonly total: number
  /** Inbox/todo tasks left after applying the limit. */
  readonly remaining: number
}

export type TriageOutcome = 'applied' | 'proposed' | 'unchanged' | 'missing' | 'failed'

export interface BackfillRun<E, R> {
  readonly selection: BackfillSelection
  /** A failing triage counts as `failed` and leaves the item for the next run. */
  readonly triage: (id: number) => Effect.Effect<TriageOutcome, unknown, R>
  /** Records that triage found nothing to change, so the next run skips the item. */
  readonly markTriaged: (id: number) => Effect.Effect<void, E, R>
  readonly onProgress?: ((progress: BackfillProgress) => Effect.Effect<void, never, R>) | undefined
  /** How a log line names the item (`b:<ref>`); `b:<id>` when absent. */
  readonly labelOf?: ((id: number) => Effect.Effect<string, never, R>) | undefined
}

export interface BackfillProgress {
  readonly completed: number
  readonly total: number
  readonly applied: number
  readonly proposed: number
  readonly unchanged: number
  readonly failed: number
}

export interface BackfillReport {
  readonly considered: number
  readonly applied: number
  readonly proposed: number
  readonly unchanged: number
  readonly failed: number
  /** Inbox/todo tasks a later run still has to look at. */
  readonly remaining: number
}

const triaged = (item: BacklogItem): boolean => item.events.some(event => event.kind === 'triaged')

const eligible = (item: BacklogItem, scope: BackfillScope): boolean =>
  item.kind === 'task' &&
  openStatuses.includes(item.status) &&
  (scope.statuses === undefined || scope.statuses.includes(item.status)) &&
  (scope.retriage === true || !triaged(item))

/** Oldest first, so repeated runs move through the backlog instead of chasing whatever was captured last. */
const oldestFirst = (left: BacklogItem, right: BacklogItem): number => left.createdAt - right.createdAt || left.id - right.id

const select = (items: readonly BacklogItem[], scope: BackfillScope): BackfillSelection => {
  const chosen = items.filter(item => eligible(item, scope)).sort(oldestFirst)
  // A zero limit asks only how much is in scope; the API never sends one.
  const limit = Math.min(Math.max(0, scope.limit ?? DEFAULT_LIMIT), MAX_LIMIT)
  return { ids: chosen.slice(0, limit).map(item => item.id), total: chosen.length, remaining: Math.max(0, chosen.length - limit) }
}

/** One pass over a selection, one item at a time: an item that fails stays eligible for the next run. */
const run = <E, R>(request: BackfillRun<E, R>): Effect.Effect<BackfillReport, E, R> =>
  Effect.gen(function* () {
    const counts = { applied: 0, proposed: 0, unchanged: 0, failed: 0 }
    for (const [index, id] of request.selection.ids.entries()) {
      const outcome = yield* request
        .triage(id)
        .pipe(
          Effect.catch(error =>
            Effect.flatMap(request.labelOf?.(id) ?? Effect.succeed(`b:${String(id)}`), label =>
              Effect.as(Effect.logWarning(`backlog backfill: triage of ${label} failed`, error), 'failed' as const),
            ),
          ),
        )
      if (outcome === 'applied') counts.applied += 1
      if (outcome === 'proposed') counts.proposed += 1
      if (outcome === 'failed' || outcome === 'missing') counts.failed += 1
      if (outcome === 'unchanged') {
        counts.unchanged += 1
        yield* request.markTriaged(id)
      }
      if (request.onProgress !== undefined) yield* request.onProgress({ completed: index + 1, total: request.selection.ids.length, ...counts })
    }
    const handled = counts.applied + counts.proposed + counts.unchanged
    return { considered: request.selection.ids.length, ...counts, remaining: Math.max(0, request.selection.total - handled) }
  }).pipe(Effect.withSpan('backlog backfill run', { attributes: { 'dshx.backlog.backfill.selected': request.selection.ids.length } }))

export class BacklogBackfill {
  static readonly openStatuses = openStatuses
  static readonly defaultLimit = DEFAULT_LIMIT
  static readonly maxLimit = MAX_LIMIT
  static readonly select = select
  static readonly run = run
}
