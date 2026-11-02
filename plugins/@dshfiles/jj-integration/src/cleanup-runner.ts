import { Cause, Clock, Effect, Exit, Fiber, FiberMap, Option, Semaphore } from 'effect'
import type { CleanupResult } from './api.js'
import {
  CleanupJobModel,
  createCleanupJobTrail,
  type CleanupJobOutcome,
  type CleanupJobPhase,
  type CleanupJobRequest,
  type CleanupJobView,
} from './cleanup-jobs.js'

/** What an executing cleanup reports back while it runs; the job owns the queue, the executor owns the work. */
export interface CleanupReporter {
  /** The scan finished: its candidates are what the removal pass now walks through. */
  readonly planned: (total: number) => Effect.Effect<void>
  readonly beginPhase: (phase: Extract<CleanupJobPhase, 'removing' | 'abandoning'>) => Effect.Effect<void>
  readonly beginItem: (name: string) => Effect.Effect<void>
  readonly settleItem: (outcome: CleanupJobOutcome) => Effect.Effect<void>
}

export interface StartedCleanup<E> {
  readonly job: CleanupJobView
  /** The job's outcome, shared by every request that attached to it; awaiting it never cancels the removal. */
  readonly done: Effect.Effect<CleanupResult, E>
}

const errorText = (cause: Cause.Cause<unknown>): string => {
  const error = Cause.squash(cause)
  return (error instanceof Error ? error.message : String(error)).slice(0, 400)
}

/**
 * One removal at a time: each forgets jj workspaces and reads the Session activity the others are judged on. The job,
 * not the request that asked for it, owns the work, so closing the panel never stops a removal; a request for a scope
 * that is already queued or running attaches to it instead of queuing the same removal twice.
 */
const make = Effect.fnUntraced(function* <E>(input: {
  readonly execute: (job: { readonly request: CleanupJobRequest; readonly report: CleanupReporter }) => Effect.Effect<CleanupResult, E>
  readonly limit?: number | undefined
}) {
  const clock = yield* Clock.Clock
  const trail = createCleanupJobTrail({ now: () => clock.currentTimeMillisUnsafe(), ...(input.limit !== undefined && { limit: input.limit }) })
  const permit = yield* Semaphore.make(1)
  const running = yield* FiberMap.make<string, CleanupResult, E>()

  const reporter = (id: string): CleanupReporter => ({
    planned: total => Effect.sync(() => trail.planned(id, total)),
    beginPhase: phase => Effect.sync(() => trail.begin(id, phase)),
    beginItem: name => Effect.sync(() => trail.current(id, name)),
    settleItem: outcome => Effect.sync(() => trail.settled(id, outcome)),
  })

  const start = Effect.fn('cleanup jobs start')(function* (request: CleanupJobRequest) {
    const live = trail.live()
    if (live !== undefined && CleanupJobModel.sameRequest(live.request, request)) {
      const fiber = yield* FiberMap.get(running, live.id)
      if (Option.isSome(fiber)) return { job: live, done: Fiber.join(fiber.value) } satisfies StartedCleanup<E>
    }
    const job = trail.start(request)
    const work = Effect.gen(function* () {
      yield* Effect.sync(() => trail.begin(job.id, 'scanning'))
      return yield* input.execute({ request: job.request, report: reporter(job.id) })
    }).pipe(
      Effect.onExit(exit =>
        Effect.sync(() => {
          if (Exit.isSuccess(exit)) trail.done(job.id, exit.value)
          else trail.failed(job.id, errorText(exit.cause))
        }),
      ),
      permit.withPermits(1),
    )
    const fiber = yield* FiberMap.run(running, job.id, work)
    return { job, done: Fiber.join(fiber) } satisfies StartedCleanup<E>
  })

  return {
    start,
    live: Effect.sync(() => trail.live()),
    trail: Effect.sync(() => trail.trail()),
  }
})

export class CleanupRunner {
  static readonly make = make
}
