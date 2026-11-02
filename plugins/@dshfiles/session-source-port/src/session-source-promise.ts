import { Effect, Option, Stream } from 'effect'
import type { EffectSessionSource } from './effect.js'
import type { MirroredSessionSource } from './index.js'

const aborted = (signal: AbortSignal) =>
  Effect.callback<void>(resume => {
    if (signal.aborted) return resume(Effect.void)
    const onAbort = () => resume(Effect.void)
    signal.addEventListener('abort', onAbort, { once: true })
    return Effect.sync(() => signal.removeEventListener('abort', onAbort))
  })

/**
 * Adapt an Effect source to the Promise/AsyncIterable port. The returned source runs every call with the services
 * of the Effect that built it; an aborted signal interrupts the call or ends the follow stream.
 */
export const fromEffect = <R>(source: EffectSessionSource<R>): Effect.Effect<MirroredSessionSource, never, R> =>
  Effect.map(Effect.context<R>(), context => {
    const run = Effect.runPromiseWith(context)
    const { follow, runtimeIdForSession, page, prompt, cancel, updateQueue, projections, selectModel } = source
    return {
      id: source.id,
      label: source.label,
      list: (request, signal) => run(source.list(request), { signal }),
      owns: sessionId => run(source.owns(sessionId)),
      ...(runtimeIdForSession !== undefined && {
        runtimeIdForSession: sessionId => run(Effect.map(runtimeIdForSession(sessionId), Option.getOrUndefined)),
      }),
      ...(follow !== undefined && {
        follow: (request, signal) => Stream.toAsyncIterableWith(Stream.interruptWhen(follow(request), aborted(signal)), context),
      }),
      ...(page !== undefined && { page: (request, signal) => run(page(request), { signal }) }),
      ...(prompt !== undefined && { prompt: (request, signal) => run(prompt(request), { signal }) }),
      ...(cancel !== undefined && { cancel: request => run(cancel(request)) }),
      ...(updateQueue !== undefined && { updateQueue: request => run(updateQueue(request)) }),
      ...(projections !== undefined && { projections: (request, signal) => run(projections(request), { signal }) }),
      ...(selectModel !== undefined && { selectModel: request => run(selectModel(request)) }),
    } satisfies MirroredSessionSource
  })
