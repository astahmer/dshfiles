import { HostContext } from '@dshfiles/dshx/effect'
import { Effect, Layer, Schedule, type Context } from 'effect'
import { AccountStorePromiseService } from './account-store-promise.js'
import { AccountsHostApiModel } from './accounts-host-api.js'
import { resolveKeyFromContext } from './credentials.js'
import { createUsageHistoryService } from './usage-recorder.js'
import { UsageHistoryCollectFailed, UsageHistorySchedule } from './usage-history-schedule.js'

export class UsageHistoryPromiseModel {
  /** The storage-backed sweep is still a Promise; interruption aborts its signal. */
  static readonly sweep = (sweep: (signal: AbortSignal) => Promise<number>) =>
    Effect.tryPromise({ try: sweep, catch: cause => new UsageHistoryCollectFailed({ cause }) })

  static readonly nextSweepAt = (read: () => Promise<number | undefined>) =>
    Effect.tryPromise({ try: read, catch: cause => new UsageHistoryCollectFailed({ cause }) })

  /** The manual collection for the Promise API handler that still reaches it through the account runtime. */
  static readonly facade = (schedule: UsageHistorySchedule['Service'], services: Context.Context<never>) => ({
    collectNow: () => Effect.runPromiseWith(services)(schedule.collectNow),
  })

  /** Quota history sweeps over the account file the panel shows, checked once a minute against the stored interval. */
  static readonly layer = Layer.effect(
    UsageHistorySchedule,
    Effect.gen(function* () {
      const host = yield* HostContext
      const store = yield* AccountStorePromiseService
      const history = createUsageHistoryService(host.ctx)
      return yield* UsageHistorySchedule.make({
        sweep: UsageHistoryPromiseModel.sweep(
          history.sweep(
            async () => {
              const file = await AccountsHostApiModel.accountsFile(host.ctx, store)
              return { accounts: file.accounts, shadowRoot: file.shadowRoot }
            },
            { resolveCredential: resolveKeyFromContext(host.ctx) },
          ),
        ),
        nextSweepAt: UsageHistoryPromiseModel.nextSweepAt(history.nextSweepAt),
        checkEvery: Schedule.spaced('1 minute'),
      })
    }),
  )
}
