/* oxlint-disable antislop/no-export-bag -- events.ts is the HostEvents namespace of @dshfiles/dshx/effect (export * as HostEvents); its exports are the namespace members. */
import type { Events } from '@deepseek-ai/cordis'
import { Cause, Effect, Exit, FiberSet, Queue, type Scope, Stream } from 'effect'
import { HostContext } from './host-context.js'
import { causeReport } from './cause-report.js'
import { detached, detachedContext } from './detached.js'

type EventName = keyof Events & string
type EventArguments<K extends EventName> = Parameters<Events[K]>
type EventResult<K extends EventName> = ReturnType<Events[K]>
type LeadingArguments<Arguments> = Arguments extends readonly [...infer Leading, unknown] ? Leading : never

/** One `waterfall` dispatch as an interceptor sees it: the event arguments and the rest of the chain. */
export interface Interception<K extends EventName> {
  /** The dispatch arguments without the trailing `next` continuation. */
  readonly args: LeadingArguments<EventArguments<K>>
  /** Run the rest of the chain (later listeners, then the built-in behavior) once; later runs return the same result. */
  readonly next: Effect.Effect<EventResult<K>>
}

const register = <K extends EventName>(input: { readonly host: HostContext['Service']; readonly name: K; readonly listener: Events[K] }) =>
  Effect.acquireRelease(
    Effect.sync(() => input.host.ctx.on(input.name, input.listener)),
    dispose => Effect.sync(dispose),
  )

const logFailure = (input: { readonly host: HostContext['Service']; readonly name: string; readonly cause: Cause.Cause<unknown> }) => {
  if (Cause.hasInterruptsOnly(input.cause)) return
  input.host.ctx.logger('dshx:events').error(`Handler of ${input.name} failed:\n${causeReport(input.cause)}`)
}

/**
 * Handle a Cordis Host event for as long as the current Scope lives. Each event runs `handler` in its own fiber,
 * interrupted when the Scope closes; a defect is logged, never thrown into the emitter.
 */
export const on = <K extends EventName, R>(
  name: K,
  handler: (...args: EventArguments<K>) => Effect.Effect<void, never, R>,
): Effect.Effect<void, never, Scope.Scope | HostContext | R> =>
  Effect.gen(function* () {
    const host = yield* HostContext
    const run = yield* detached(FiberSet.makeRuntime<R, void, never>())
    const logged = (...args: EventArguments<K>) => handler(...args).pipe(Effect.catchCause(cause => Effect.sync(() => logFailure({ host, name, cause }))))
    // SAFETY: Cordis types a listener as Events[K]; this one forwards exactly its parameters and returns nothing.
    const listener = ((...args: EventArguments<K>) => void run(logged(...args))) as Events[K]
    yield* register({ host, name, listener })
  })

const runContinuation = <A>(continuation: () => A): Exit.Exit<A, unknown> => {
  try {
    return Exit.succeed(continuation())
  } catch (error) {
    return Exit.die(error)
  }
}

type NextOutcome<A> = { readonly called: false } | { readonly called: true; readonly exit: Exit.Exit<A, unknown> }

/**
 * Wrap a Cordis `waterfall` event (`llm/stream`, `internal/get`, ...) for as long as the current Scope lives.
 * `handler` gets the arguments and `next`; returning without running `next` vetoes the rest of the chain.
 * Waterfall dispatch is synchronous, so `handler` must not suspend. A failing or suspending handler is logged and
 * the chain continues as if it had returned `next`; an error thrown by the rest of the chain reaches the emitter.
 */
export const intercept = <K extends EventName, R>(
  name: K,
  handler: (interception: Interception<K>) => Effect.Effect<EventResult<K>, never, R>,
): Effect.Effect<void, never, Scope.Scope | HostContext | R> =>
  Effect.gen(function* () {
    const host = yield* HostContext
    const runSync = Effect.runSyncExitWith(yield* detachedContext<R>())
    const listener = (...dispatched: EventArguments<K>): EventResult<K> => {
      // SAFETY: a waterfall dispatch always passes the innermost continuation as its last argument.
      const continuation = dispatched.at(-1) as () => EventResult<K>
      // SAFETY: the arguments before the continuation are exactly LeadingArguments of the event's parameters.
      const args = dispatched.slice(0, -1) as LeadingArguments<EventArguments<K>>
      let outcome: NextOutcome<EventResult<K>> = { called: false }
      const callNext = (): Exit.Exit<EventResult<K>, unknown> => {
        if (outcome.called) return outcome.exit
        const exit = runContinuation(continuation)
        outcome = { called: true, exit }
        return exit
      }
      const next = Effect.suspend(() => {
        const exit = callNext()
        return Exit.isSuccess(exit) ? Effect.succeed(exit.value) : Effect.die(Cause.squash(exit.cause))
      })
      const exit = runSync(handler({ args, next }))
      if (Exit.isSuccess(exit)) return exit.value
      const chain = callNext()
      if (Exit.isSuccess(chain)) {
        logFailure({ host, name, cause: exit.cause })
        return chain.value
      }
      throw Cause.squash(chain.cause)
    }
    // SAFETY: Cordis types a listener as Events[K]; this one takes exactly its parameters and returns its result.
    yield* register({ host, name, listener: listener as Events[K] })
  })

/**
 * Answer a Cordis `bail` event (a status probe, a lookup) for as long as the current Scope lives: the handler's
 * value is returned to the emitter, and `undefined` lets the next listener answer. Bail dispatch is synchronous, so
 * `handler` must not suspend; a failing or suspending handler is logged and answers `undefined`.
 */
export const answer = <K extends EventName, R>(
  name: K,
  handler: (...args: EventArguments<K>) => Effect.Effect<EventResult<K>, never, R>,
): Effect.Effect<void, never, Scope.Scope | HostContext | R> =>
  Effect.gen(function* () {
    const host = yield* HostContext
    const runSync = Effect.runSyncExitWith<R>(yield* detachedContext<R>())
    const listener = (...args: EventArguments<K>): EventResult<K> | undefined => {
      const exit = runSync(handler(...args))
      if (Exit.isSuccess(exit)) return exit.value
      logFailure({ host, name, cause: exit.cause })
      return undefined
    }
    // SAFETY: Cordis types a listener as Events[K]; this one takes exactly its parameters and returns its result.
    yield* register({ host, name, listener: listener as Events[K] })
  })

/** The arguments of every `name` event as a Stream; the listener exists while the Stream is consumed. */
export const stream = <K extends EventName>(name: K): Stream.Stream<EventArguments<K>, never, HostContext> =>
  Stream.callback<EventArguments<K>, never, HostContext>(queue =>
    Effect.gen(function* () {
      const host = yield* HostContext
      // SAFETY: Cordis types a listener as Events[K]; this one forwards exactly its parameters and returns nothing.
      const listener = ((...args: EventArguments<K>) => void Queue.offerUnsafe(queue, args)) as Events[K]
      yield* register({ host, name, listener })
    }),
  )
