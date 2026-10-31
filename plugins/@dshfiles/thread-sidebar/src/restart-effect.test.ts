import { Duration, Effect, Layer, Scope } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it, vi } from 'vitest'
import { RestartEffects, RestartRuntime } from './restart-effect.js'

const runWithClock = <A>(program: Effect.Effect<A, never, RestartRuntime | Scope.Scope>) =>
  Effect.runPromise(Effect.provide(Effect.scoped(program), Layer.merge(RestartEffects.layer, TestClock.layer())))

describe('thread-sidebar scoped restart effects', () => {
  it('restarts only after two consecutive idle polls', () =>
    runWithClock(
      Effect.gen(function* () {
        const runtime = yield* RestartRuntime
        const restart = vi.fn(async () => undefined)
        let turnRead = 0
        const turns = [0, 1, 0, 0]

        yield* RestartEffects.restartWhenIdleLoop(runtime, {
          drainLimitMs: 100,
          now: () => 0,
          pollIntervalMs: 20,
          reportFailure: vi.fn(),
          restart,
          runningTurns: () => turns[turnRead++] ?? 0,
        }).pipe(Effect.forkScoped)
        yield* RestartEffects.queueRestartWhenIdle(runtime, 0)
        yield* RestartEffects.queueRestartWhenIdle(runtime, 1)
        yield* TestClock.adjust(Duration.millis(80))

        expect(restart).toHaveBeenCalledOnce()
        const pending = yield* RestartEffects.readPendingRestart(runtime)
        expect(pending).toBeUndefined()
      }),
    ))

  it('cancels a pending restart before the next poll', () =>
    runWithClock(
      Effect.gen(function* () {
        const runtime = yield* RestartRuntime
        const restart = vi.fn(async () => undefined)

        yield* RestartEffects.restartWhenIdleLoop(runtime, {
          drainLimitMs: 100,
          now: () => 0,
          pollIntervalMs: 20,
          reportFailure: vi.fn(),
          restart,
          runningTurns: () => 0,
        }).pipe(Effect.forkScoped)
        yield* RestartEffects.queueRestartWhenIdle(runtime, 0)
        yield* TestClock.adjust(Duration.millis(20))
        const canceled = yield* RestartEffects.cancelRestartWhenIdle(runtime)
        yield* TestClock.adjust(Duration.millis(100))

        expect(canceled).toBe(true)
        expect(restart).not.toHaveBeenCalled()
      }),
    ))

  it('restarts after the drain limit while turns remain active', () =>
    runWithClock(
      Effect.gen(function* () {
        const runtime = yield* RestartRuntime
        const restart = vi.fn(async () => undefined)
        let now = 0

        yield* RestartEffects.restartWhenIdleLoop(runtime, {
          drainLimitMs: 100,
          now: () => now,
          pollIntervalMs: 20,
          reportFailure: vi.fn(),
          restart,
          runningTurns: () => 1,
        }).pipe(Effect.forkScoped)
        yield* RestartEffects.queueRestartWhenIdle(runtime, 0)
        yield* TestClock.adjust(Duration.millis(20))
        now = 100
        yield* TestClock.adjust(Duration.millis(20))

        expect(restart).toHaveBeenCalledOnce()
      }),
    ))

  it('cancels restart polling when its scope closes', () =>
    runWithClock(
      Effect.gen(function* () {
        const runtime = yield* RestartRuntime
        const restart = vi.fn(async () => undefined)

        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* RestartEffects.restartWhenIdleLoop(runtime, {
              drainLimitMs: 100,
              now: () => 0,
              pollIntervalMs: 20,
              reportFailure: vi.fn(),
              restart,
              runningTurns: () => 0,
            }).pipe(Effect.forkScoped)
            yield* RestartEffects.queueRestartWhenIdle(runtime, 0)
            yield* TestClock.adjust(Duration.millis(20))
          }),
        )
        yield* TestClock.adjust(Duration.millis(100))

        expect(restart).not.toHaveBeenCalled()
      }),
    ))

  it('waits for both boot delay and turn promotion before resuming', () =>
    runWithClock(
      Effect.gen(function* () {
        let promoted = false
        let resumed = false

        yield* RestartEffects.resumeAfterBoot({
          delayMs: 20,
          promote: Effect.sleep(Duration.millis(40)).pipe(Effect.tap(() => Effect.sync(() => (promoted = true)))),
          resume: Effect.sync(() => {
            resumed = promoted
          }),
        }).pipe(Effect.forkScoped)
        yield* TestClock.adjust(Duration.millis(20))
        expect(promoted).toBe(false)
        expect(resumed).toBe(false)
        yield* TestClock.adjust(Duration.millis(20))

        expect(promoted).toBe(true)
        expect(resumed).toBe(true)
      }),
    ))

  it('cancels delayed boot resume when its scope closes', () =>
    runWithClock(
      Effect.gen(function* () {
        let resumed = false

        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* RestartEffects.resumeAfterBoot({
              delayMs: 20,
              promote: Effect.void,
              resume: Effect.sync(() => {
                resumed = true
              }),
            }).pipe(Effect.forkScoped)
          }),
        )
        yield* TestClock.adjust(Duration.millis(100))

        expect(resumed).toBe(false)
      }),
    ))
})
