import { Effect } from 'effect'
import { AccountStore } from '../account-store.js'
import { accountStorePromise, type AccountStorePromise } from '../account-store-promise.js'
import { AccountsPlatformLive } from '../platform-layer.js'

/** The real account store over the real file system at `filePath`, with its Promise facade for Promise-based tests. */
export const openAccountStore = async (filePath: string): Promise<AccountStorePromise> =>
  accountStorePromise(await Effect.runPromise(AccountStore.makeAt(filePath).pipe(Effect.provide(AccountsPlatformLive))), effect => Effect.runPromise(effect))
