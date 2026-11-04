import { Context, Effect, HashSet, Layer, Ref } from 'effect'
import { AccountOperationBusy } from './errors.js'

/**
 * One owner for credential mutations and saved-account edits. A second operation on a held account is refused at
 * once rather than queued, so a sign-out can never run behind a save it raced; reads and other accounts stay free.
 */
export class AccountLocks extends Context.Service<
  AccountLocks,
  {
    readonly withAccounts: <A, E, R>(instanceIds: ReadonlyArray<string>, work: Effect.Effect<A, E, R>) => Effect.Effect<A, E | AccountOperationBusy, R>
    readonly isLocked: (instanceId: string) => Effect.Effect<boolean>
  }
>()('@dshfiles/ai-accounts/AccountLocks') {
  static readonly make = Effect.gen(function* () {
    const held = yield* Ref.make(HashSet.empty<string>())

    const claim = (instanceIds: ReadonlyArray<string>) =>
      Ref.modify(held, (current): readonly [Effect.Effect<ReadonlyArray<string>, AccountOperationBusy>, HashSet.HashSet<string>] => {
        const selected = [...new Set(instanceIds)]
        const busy = selected.filter(id => HashSet.has(current, id))
        if (busy.length > 0) return [Effect.fail(new AccountOperationBusy({ instanceIds: busy })), current]
        return [Effect.succeed(selected), selected.reduce((next, id) => HashSet.add(next, id), current)]
      }).pipe(Effect.flatten)

    const release = (instanceIds: ReadonlyArray<string>) => Ref.update(held, current => instanceIds.reduce((next, id) => HashSet.remove(next, id), current))

    return AccountLocks.of({
      withAccounts: (instanceIds, work) => Effect.acquireUseRelease(claim(instanceIds), () => work, release),
      isLocked: instanceId => Effect.map(Ref.get(held), current => HashSet.has(current, instanceId)),
    })
  })

  static readonly layer = Layer.effect(AccountLocks, AccountLocks.make)
}
