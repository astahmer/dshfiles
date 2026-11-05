import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FiberSet from 'effect/FiberSet'
import * as Scope from 'effect/Scope'

/** The requests one inspect bridge has in flight, owned by a scope that closes with the bridge. */
export interface InspectRequests {
  /** Run one request; `answer` reports its own failures, so it never rejects. */
  readonly run: (answer: () => Promise<void>) => void
  /** Interrupt what is still running; the bridge calls it after its server closed. */
  readonly close: () => Promise<void>
}

/**
 * The edge between the Promise-based inspect bridge and Effect: each request is a fiber of one `FiberSet`, so none is a
 * fire-and-forget Promise chain without an owner.
 */
const make = (): InspectRequests => {
  const scope = Effect.runSync(Scope.make())
  const fork = Effect.runSync(FiberSet.makeRuntime<never, void, never>().pipe(Scope.provide(scope)))
  return {
    run: answer => {
      fork(Effect.promise(answer))
    },
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  }
}

export class InspectRequestFibers {
  static readonly make = make
}
