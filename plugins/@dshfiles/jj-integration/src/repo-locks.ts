import { KeyedMutex } from '@dshfiles/dshx/effect/keyed-mutex'
import { Context, Effect, Layer } from 'effect'

/** Every mutation of one jj store runs in order, so two rebases never race to move the same bookmark; stores run in parallel. */
export class RepoLocks extends Context.Service<
  RepoLocks,
  { readonly withRepo: (repoRoot: string) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R> }
>()('@dshfiles/jj-integration/RepoLocks') {
  static readonly layer = Layer.effect(
    RepoLocks,
    Effect.map(KeyedMutex.make<string>(), mutex => RepoLocks.of({ withRepo: mutex.withLock })),
  )
}
