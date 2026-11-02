import type { Events } from '@deepseek-ai/cordis'
import { Cause, Effect, FiberSet, Queue, type Scope, Stream } from 'effect'
import { HostContext } from './host-context.js'
import { causeReport } from './cause-report.js'
import { detached } from './detached.js'

type EventName = keyof Events & string
type EventArguments<K extends EventName> = Parameters<Events[K]>

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
    const logged = (...args: EventArguments<K>) =>
      handler(...args).pipe(
        Effect.catchCause(cause =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.sync(() => host.ctx.logger('dshx:events').error(`Handler of ${name} failed:\n${causeReport(cause)}`)),
        ),
      )
    // SAFETY: Cordis types a listener as Events[K]; this one forwards exactly its parameters and returns nothing.
    const listener = ((...args: EventArguments<K>) => void run(logged(...args))) as Events[K]
    yield* Effect.acquireRelease(
      Effect.sync(() => host.ctx.on(name, listener)),
      dispose => Effect.sync(dispose),
    )
  })

/** The arguments of every `name` event as a Stream; the listener exists while the Stream is consumed. */
export const stream = <K extends EventName>(name: K): Stream.Stream<EventArguments<K>, never, HostContext> =>
  Stream.callback<EventArguments<K>, never, HostContext>(queue =>
    Effect.gen(function* () {
      const host = yield* HostContext
      // SAFETY: Cordis types a listener as Events[K]; this one forwards exactly its parameters and returns nothing.
      const listener = ((...args: EventArguments<K>) => void Queue.offerUnsafe(queue, args)) as Events[K]
      yield* Effect.acquireRelease(
        Effect.sync(() => host.ctx.on(name, listener)),
        dispose => Effect.sync(dispose),
      )
    }),
  )
