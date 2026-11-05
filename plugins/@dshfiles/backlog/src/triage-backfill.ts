import { Cause, Context, Effect, FiberMap, Layer, Option, Ref, Result } from 'effect'
import type { BacklogBackfillResult } from './api.js'
import { BacklogBackfill } from './backfill.js'
import { BackfillAlreadyRunning } from './errors.js'
import { BacklogStore } from './store.js'
import { Triage } from './triage-service.js'

const RETAINED_JOBS = 20

type Snapshot = BacklogBackfillResult

const queued = (jobId: string, retriage: boolean): Snapshot => ({
  jobId,
  retriage,
  configured: true,
  reason: null,
  state: 'queued',
  total: 0,
  completed: 0,
  applied: 0,
  proposed: 0,
  unchanged: 0,
  failed: 0,
  remaining: 0,
})

/** Newest last; finished jobs beyond the retention drop first, a running one never does. */
const retained = (jobs: ReadonlyMap<string, Snapshot>): ReadonlyMap<string, Snapshot> => {
  const entries = [...jobs]
  const surplus = entries.length - RETAINED_JOBS
  if (surplus <= 0) return jobs
  const finished = entries
    .filter(([, job]) => job.state === 'completed' || job.state === 'failed')
    .slice(0, surplus)
    .map(([id]) => id)
  return new Map(entries.filter(([id]) => !finished.includes(id)))
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
      const runs = yield* FiberMap.make<'backfill'>()
      const jobs = yield* Ref.make<ReadonlyMap<string, Snapshot>>(new Map())

      const patch = (jobId: string, change: Partial<Snapshot>) =>
        Ref.update(jobs, current => {
          const job = current.get(jobId)
          return job === undefined ? current : new Map(current).set(jobId, { ...job, ...change })
        })

      const work = Effect.fn('backlog backfill')(function* (input: { readonly jobId: string; readonly retriage: boolean; readonly limit: number }) {
        yield* patch(input.jobId, { state: 'running' })
        const scope = { retriage: input.retriage, limit: input.limit, statuses: BacklogBackfill.openStatuses }
        const setup = yield* Effect.result(triage.setup)
        if (Result.isFailure(setup)) {
          const inScope = yield* store.triageCandidates({ ...scope, limit: 0 })
          return yield* patch(input.jobId, { configured: false, reason: setup.failure.message, remaining: inScope.total, state: 'completed' })
        }
        const selection = yield* store.triageCandidates(scope)
        const total = selection.ids.length + selection.remaining
        yield* patch(input.jobId, { total, remaining: selection.remaining })
        const report = yield* BacklogBackfill.run({
          selection,
          triage: id => triage.pass({ id, setup: setup.success }),
          markTriaged: store.markTriaged,
          labelOf: store.labelOf,
          onProgress: progress =>
            patch(input.jobId, {
              completed: progress.completed + total - selection.ids.length,
              applied: progress.applied,
              proposed: progress.proposed,
              unchanged: progress.unchanged,
              failed: progress.failed,
            }),
        })
        yield* patch(input.jobId, { remaining: report.remaining, state: 'completed' })
      })

      const start = Effect.fn('backlog backfill start')(function* (request: { readonly retriage?: boolean | undefined; readonly limit?: number | undefined }) {
        const running = [...(yield* Ref.get(jobs)).values()].find(job => job.state === 'queued' || job.state === 'running')
        if (running !== undefined) return yield* new BackfillAlreadyRunning({ jobId: running.jobId ?? '' })
        const jobId = globalThis.crypto.randomUUID()
        const retriage = request.retriage === true
        const snapshot = queued(jobId, retriage)
        yield* Ref.update(jobs, current => retained(new Map(current).set(jobId, snapshot)))
        yield* FiberMap.run(
          runs,
          'backfill',
          work({ jobId, retriage, limit: request.limit ?? BacklogBackfill.defaultLimit }).pipe(
            Effect.tapCause(cause =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.void
                : Effect.andThen(
                    Effect.logWarning('backlog backfill failed', cause),
                    patch(jobId, { state: 'failed', reason: 'The backfill failed before it could finish.' }),
                  ),
            ),
            Effect.ignore,
          ),
          { startImmediately: true },
        )
        return snapshot
      })

      const status = (jobId: string) => Effect.map(Ref.get(jobs), current => Option.getOrNull(Option.fromUndefinedOr(current.get(jobId))))

      return TriageBackfill.of({ start, status })
    }),
  )
}
