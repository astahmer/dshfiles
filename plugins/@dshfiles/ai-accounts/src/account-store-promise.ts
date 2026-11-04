import { DshxPlugin } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer, SubscriptionRef } from 'effect'
import { AccountProfilesModel, AccountStore, type AccountStoreFile, type ConnectionCommit } from './account-store.js'
import { materializeCodexShadowHome } from './codex-home.js'

type StoreService = AccountStore['Service']
type Run = <A, E>(effect: Effect.Effect<A, E>) => Promise<A>

/** The account store for the Promise code that has not moved onto services yet. */
export interface AccountStorePromise {
  /** The snapshot as last read or written, for synchronous callers. */
  readonly current: () => AccountStoreFile
  readonly readAccountFile: () => Promise<AccountStoreFile>
  readonly writeAccountFile: (next: AccountStoreFile) => Promise<AccountStoreFile>
  readonly upsertAccount: (...input: Parameters<StoreService['upsertAccount']>) => Promise<AccountStoreFile>
  readonly removeAccount: (instanceId: string) => Promise<AccountStoreFile>
  readonly moveAccount: (...input: Parameters<StoreService['moveAccount']>) => Promise<AccountStoreFile>
  readonly reorderAccount: (...input: Parameters<StoreService['reorderAccount']>) => Promise<AccountStoreFile>
  readonly setDistribution: (...input: Parameters<StoreService['setDistribution']>) => Promise<AccountStoreFile>
  readonly createSetupAccount: (
    ...input: Parameters<StoreService['createSetupAccount']>
  ) => Promise<Effect.Success<ReturnType<StoreService['createSetupAccount']>>>
  readonly commitConnection: (input: Omit<ConnectionCommit, 'beforeCommit'> & { readonly beforeCommit?: () => Promise<void> }) => Promise<AccountStoreFile>
  readonly connectionMetadata: typeof AccountProfilesModel.connectionMetadata
}

/** Every method runs the store's Effect with `run`; a typed failure rejects with the tagged error itself. */
export const accountStorePromise = (store: StoreService, run: Run): AccountStorePromise => ({
  current: () => SubscriptionRef.getUnsafe(store.snapshot),
  readAccountFile: () => run(store.read),
  writeAccountFile: next => run(store.write(next)),
  upsertAccount: async (draft, ...rest) => {
    // Best effort, as before: a Codex profile gets its shadow home before the save so a login can land in it.
    if (draft.kind === 'codex')
      await materializeCodexShadowHome(AccountProfilesModel.layoutFor(draft, SubscriptionRef.getUnsafe(store.snapshot))).catch(() => undefined)
    return run(store.upsertAccount(draft, ...rest))
  },
  removeAccount: instanceId => run(store.removeAccount(instanceId)),
  moveAccount: (...input) => run(store.moveAccount(...input)),
  reorderAccount: (...input) => run(store.reorderAccount(...input)),
  setDistribution: (...input) => run(store.setDistribution(...input)),
  createSetupAccount: (...input) => run(store.createSetupAccount(...input)),
  commitConnection: ({ beforeCommit, ...input }) =>
    run(store.commitConnection(beforeCommit === undefined ? input : { ...input, beforeCommit: Effect.promise(beforeCommit) })),
  connectionMetadata: AccountProfilesModel.connectionMetadata,
})

export class AccountStorePromiseService extends Context.Service<AccountStorePromiseService, AccountStorePromise>()(
  '@dshfiles/ai-accounts/AccountStorePromise',
) {
  static readonly layer = Layer.effect(
    AccountStorePromiseService,
    Effect.gen(function* () {
      const store = yield* AccountStore
      const services = yield* DshxPlugin.detachedContext<never>()
      return accountStorePromise(store, effect => Effect.runPromiseWith(services)(effect))
    }),
  )
}
