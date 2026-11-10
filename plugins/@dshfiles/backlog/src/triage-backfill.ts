import { Cause, Context, Effect, FiberMap, Layer, Option, Ref, Result } from 'effect'
import type { BacklogBackfillResult } from './api.js'
import { BacklogBackfill } from './backfill.js'
import { BackfillAlreadyRunning } from './errors.js'
import { BacklogStore } from './store.js'
import { Triage } from './triage-service.js'

const RETAINED_JOBS = 20

type Snapshot = BacklogBackfillResult

interface BackfillCounts {
  readonly total: number
  readonly completed: number
  readonly applied: number
  readonly proposed: number
  readonly unchanged: number
  readonly failed: number
  readonly remaining: number
}

interface BackfillProgress {
  readonly configured: boolean
  readonly reason: string | null
  readonly counts: BackfillCounts
}

type BackfillPatch = Partial<BackfillCounts> & { readonly configured?: boolean; readonly reason?: string | null }

const zeroCounts: BackfillCounts = { total: 0, completed: 0, applied: 0, proposed: 0, unchanged: 0, failed: 0, remaining: 0 }

/** A count of 0 is a real "nothing yet", never a missing field: a failed job keeps the counts it reached. */
export type BackfillJob = { readonly jobId: string; readonly retriage: boolean } & (
  | { readonly state: 'queued' }
  | { readonly state: 'running'; readonly progress: BackfillProgress }
  | { readonly state: 'completed'; readonly progress: BackfillProgress }
  | { readonly state: 'failed'; readonly progress: BackfillProgress }
)

/**
 * Newest last; finished jobs beyond the retention drop first, a running one never does.
 */
const retained = (jobs: ReadonlyMap<string, BackfillJob>): ReadonlyMap<string, BackfillJob> => {
  const entries = [...jobs]
  const surplus = entries.length - RETAINED_JOBS
  if (surplus <= 0) return jobs
  const finished = entries
    .filter(([, job]) => job.state === 'completed' || job.state === 'failed')
    .slice(0, surplus)
    .map(([id]) => id)
  return new Map(entries.filter(([id]) => !finished.includes(id)))
}

const busy = (job: BackfillJob): boolean => job.state === 'queued' || job.state === 'running'

const snapshotOf = (job: BackfillJob): Snapshot => {
  const progress = job.state === 'queued' ? { configured: true, reason: null, counts: zeroCounts } : job.progress
  return {
    jobId: job.jobId,
    retriage: job.retriage,
    configured: progress.configured,
    reason: progress.reason,
    state: job.state,
    ...progress.counts,
  }
}

/**
 * Triage over the items that existed before triage was switched on: oldest open tasks no triage looked at yet, one at a
 * time so a rate limit or a bad key does not burst. One run at a time; its progress is a snapshot callers poll.
 */
export class TriageBackfill extends Context.Service<
  TriageBackfill,
  {
    readonly start: (request: {
      readonly retriage?: boolean | undefined
      readonly limit?: number | undefined
    }) => Effect.Effect<Snapshot, BackfillAlreadyRunning>
    readonly status: (jobId: string) => Effect.Effect<Snapshot | null>
  }
