import { HostContext, HostEvents } from '@dshfiles/dshx/effect'
import { Effect, Layer, type Context } from 'effect'
import { AccountStorePromiseService } from './account-store-promise.js'
import { AccountsHostApiModel } from './accounts-host-api.js'
import type { AccountsUsage } from './api.js'
import { UsageReadFailed, UsageSnapshot } from './usage-snapshot.js'

/** The usage sweep for the Promise code that still reads it through the account runtime. */
export interface UsageSnapshotPromise {
  readonly get: () => Promise<AccountsUsage>
  readonly refresh: () => Promise<AccountsUsage>
  readonly latest: () => AccountsUsage | undefined
  readonly invalidate: () => void
}

export class UsageSnapshotPromiseModel {
  /** The account usage sweep is still a Promise read; an abort follows the fiber's interruption. */
  static readonly sweep = (read: (signal: AbortSignal) => Promise<AccountsUsage>): Effect.Effect<AccountsUsage, UsageReadFailed> =>
    Effect.tryPromise({ try: read, catch: cause => new UsageReadFailed({ cause }) })

  /** A typed failure rejects with the tagged error itself, whose message is the one callers showed before. */
  static readonly facade = (snapshot: UsageSnapshot['Service'], services: Context.Context<never>): UsageSnapshotPromise => {
    const run = Effect.runPromiseWith(services)
    return {
      get: () => run(snapshot.get),
      refresh: () => run(snapshot.refresh),
      latest: snapshot.latest,
      invalidate: () => Effect.runSyncWith(services)(snapshot.invalidate),
    }
  }

  /**
   * One usage sweep shared by the page, the footer and the edge overlay for 30 s, invalidated when a key an account
   * names changes in the vault.
   */
  static readonly layer = Layer.effect(
    UsageSnapshot,
    Effect.gen(function* () {
      const host = yield* HostContext
      const store = yield* AccountStorePromiseService
      const snapshot = yield* UsageSnapshot.make({
        read: UsageSnapshotPromiseModel.sweep(signal => AccountsHostApiModel.readAccountsUsage(host.ctx, store, signal)),
        timeToLive: '30 seconds',
        timeout: '30 seconds',
      })
      yield* HostEvents.on('credentials/reference-updated', reference =>
        store.current().accounts.some(account => account.apiKeyEnv === reference) ? snapshot.invalidate : Effect.void,
      )
      return snapshot
    }),
  )
}
