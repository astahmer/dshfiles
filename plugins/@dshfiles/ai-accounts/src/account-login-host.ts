import type { Context } from '@deepseek-ai/cordis'
import type { ApiCaller } from '@dshfiles/dshx/api'
import { accountRuntime, AccountLoginIntentModel } from './account-runtime.js'
import { AccountStoreModel, accountStoreService, type AccountStoreFile } from './account-store.js'
import { accountLoginMetadata, aiAccountsLoginApi, type AccountLoginState } from './account-login-api.js'
import { createAccountLoginService, type AccountLoginAccount } from './account-login-service.js'
import { createCodexLoginFiles } from './codex-login-files.js'

export class AccountLoginHostModel {
  static readonly accountsFromFile = (file: AccountStoreFile): AccountLoginAccount[] =>
    file.accounts.map(account => {
      if (account.kind !== 'codex') return { instanceId: account.instanceId, kind: account.kind }
      try {
        return { instanceId: account.instanceId, kind: account.kind, layout: AccountStoreModel.codexLayoutFor(account, file.shadowRoot) }
      } catch {
        return { instanceId: account.instanceId, kind: account.kind }
      }
    })

  /** Never put a human device code into any agent/plugin tool result, not just its rendered text. */
  static readonly forCaller = (state: AccountLoginState, caller: ApiCaller): AccountLoginState =>
    caller.kind === 'client' ? state : accountLoginMetadata(state)
}

export const installAccountLogin = (ctx: Context): void => {
  const runtime = accountRuntime(ctx)
  if (runtime === undefined) throw new Error('AI Accounts runtime is unavailable.')
  runtime.accountLogin = createAccountLoginService({
    files: createCodexLoginFiles(path => AccountStoreModel.isManagedSetupHome(path, 'codex')),
    account: async id => {
      const file = await accountStoreService.readAccountFile()
      const pending = runtime.accountSetup?.candidates() ?? []
      return AccountLoginHostModel.accountsFromFile({ ...file, accounts: [...pending, ...file.accounts] }).find(account => account.instanceId === id)
    },
    deferAdoption: id => runtime.accountSetup?.candidate(id) !== undefined,
    onComplete: async () => {
      runtime.usageCache?.invalidate()
      await runtime.refreshRoutes?.()
    },
  })
}

const loginFor = (ctx: Context) => {
  const login = accountRuntime(ctx)?.accountLogin
  if (login === undefined) throw new Error('Managed account sign-in is unavailable.')
  return login
}

export const accountLoginHostApi = aiAccountsLoginApi.host({
  begin: async ({ ctx, input, caller }) => {
    if (!AccountLoginIntentModel.owns(ctx, input.instanceId, input.operationId)) throw new Error('This account sign-in intent is no longer active.')
    return AccountLoginHostModel.forCaller(await loginFor(ctx).begin(input.instanceId, input.replaceExisting), caller)
  },
  status: ({ ctx, input, caller }) => AccountLoginHostModel.forCaller(loginFor(ctx).state(input.instanceId), caller),
  cancel: async ({ ctx, input, caller }) => {
    const login = loginFor(ctx)
    if (!AccountLoginIntentModel.owns(ctx, input.instanceId, input.operationId, true))
      return AccountLoginHostModel.forCaller(login.state(input.instanceId), caller)
    if (input.operationId !== undefined) await accountRuntime(ctx)?.accountSetup?.discard(input.operationId)
    else login.cancel(input.instanceId)
    return AccountLoginHostModel.forCaller(login.state(input.instanceId), caller)
  },
})
