import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer, Result } from 'effect'
import type { BacklogBackfillResult } from './api.js'
import type { TriageOutcome } from './backfill.js'
import { BackfillAlreadyRunning, TriageUnconfigured } from './errors.js'
import { backlogStoreLayer } from './test-support.js'
import { TriageBackfill } from './triage-backfill.js'
import { Triage } from './triage-service.js'

const unconfigured = Triage.of({
  setup: Effect.fail(new TriageUnconfigured({ reason: 'off' })),
  pass: () => Effect.succeed<TriageOutcome>('unchanged'),
  item: () => Effect.die('unused'),
  schedule: () => Effect.void,
  resolveThread: () => Effect.void,
  jevNeedsSetup: Effect.succeed(false),
  classifyReply: () => Effect.die('unused'),
  model: Effect.succeedNone,
})

const stalled = Triage.of({
  setup: Effect.never,
  pass: () => Effect.succeed<TriageOutcome>('unchanged'),
  item: () => Effect.die('unused'),
  schedule: () => Effect.void,
  resolveThread: () => Effect.void,
  jevNeedsSetup: Effect.succeed(false),
  classifyReply: () => Effect.die('unused'),
  model: Effect.succeedNone,
})

const jobsOn = (triage: Triage['Service']) =>
  Effect.map(Layer.build(TriageBackfill.layer.pipe(Layer.provideMerge(backlogStoreLayer()), Layer.provideMerge(Layer.succeed(Triage, triage)))), context =>
    Context.get(context, TriageBackfill),
  )

const settled = (jobs: TriageBackfill['Service'], jobId: string): Effect.Effect<BacklogBackfillResult | null> =>
  jobs
    .status(jobId)
    .pipe(
      Effect.flatMap(view =>
        view === null || view.state === 'queued' || view.state === 'running'
          ? Effect.sleep('5 millis').pipe(Effect.andThen(settled(jobs, jobId)))
          : Effect.succeed(view),
      ),
    )

describe('backfill jobs', () => {
  it.effect('admits one job at a time', () =>
    Effect.gen(function* () {
      const jobs = yield* jobsOn(stalled)
      const results = yield* Effect.all([Effect.result(jobs.start({})), Effect.result(jobs.start({}))], { concurrency: 'unbounded' })
      const admitted = results.filter(Result.isSuccess)
      const refused = results.filter(Result.isFailure)
      expect(admitted).toHaveLength(1)
      expect(refused.map(result => result.failure._tag)).toEqual(['BackfillAlreadyRunning'])
      const admittedJob = admitted[0]?.success
      const refusedError = refused[0]?.failure
      if (admittedJob === undefined || refusedError === undefined || refusedError._tag !== 'BackfillAlreadyRunning')
        throw new Error('one start is admitted and the other is refused for that same job')
      expect(refusedError).toBeInstanceOf(BackfillAlreadyRunning)
      expect(refusedError.jobId).toBe(admittedJob.jobId)
      // The admitted job is still running, so a later caller is refused too.
      const later = yield* Effect.result(jobs.start({}))
      expect(Result.isFailure(later)).toBe(true)
    }).pipe(Effect.scoped),
  )

  it.live('projects one flat snapshot per state, and keeps the counts a job reached', () =>
    Effect.gen(function* () {
      const jobs = yield* jobsOn(unconfigured)
      const queued = yield* jobs.start({ retriage: true })
      const { jobId } = queued
      if (jobId === null) throw new Error('a started backfill job always carries its id')
      expect(queued).toEqual({
        jobId,
        retriage: true,
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
      expect(yield* settled(jobs, jobId)).toEqual({
        jobId,
        retriage: true,
        configured: false,
        reason: 'Triage is off: turn on Jev or pick a triage provider and model in the Backlog settings.',
        state: 'completed',
        total: 0,
        completed: 0,
        applied: 0,
        proposed: 0,
        unchanged: 0,
        failed: 0,
        remaining: 0,
      })
      expect(yield* jobs.status('missing')).toBeNull()
      // A job that finished frees the slot for the next run.
      expect(Result.isSuccess(yield* Effect.result(jobs.start({})))).toBe(true)
    }).pipe(Effect.scoped),
  )
})
