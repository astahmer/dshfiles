import type { Context } from '@deepseek-ai/cordis'
import type { ApiCaller } from '@dshfiles/dshx/api'
import { accountRuntime } from './account-runtime.js'
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
    account: async id => AccountLoginHostModel.accountsFromFile(await accountStoreService.readAccountFile()).find(account => account.instanceId === id),
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
  begin: async ({ ctx, input, caller }) =>
    AccountLoginHostModel.forCaller(await loginFor(ctx).begin(input.instanceId, input.replaceExisting, input.requestId), caller),
  status: ({ ctx, input, caller }) => AccountLoginHostModel.forCaller(loginFor(ctx).state(input.instanceId), caller),
  cancel: ({ ctx, input, caller }) => AccountLoginHostModel.forCaller(loginFor(ctx).cancel(input.instanceId, input.requestId), caller),
})
