import type { Context } from '@deepseek-ai/cordis'
import type { AiAccountsConfig } from './account-config.js'
import type { createAccountPool } from './account-pool.js'
import type { UsageHistoryScheduler } from './usage-recorder.js'

interface AccountRuntime {
  accounts?: { config: AiAccountsConfig; pool: ReturnType<typeof createAccountPool> }
  scheduler?: UsageHistoryScheduler
  refreshRoutes?: () => Promise<void>
}

const runtimes = new WeakMap<Context, AccountRuntime>()
export const accountRuntime = (ctx: Context): AccountRuntime | undefined => runtimes.get(ctx.root)

export const activateAccountRuntime = (ctx: Context): AccountRuntime => {
  if (runtimes.has(ctx.root)) throw new Error('AI Accounts is already active on this host.')
  const runtime: AccountRuntime = {}
  runtimes.set(ctx.root, runtime)
  ctx.effect(() => () => {
    runtime.scheduler?.dispose()
    if (runtimes.get(ctx.root) === runtime) runtimes.delete(ctx.root)
  })
  return runtime
}
