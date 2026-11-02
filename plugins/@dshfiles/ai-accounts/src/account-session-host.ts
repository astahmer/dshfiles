import type { Context } from '@deepseek-ai/cordis'
import { AccountSignInActive } from './errors.js'
import { accountRuntime } from './account-runtime.js'
import { AccountLocks } from './account-locks.js'
import { Effect } from 'effect'
import { accountStoreService } from './account-store.js'
import { Api } from '@dshfiles/dshx/effect'
import { aiAccountsSessionApi } from './account-session-api.js'
import { effectHandler, lockedHandler } from './host-effect.js'
import { createAccountSessionService, type AccountSessionService } from './account-session-service.js'
import { CopilotCredentialModel } from './copilot-credentials.js'
import { AccountHomePolicy } from './account-home-policy.js'
import type { AccountDraft } from './api.js'
import { ClaudeAccountModel, claudeAccountService } from './claude-account.js'

/** A reconnect cannot start writing a saved account's credential home while sign-out owns it. */
export const accountSessionRelatedIds = (account: AccountDraft): readonly string[] => {
  const file = accountStoreService.readAccountFileSync()
  const homes = (candidate: AccountDraft): readonly string[] => {
    if (candidate.kind === 'codex') {
      try {
        return [AccountHomePolicy.codexLayoutFor(candidate, file.shadowRoot).effectiveHomePath]
      } catch {
        return [candidate.homePath, candidate.shadowHomePath]
      }
    }
    if (candidate.kind === 'claude') return [ClaudeAccountModel.resolveClaudeConfigDir(candidate.homePath)]
    return [candidate.homePath, candidate.shadowHomePath]
  }
  const selected = homes(account).filter(home => home !== '')
  return [
    account.instanceId,
    ...file.accounts
      .filter(
        other =>
          (account.apiKeyEnv !== '' && other.apiKeyEnv === account.apiKeyEnv) ||
          homes(other).some(
            home =>
              home !== '' &&
              selected.some(path => AccountHomePolicy.containsConfiguredHome(path, home) || AccountHomePolicy.containsConfiguredHome(home, path)),
          ),
      )
      .map(other => other.instanceId),
  ]
}

const services = new WeakMap<Context, AccountSessionService>()
const busy = (ctx: Context, account: AccountDraft): boolean => {
  const runtime = accountRuntime(ctx)
  const active = (state: string | undefined): boolean => state === 'starting' || state === 'waiting'
  if (active(runtime?.accountLogin?.state(account.instanceId).status) || active(runtime?.copilotLogin?.state(account.instanceId).status)) return true
  if (runtime?.accountLogin?.pendingHome(account.instanceId) !== undefined || runtime?.copilotLogin?.readPending(account.instanceId) !== undefined) return true
  return (
    runtime?.accountSetup
      ?.candidates()
      .some(
        candidate =>
          accountSessionRelatedIds(candidate).includes(account.instanceId) ||
          (account.apiKeyEnv !== '' && candidate.apiKeyEnv === account.apiKeyEnv) ||
          [account.homePath, account.shadowHomePath].some(
            home => home !== '' && [candidate.homePath, candidate.shadowHomePath].some(selected => AccountHomePolicy.containsConfiguredHome(home, selected)),
          ),
      ) ?? false
  )
}
const serviceFor = (ctx: Context): AccountSessionService => {
  const existing = services.get(ctx.root)
  if (existing !== undefined) return existing
  const service = createAccountSessionService({
    readAccounts: () => accountStoreService.readAccountFile(),
    credentials: ctx.get('credentials'),
    copilot: {
      writable: async id =>
        (await ctx.get('credentials')?.describeRecord(CopilotCredentialModel.key(id)))?.writable === true && accountRuntime(ctx)?.copilotLogin !== undefined,
      signOut: async id => {
        const login = accountRuntime(ctx)?.copilotLogin
        if (login === undefined) throw new Error('Copilot sign-out is unavailable.')
        await login.signOut(id)
      },
    },
    isBusy: account => busy(ctx, account),
    onSignedOut: async account => {
      // Credentials are read per request; do not remove, disable or rewrite the account's route/profile.
      if (account.kind === 'claude') claudeAccountService.invalidateUsage(ClaudeAccountModel.resolveClaudeConfigDir(account.homePath))
      accountRuntime(ctx)?.usageCache?.invalidate()
    },
  })
  services.set(ctx.root, service)
  ctx.effect(() => () => {
    if (services.get(ctx.root) === service) services.delete(ctx.root)
  })
  return service
}
const readCapability = effectHandler(aiAccountsSessionApi, 'capability', ({ ctx, input }) => serviceFor(ctx).capability(input.instanceId))

export const accountSessionHostApi = Api.bind(aiAccountsSessionApi, {
  capability: Effect.fn('ai accounts capability')(function* (input, call) {
    const locks = yield* AccountLocks
    if (yield* locks.isLocked(input.instanceId))
      return {
        instanceId: input.instanceId,
        available: false,
        reason: 'An account operation is already running. Wait for it to finish before signing out.',
        credentialScope: null,
      }
    return yield* readCapability(input, call)
  }),
  signOut: lockedHandler(
    aiAccountsSessionApi,
    'signOut',
    ({ input }) => [input.instanceId],
    async ({ ctx, input }) => {
      // Join any cancelled Codex subprocess that is still exiting. Never cancel a live attempt ourselves.
      const file = await accountStoreService.readAccountFile()
      const account = file.accounts.find(candidate => candidate.instanceId === input.instanceId)
      if (account !== undefined && busy(ctx, account)) throw new AccountSignInActive({ instanceId: input.instanceId })
      await accountRuntime(ctx)?.accountLogin?.settledAccount(input.instanceId)
      return serviceFor(ctx).signOut(input)
    },
  ),
})