>()('@dshfiles/backlog/TriageBackfill') {
  static readonly layer = Layer.effect(
    TriageBackfill,
    Effect.gen(function* () {
      const store = yield* BacklogStore
      const triage = yield* Triage
      const runs = yield* FiberMap.make<string>()
      const jobs = yield* Ref.make<ReadonlyMap<string, BackfillJob>>(new Map())

      /** Applies one step only to a job that is still running: a finished job never moves again. */
      const patchRunning = (jobId: string, change: (job: Extract<BackfillJob, { readonly state: 'running' }>) => BackfillJob) =>
        Ref.update(jobs, current => {
          const job = current.get(jobId)
          return job === undefined || job.state !== 'running' ? current : new Map(current).set(jobId, change(job))
        })

      /** queued → running is the only way a job starts moving, and it happens once. */
      const begin = (jobId: string) =>
        Ref.update(jobs, current => {
          const job = current.get(jobId)
          return job === undefined || job.state !== 'queued'
            ? current
            : new Map(current).set(jobId, { ...job, state: 'running', progress: { configured: true, reason: null, counts: zeroCounts } })
        })

      const advanced = (job: Extract<BackfillJob, { readonly state: 'running' }>, change: BackfillPatch): BackfillProgress => ({
        configured: change.configured === undefined ? job.progress.configured : change.configured,
        reason: change.reason === undefined ? job.progress.reason : change.reason,
        counts: { ...job.progress.counts, ...change },
      })

      const progress = (jobId: string, change: BackfillPatch) => patchRunning(jobId, job => ({ ...job, progress: advanced(job, change) }))

      const settle = (jobId: string, change: BackfillPatch) => patchRunning(jobId, job => ({ ...job, state: 'completed', progress: advanced(job, change) }))

      const fail = (jobId: string, reason: string) =>
        Ref.update(jobs, current => {
          const job = current.get(jobId)
          if (job === undefined || job.state === 'failed' || job.state === 'completed') return current
          const progress = job.state === 'queued' ? { configured: true, reason, counts: zeroCounts } : { ...job.progress, reason }
          return new Map(current).set(jobId, { jobId: job.jobId, retriage: job.retriage, state: 'failed', progress })
        })

      const work = Effect.fn('backlog backfill')(function* (input: { readonly jobId: string; readonly retriage: boolean; readonly limit: number }) {
        yield* begin(input.jobId)
        const scope = { retriage: input.retriage, limit: input.limit, statuses: BacklogBackfill.openStatuses }
        const setup = yield* Effect.result(triage.setup)
        if (Result.isFailure(setup)) {
          const inScope = yield* store.triageCandidates({ ...scope, limit: 0 })
          return yield* settle(input.jobId, { configured: false, reason: setup.failure.message, remaining: inScope.total })
        }
        const selection = yield* store.triageCandidates(scope)
        const total = selection.ids.length + selection.remaining
        yield* progress(input.jobId, { total, remaining: selection.remaining })
        const report = yield* BacklogBackfill.run({
          selection,
          triage: id => triage.pass({ id, setup: setup.success }),
          markTriaged: store.markTriaged,
          labelOf: store.labelOf,
          onProgress: entry =>
            progress(input.jobId, {
              completed: entry.completed + total - selection.ids.length,
              applied: entry.applied,
              proposed: entry.proposed,
              unchanged: entry.unchanged,
              failed: entry.failed,
            }),
        })
        yield* settle(input.jobId, { remaining: report.remaining })
      })

      const start = Effect.fn('backlog backfill start')(function* (request: { readonly retriage?: boolean | undefined; readonly limit?: number | undefined }) {
        const retriage = request.retriage === true
        const job: BackfillJob = { jobId: globalThis.crypto.randomUUID(), retriage, state: 'queued' }
        // Admission and insertion are one step, so two callers can never both believe no job is running.
        const admitted = yield* Ref.modify(jobs, current => {
          const running = [...current.values()].find(busy)
          return running === undefined
            ? ([Option.none<string>(), retained(new Map(current).set(job.jobId, job))] as const)
            : ([Option.some(running.jobId), current] as const)
        })
        if (Option.isSome(admitted)) return yield* new BackfillAlreadyRunning({ jobId: admitted.value })
        yield* FiberMap.run(
          runs,
          job.jobId,
          work({ jobId: job.jobId, retriage, limit: request.limit ?? BacklogBackfill.defaultLimit }).pipe(
            Effect.tapCause(cause =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.void
                : Effect.andThen(Effect.logWarning('backlog backfill failed', cause), fail(job.jobId, 'The backfill failed before it could finish.')),
            ),
            Effect.ignore,
          ),
          { startImmediately: true },
        )
        return snapshotOf(job)
      })

      const status = (jobId: string) =>
        Effect.map(Ref.get(jobs), current => Option.match(Option.fromUndefinedOr(current.get(jobId)), { onNone: () => null, onSome: snapshotOf }))

      return TriageBackfill.of({ start, status })
    }),
  )
}
