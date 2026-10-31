import { Context as EffectContext, Duration, Effect, Layer, Queue, Schedule } from 'effect'

export interface PendingRestart {
  readonly since: number
  readonly idlePolls: number
}

export interface RestartRuntimeState {
  readonly requests: Queue.Queue<void>
  pending: PendingRestart | undefined
}

export class RestartRuntime extends EffectContext.Service<RestartRuntime, RestartRuntimeState>()('@dshfiles/thread-sidebar/RestartRuntime') {}

const toError = (cause: unknown): Error => (cause instanceof Error ? cause : new Error(String(cause)))

export class RestartEffects {
  static readonly layer = Layer.effect(
    RestartRuntime,
    Effect.gen(function* () {
      return { requests: yield* Queue.unbounded<void>(), pending: undefined }
    }),
  )

  static queueRestartWhenIdle = (state: RestartRuntimeState, since: number) =>
    Effect.gen(function* () {
      const shouldQueue = yield* Effect.sync(() => {
        if (state.pending !== undefined) return false
        state.pending = { since, idlePolls: 0 }
        return true
      })
      if (shouldQueue) yield* Queue.offer(state.requests, undefined).pipe(Effect.asVoid)
    })

  static readPendingRestart = (state: RestartRuntimeState) => Effect.sync(() => state.pending)

  static cancelRestartWhenIdle = (state: RestartRuntimeState) =>
    Effect.sync(() => {
      if (state.pending === undefined) return false
      state.pending = undefined
      return true
    })

  static restartWhenIdleLoop = (
    state: RestartRuntimeState,
    options: {
      readonly drainLimitMs: number
      readonly now: () => number
      readonly pollIntervalMs: number
      readonly reportFailure: (error: Error) => void
      readonly restart: () => Promise<void>
      readonly runningTurns: () => number
    },
  ) =>
    Effect.forever(
      Effect.gen(function* () {
        yield* Queue.take(state.requests)
        yield* Effect.sleep(Duration.millis(options.pollIntervalMs))
        yield* Effect.repeat(
          Effect.gen(function* () {
            const pending = yield* Effect.sync(() => state.pending)
            if (pending === undefined) return true

            const running = yield* Effect.try({ try: options.runningTurns, catch: toError }).pipe(
              Effect.catch(error =>
                Effect.sync(() => {
                  options.reportFailure(error)
                  return null
                }),
              ),
            )
            if (running === null) {
              yield* Effect.sync(() => {
                state.pending = undefined
              })
              return true
            }

            const idlePolls = running === 0 ? pending.idlePolls + 1 : 0
            if (idlePolls >= 2 || options.now() - pending.since >= options.drainLimitMs) {
              yield* Effect.sync(() => {
                state.pending = undefined
              })
              yield* Effect.tryPromise({ try: options.restart, catch: toError }).pipe(Effect.catch(error => Effect.sync(() => options.reportFailure(error))))
              return true
            }

            yield* Effect.sync(() => {
              state.pending = { since: pending.since, idlePolls }
            })
            return false
          }),
          {
            schedule: Schedule.spaced(Duration.millis(options.pollIntervalMs)),
            until: done => done,
          },
        )
      }),
    )

  static resumeAfterBoot = (input: { readonly delayMs: number; readonly promote: Effect.Effect<void, never>; readonly resume: Effect.Effect<void, never> }) =>
    Effect.gen(function* () {
      yield* Effect.all([input.promote, Effect.sleep(Duration.millis(input.delayMs))], { concurrency: 2 })
      yield* input.resume
    })
}
