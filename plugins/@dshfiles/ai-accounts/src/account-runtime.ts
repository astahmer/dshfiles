import type { Context } from '@deepseek-ai/cordis'
import type { AiAccountsConfig } from './account-config.js'
import type { createAccountPool } from './account-pool.js'
import type { UsageHistoryScheduler } from './usage-recorder.js'
import type { QuotaContinuationService } from './quota-continuation.js'
import type { AccountsUsage } from './api.js'
import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import type { PricingCatalog } from './pricing-catalog.js'
import type { CopilotLoginService } from './copilot-login.js'
import type { AccountLoginService } from './account-login-service.js'
import type { ModelFallbackRouter } from './model-fallback-router.js'
import type { FastModeService } from './codex-fast-mode.js'
import type { FastModeUsageHistoryService } from './fast-mode-usage-history.js'
import type { ServingAccountService } from './serving-account.js'
import type { AccountSetupService } from './account-setup-service.js'

interface AccountRuntime {
  accounts?: { config: AiAccountsConfig; pool: ReturnType<typeof createAccountPool> }
  scheduler?: UsageHistoryScheduler
  quotaContinuations?: QuotaContinuationService
  refreshRoutes?: () => Promise<void>
  /** Accounts the last route build left out (e.g. a refused Codex home), each `instanceId: reason`. */
  rejectedRoutes?: readonly string[]
  refreshModelCatalog?: (instanceId: string) => Promise<void>
  /** Uncurated metadata for editing, including hidden model efforts and native provider defaults. */
  modelCatalogForEditing?: (instanceId: string) => Promise<readonly (LlmResolvedModelInfo & { readonly accountAdditional: boolean })[]>
  usageCache?: { get(): Promise<AccountsUsage>; refresh(): Promise<AccountsUsage>; latest(): AccountsUsage | undefined; invalidate(): void }
  pricing?: PricingCatalog
  copilotLogin?: CopilotLoginService
  accountLogin?: AccountLoginService
  accountSetup?: AccountSetupService
  modelFallbackRouter?: ModelFallbackRouter
  /** Release only this thread's old retry timer after an explicit local selection; never enqueue or cancel Agent work. */
  releaseRetryWait?: (sessionId: string) => void
  fastMode?: FastModeService
  fastModeUsageHistory?: FastModeUsageHistoryService
  servingAccount?: ServingAccountService
}

/** One lock owner for credential mutations and saved-account edits. Reads and other accounts stay concurrent. */
export class AccountSessionWorkModel {
  private static readonly locks = new WeakMap<Context, Set<string>>()
  static readonly isLocked = (ctx: Context, instanceId: string): boolean => AccountSessionWorkModel.locks.get(ctx.root)?.has(instanceId) === true
  static readonly run = async <Result>(ctx: Context, ids: readonly string[], work: () => Promise<Result>): Promise<Result> => {
    let held = AccountSessionWorkModel.locks.get(ctx.root)
    if (held === undefined) {
      held = new Set()
      AccountSessionWorkModel.locks.set(ctx.root, held)
    }
    const selected = [...new Set(ids)]
    if (selected.some(id => held.has(id)))
      throw new Error('An account operation is already running. Wait for it to finish before changing its credentials or profile.')
    for (const id of selected) held.add(id)
    try {
      return await work()
    } finally {
      for (const id of selected) held.delete(id)
    }
  }
}

const runtimes = new WeakMap<Context, AccountRuntime>()
export const accountRuntime = (ctx: Context): AccountRuntime | undefined => runtimes.get(ctx.root)

/** A scoped login belongs to exactly one live connection; legacy calls cannot touch an active wizard. */
export class AccountLoginIntentModel {
  static readonly owns = (ctx: Context, instanceId: string, operationId?: string, allowVerifying = false): boolean => {
    const setup = accountRuntime(ctx)?.accountSetup
    if (operationId === undefined) return setup?.candidate(instanceId) === undefined
    try {
      if (!allowVerifying) return setup?.canBeginLogin(operationId, instanceId) ?? false
      const snapshot = setup?.get(operationId)
      return snapshot?.instanceId === instanceId && (snapshot.status === 'pending' || (allowVerifying && snapshot.status === 'verifying'))
    } catch {
      return false
    }
  }
}

export const activateAccountRuntime = (ctx: Context): AccountRuntime => {
  if (runtimes.has(ctx.root)) throw new Error('AI Accounts is already active on this host.')
  const runtime: AccountRuntime = {}
  runtimes.set(ctx.root, runtime)
  ctx.effect(() => () => {
    runtime.accountSetup?.dispose()
    runtime.scheduler?.dispose()
    runtime.copilotLogin?.dispose()
    runtime.accountLogin?.dispose()
    runtime.fastMode?.clear()
    if (runtimes.get(ctx.root) === runtime) runtimes.delete(ctx.root)
  })
  return runtime
}
