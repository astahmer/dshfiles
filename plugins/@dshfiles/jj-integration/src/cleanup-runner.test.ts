import { describe, expect, it } from '@effect/vitest'
import { Deferred, Effect, Fiber } from 'effect'
import type { CleanupResult } from './api.js'
import type { CleanupJobRequest } from './cleanup-jobs.js'
import { CleanupRunner } from './cleanup-runner.js'

const request: CleanupJobRequest = { path: '/work/sample', olderThanHours: 6, kinds: ['empty', 'integrated'], trigger: 'manual' }

const result = (workspaces: number): CleanupResult => ({
  applied: true,
  workspaces: Array.from({ length: workspaces }, (_unused, index) => ({
    repoRoot: '/work/sample',
    name: `thread-${String(index).padStart(6, '0')}`,
    path: `/work/sample-threads/thread-${String(index).padStart(6, '0')}`,
    kind: 'empty' as const,
    lastUsedAt: 1,
    missing: false,
    outcome: 'removed' as const,
  })),
  skipped: [],
  untracked: [],
  emptyRevisions: [],
})

class RemovalFailed extends Error {}

/** A runner whose every job waits for the test to settle it, in start order. */
const controllableRunner = Effect.gen(function* () {
  const calls: Deferred.Deferred<CleanupResult, RemovalFailed>[] = []
  const runner = yield* CleanupRunner.make({
    execute: () =>
      Effect.gen(function* () {
        const settle = yield* Deferred.make<CleanupResult, RemovalFailed>()
        calls.push(settle)
        return yield* Deferred.await(settle)
      }),
  })
  return { runner, calls }
})

describe('CleanupRunner', () => {
  it.effect('runs one removal at a time and keeps the next job queued meanwhile', () =>
    Effect.gen(function* () {
      const { runner, calls } = yield* controllableRunner
      const first = yield* runner.start(request)
      const second = yield* runner.start({ ...request, olderThanHours: 24 })
      yield* Effect.yieldNow
      expect(calls).toHaveLength(1)
      expect(second.job.state).toBe('queued')

      yield* Deferred.succeed(calls[0]!, result(1))
      yield* first.done
      yield* Effect.yieldNow
      expect(calls).toHaveLength(2)
      expect((yield* runner.trail).map(view => view.state)).toEqual(['running', 'done'])
    }).pipe(Effect.scoped),
  )

  it.effect('attaches to the job already running for the same scope instead of queuing it twice', () =>
    Effect.gen(function* () {
      const { runner, calls } = yield* controllableRunner
      const first = yield* runner.start(request)
      const repeat = yield* runner.start({ ...request, kinds: ['integrated', 'empty'] })
      yield* Effect.yieldNow
      expect(repeat.job.id).toBe(first.job.id)
      yield* Deferred.succeed(calls[0]!, result(0))
      expect(yield* repeat.done).toEqual(result(0))
      expect(yield* runner.trail).toHaveLength(1)
    }).pipe(Effect.scoped),
  )

  it.effect('records a failed job, fails its outcome and still runs the next removal', () =>
    Effect.gen(function* () {
      const { runner, calls } = yield* controllableRunner
      const failed = yield* runner.start(request)
      const next = yield* runner.start({ ...request, olderThanHours: 12 })
      yield* Effect.yieldNow
      yield* Deferred.fail(calls[0]!, new RemovalFailed('jj workspace forget exited 1'))
      const failure = yield* Effect.flip(failed.done)
      expect(failure.message).toBe('jj workspace forget exited 1')
      expect((yield* runner.trail).find(job => job.id === failed.job.id)).toMatchObject({
        state: 'failed',
        phase: 'failed',
        error: 'jj workspace forget exited 1',
      })
      yield* Effect.yieldNow
      expect(calls).toHaveLength(2)
      yield* Deferred.succeed(calls[1]!, result(2))
      expect(yield* next.done).toMatchObject({ applied: true })
    }).pipe(Effect.scoped),
  )

  it.effect('reports the scan total and the item in flight on the job it owns', () =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>()
      const runner = yield* CleanupRunner.make({
        execute: ({ report }) =>
          Effect.gen(function* () {
            yield* report.planned(3)
            yield* report.beginPhase('removing')
            yield* report.beginItem('thread-aaaaaa')
            yield* Deferred.await(release)
            yield* report.settleItem('removed')
            return result(1)
          }),
      })
      const started = yield* runner.start(request)
      const waiting = yield* Effect.forkChild(started.done)
      yield* Effect.yieldNow
      expect((yield* runner.trail)[0]).toMatchObject({ state: 'running', phase: 'removing', progress: { total: 3, current: 'thread-aaaaaa' } })
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(waiting)
      expect(yield* runner.live).toBeUndefined()
      expect((yield* runner.trail)[0]).toMatchObject({ state: 'done', progress: { total: 3, removed: 1, current: null } })
    }).pipe(Effect.scoped),
  )
})
