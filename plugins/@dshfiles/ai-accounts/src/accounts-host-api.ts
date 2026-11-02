import type { Context } from '@deepseek-ai/cordis'
import {
  AccountSignInActive,
  AccountUnsuitable,
  BrowserOnlyCredential,
  HostServiceUnavailable,
  LoginIntentInactive,
  SecretCatalogUnavailable,
  SetupMethodRetired,
} from './errors.js'
import type { ApiCaller } from '@dshfiles/dshx/api'
import type { CopilotLoginState } from './api.js'

import type { ModelCatalog, ModelCatalogModel, ModelSelection } from '@deepseek-ai/dsh-api-session-controller'
import type { SecretCatalogCredentialBridge, SecretCatalogValues } from '@dshfiles/credential-port'
import { accountRuntime, AccountLoginIntentModel, AccountSessionWorkModel } from './account-runtime.js'
import { configFromAccountsFile } from './account-config.js'
import { hostname } from 'node:os'
import {
  aiAccountsApi,
  baseModelName,
  FORECAST_HISTORY_BUCKET_MINUTES,
  FORECAST_HISTORY_DAYS,
  isKeyEnvName,
  type AccountsFile,
  type AccountsUsage,
  type QuotaRecoveryModelCatalog,
  type QuotaRecoveryModelSelection,
} from './api.js'
import { AccountHomePolicy } from './account-home-policy.js'
import { accountStoreService } from './account-store.js'
import { accountSessionRelatedIds } from './account-session-host.js'
import { ModelCurationModel } from './model-curation-model.js'
import { readAccountUsage } from './account-usage.js'
import { resolveKeyFromContext } from './credentials.js'
import { createUsageHistoryService } from './usage-recorder.js'
import { knownQuotaResetAt } from './quota-reset.js'
import { mapRolling } from './rolling-concurrency.js'
import { readNativeProviders, setNativeProviderEnabled } from './native-providers.js'
import { PricingCatalogModel } from './pricing-catalog.js'
import { AccountSettingsModel } from './settings.js'
import { createCopilotCredentialsService } from './copilot-credentials.js'
import { Api } from '@dshfiles/dshx/effect'
import { effectHandler } from './host-effect.js'

/**
 * The one read operation. Profiles come from the accounts file, joined with the
 * pool's live health and each home's observed login, so the page and the agent's
 * `ai_accounts` tool can never describe different state.
 */
const quotaRecoveryModelForClient = (model: ModelCatalogModel): QuotaRecoveryModelCatalog['groups'][number]['models'][number] => {
  const named = { id: model.id, name: model.name }
  const described = model.description === undefined ? named : { ...named, description: model.description }
  if (model.reasoning === undefined) return described
  const efforts = model.reasoning.efforts.map(effort => ({ id: effort.id, name: effort.name }))
  const reasoning = model.reasoning.defaultEffort === undefined ? { efforts } : { efforts, defaultEffort: model.reasoning.defaultEffort }
  return { ...described, reasoning }
}

const quotaRecoveryCatalogForClient = (catalog: ModelCatalog): QuotaRecoveryModelCatalog => ({
  default: catalog.default,
  routableProviders: [...catalog.routableProviders],
  groups: catalog.groups.map(group => ({ id: group.id, name: group.name, models: group.models.map(quotaRecoveryModelForClient) })),
  failures: catalog.failures.map(failure => ({ id: failure.id, name: failure.name, message: failure.message })),
})

const selectionForContinuation = (selection: QuotaRecoveryModelSelection | undefined): ModelSelection | undefined => {
  if (selection === undefined) return undefined
  if (selection.reasoningEffort === undefined) return { provider: selection.provider, model: selection.model }
  return { provider: selection.provider, model: selection.model, reasoningEffort: selection.reasoningEffort }
}

const accountsFile = async (ctx: Context): Promise<AccountsFile> =>
  accountStoreService.buildAccountsFile(
    await accountStoreService.readAccountFile(),
    accountRuntime(ctx)?.accounts?.pool.describe() ?? [],
    resolveKeyFromContext(ctx),
    async instanceId => (await createCopilotCredentialsService(ctx.get('credentials')).read(instanceId)) !== undefined,
  )

const pricingFor = (ctx: Context) => {
  const pricing = accountRuntime(ctx)?.pricing
  if (pricing === undefined) throw new Error('The pricing catalog is unavailable')
  return pricing
}

const quotaContinuationServiceFor = (ctx: Context) => {
  const service = accountRuntime(ctx)?.quotaContinuations
  if (service === undefined) throw new Error('Quota recovery service is unavailable')
  return service
}

const secretCatalogBridgeFor = (ctx: Context): SecretCatalogCredentialBridge | undefined => ctx.get('secretCatalogCredentials')

const setupFor = (ctx: Context) => {
  const service = accountRuntime(ctx)?.accountSetup
  if (service === undefined) throw new Error('Account connection setup requires the updated Host. Restart when idle before connecting an account.')
  return service
}

const copilotLoginFor = (ctx: Context) => {
  const service = accountRuntime(ctx)?.copilotLogin
  if (service === undefined) throw new Error('GitHub Copilot sign-in is unavailable.')
  return service
}

export const accountsHostApi = Api.bind(aiAccountsApi, {
  read: effectHandler(aiAccountsApi, 'read', async ({ ctx }) => {
    // A changed file means changed routes, so rebuild before answering.
    await refreshRoutes(ctx)
    return accountsFile(ctx)
  }),
  filePath: effectHandler(aiAccountsApi, 'filePath', () => AccountHomePolicy.filePath()),
  secretCatalogKeys: effectHandler(aiAccountsApi, 'secretCatalogKeys', async ({ input, ctx }) => {
    const bridge = secretCatalogBridgeFor(ctx)
    if (bridge === undefined) return { available: false, items: [] }
    try {
      return { available: true, items: [...(await bridge.listKeys(input.cwd))] }
    } catch {
      return { available: false, items: [] }
    }
  }),
  importSecretCatalogKey: effectHandler(aiAccountsApi, 'importSecretCatalogKey', ({ input, ctx }) =>
    AccountSessionWorkModel.run(ctx, [input.instanceId], async () => {
      const account = (await accountStoreService.readAccountFile()).accounts.find(candidate => candidate.instanceId === input.instanceId)
      if (account === undefined || account.kind === 'codex') throw new AccountUnsuitable({ instanceId: input.instanceId, reason: 'not-keyed' })
      if (!isKeyEnvName(account.apiKeyEnv)) throw new AccountUnsuitable({ instanceId: input.instanceId, reason: 'invalid-key-env' })
      const bridge = secretCatalogBridgeFor(ctx)
      if (bridge === undefined) throw new SecretCatalogUnavailable({ reason: 'inactive' })
      await bridge.importKey({
        alias: input.alias,
        environment: input.environment,
        scope: input.scope,
        cwd: input.cwd,
        targetRef: account.apiKeyEnv,
        replaceExisting: input.replaceExisting,
      })
      accountRuntime(ctx)?.usageCache?.invalidate()
      return { imported: true, apiKeyEnv: account.apiKeyEnv }
    }),
  ),
  createSetupAccount: effectHandler(aiAccountsApi, 'createSetupAccount', () => {
    throw new SetupMethodRetired()
  }),
  prepareAccountConnection: effectHandler(aiAccountsApi, 'prepareAccountConnection', ({ input, ctx }) =>
    AccountSessionWorkModel.run(ctx, input.existingInstanceId === undefined ? [] : [input.existingInstanceId], () => setupFor(ctx).prepare(input)),
  ),
  getAccountConnection: effectHandler(aiAccountsApi, 'getAccountConnection', ({ input, ctx }) => setupFor(ctx).get(input.operationId)),
  configureAccountConnection: effectHandler(aiAccountsApi, 'configureAccountConnection', ({ input, ctx }) => {
    const { operationId, ...configuration } = input
    const account = setupFor(ctx).get(operationId).account
    const ids =
      account === null
        ? []
        : [
            ...accountSessionRelatedIds(account),
            ...accountSessionRelatedIds({
              ...account,
              homePath: configuration.homePath ?? account.homePath,
              shadowHomePath: configuration.shadowHomePath ?? account.shadowHomePath,
              apiKeyEnv: configuration.apiKeyEnv ?? account.apiKeyEnv,
            }),
          ]
    return AccountSessionWorkModel.run(ctx, ids, () => setupFor(ctx).configure(operationId, configuration))
  }),
  stageAccountConnectionKey: effectHandler(aiAccountsApi, 'stageAccountConnectionKey', ({ input, ctx, caller }) => {
    if (caller.kind !== 'client') throw new BrowserOnlyCredential()
    return setupFor(ctx).stageKey(input.operationId, input.value)
  }),
  importAccountConnectionKey: effectHandler(aiAccountsApi, 'importAccountConnectionKey', async ({ input, ctx }) => {
    const setup = setupFor(ctx)
    setup.get(input.operationId)
    const bridge = secretCatalogBridgeFor(ctx)
    const values = AccountsHostApiModel.scopedCatalogValues(ctx.get('secretCatalogValues'))
    if (bridge === undefined) throw new SecretCatalogUnavailable({ reason: 'inactive' })
    const cwd = input.scope === 'global' ? null : input.cwd
    if (input.scope !== 'global' && cwd === null) throw new SecretCatalogUnavailable({ reason: 'scope-folder' })
    const rows = (await bridge.listKeys(cwd)).filter(row => row.alias === input.alias && row.environment === input.environment)
    if (rows.length !== 1 || rows[0]?.scope !== input.scope) throw new SecretCatalogUnavailable({ reason: 'ambiguous' })
    let value: string
    try {
      value = await values.resolve({ reference: { alias: input.alias, environment: input.environment }, cwd, expectedScope: input.scope })
    } catch (cause) {
      throw new SecretCatalogUnavailable({ reason: 'unreadable', cause })
    }
    return setup.stageKey(input.operationId, value)
  }),
  completeAccountConnection: effectHandler(aiAccountsApi, 'completeAccountConnection', ({ input, ctx }) => {
    const account = setupFor(ctx).get(input.operationId).account
    return AccountSessionWorkModel.run(ctx, account === null ? [] : accountSessionRelatedIds(account), () => setupFor(ctx).complete(input.operationId))
  }),
  discardAccountConnection: effectHandler(aiAccountsApi, 'discardAccountConnection', async ({ input, ctx }) => {
    await setupFor(ctx).discard(input.operationId)
    return { discarded: true } satisfies { readonly discarded: true }
  }),
  save: effectHandler(aiAccountsApi, 'save', ({ input, ctx }) =>
    AccountSessionWorkModel.run(
      ctx,
      [...accountSessionRelatedIds(input.draft), ...(input.previousInstanceId === undefined ? [] : [input.previousInstanceId])],
      async () => {
        await accountStoreService.upsertAccount(input.draft, input.previousInstanceId, true)
        accountRuntime(ctx)?.usageCache?.invalidate()
        await refreshRoutes(ctx)
        return accountsFile(ctx)
      },
    ),
  ),
  remove: effectHandler(aiAccountsApi, 'remove', ({ input, ctx }) =>
    AccountSessionWorkModel.run(ctx, [input.instanceId], async () => {
      await accountStoreService.removeAccount(input.instanceId)
      accountRuntime(ctx)?.usageCache?.invalidate()
      await refreshRoutes(ctx)
      return accountsFile(ctx)
    }),
  ),
  removeCustomModel: effectHandler(aiAccountsApi, 'removeCustomModel', ({ input, ctx }) =>
    AccountSessionWorkModel.run(ctx, [input.instanceId], async () => {
      const account = (await accountStoreService.readAccountFile()).accounts.find(profile => profile.instanceId === input.instanceId)
      if (account === undefined) return { removed: false, instanceId: input.instanceId, modelId: input.modelId }
      const patch = ModelCurationModel.removeAdditionalModel({ account, modelId: input.modelId })
      if (patch === null) return { removed: false, instanceId: input.instanceId, modelId: input.modelId }
      await accountStoreService.upsertAccount({ ...account, ...patch }, undefined, true)
      await refreshRoutes(ctx)
      return { removed: true, instanceId: input.instanceId, modelId: input.modelId }
    }),
  ),
  moveAccount: effectHandler(aiAccountsApi, 'moveAccount', async ({ input, ctx }) => {
    await accountStoreService.moveAccount(input.instanceId, input.direction)
    await refreshRoutes(ctx)
    return accountsFile(ctx)
  }),
  reorderAccount: effectHandler(aiAccountsApi, 'reorderAccount', async ({ input, ctx }) => {
    await accountStoreService.reorderAccount(input)
    await refreshRoutes(ctx)
    return accountsFile(ctx)
  }),
  setDistribution: effectHandler(aiAccountsApi, 'setDistribution', async ({ input, ctx }) => {
    await accountStoreService.setDistribution(input.distribution)
    await refreshRoutes(ctx)
    return accountsFile(ctx)
  }),
  identity: effectHandler(aiAccountsApi, 'identity', async ({ input }) => accountStoreService.readAccountIdentity(input.instanceId)),
  beginCopilotLogin: effectHandler(aiAccountsApi, 'beginCopilotLogin', ({ input, ctx, caller }) =>
    AccountSessionWorkModel.run(ctx, [input.instanceId], async () => {
      if (!AccountLoginIntentModel.owns(ctx, input.instanceId, input.operationId)) throw new LoginIntentInactive({ instanceId: input.instanceId })
      return AccountsHostApiModel.copilotForCaller(await copilotLoginFor(ctx).begin(input.instanceId), caller)
    }),
  ),
  copilotLoginStatus: effectHandler(aiAccountsApi, 'copilotLoginStatus', async ({ input, ctx, caller }) =>
    AccountsHostApiModel.copilotForCaller(copilotLoginFor(ctx).state(input.instanceId), caller),
  ),
  cancelCopilotLogin: effectHandler(aiAccountsApi, 'cancelCopilotLogin', async ({ input, ctx }) => {
    if (!AccountLoginIntentModel.owns(ctx, input.instanceId, input.operationId, true)) return { cancelled: true } satisfies { readonly cancelled: true }
    if (input.operationId !== undefined) await setupFor(ctx).discard(input.operationId)
    else copilotLoginFor(ctx).cancel(input.instanceId)
    return { cancelled: true } satisfies { readonly cancelled: true }
  }),
  signOutCopilot: effectHandler(aiAccountsApi, 'signOutCopilot', ({ input, ctx }) =>
    AccountSessionWorkModel.run(ctx, [input.instanceId], async () => {
      const login = copilotLoginFor(ctx)
      if (
        !AccountLoginIntentModel.owns(ctx, input.instanceId) ||
        ['starting', 'waiting'].includes(login.state(input.instanceId).status) ||
        login.readPending(input.instanceId) !== undefined
      )
        throw new AccountSignInActive({ instanceId: input.instanceId })
      await login.signOut(input.instanceId)
      accountRuntime(ctx)?.usageCache?.invalidate()
      return { signedOut: true }
    }),
  ),
  catalog: effectHandler(aiAccountsApi, 'catalog', async ({ input, ctx }) => {
    await refreshRoutes(ctx)
    const llm = ctx.get('llm')
    if (llm === undefined) return { instanceId: input.instanceId, models: [] }
    let warning: string | undefined
    try {
      await accountRuntime(ctx)?.refreshModelCatalog?.(input.instanceId)
    } catch {
      warning = 'Live catalog refresh failed; showing the last-known model list.'
    }
    // The editor needs the native catalog, not the already hidden/ordered/pinned routing projection.
    const editingCatalog = accountRuntime(ctx)?.modelCatalogForEditing
    const models =
      editingCatalog === undefined
        ? await Promise.all((await llm.listModels(input.instanceId)).map(model => llm.resolveModelInfo(input.instanceId, model.id)))
        : await editingCatalog(input.instanceId)
    const resolved = models.map(model => ({
      id: model.id,
      name: baseModelName(input.instanceId, model.name),
      efforts: (model.reasoning?.efforts ?? []).map(effort => ({ id: effort.id, name: effort.name })),
      defaultEffort: model.reasoning?.defaultEffort ?? null,
      ...('accountAdditional' in model && typeof model.accountAdditional === 'boolean' && { accountAdditional: model.accountAdditional }),
    }))
    const catalog = { instanceId: input.instanceId, models: resolved }
    if (warning === undefined) return catalog
    return { ...catalog, warning }
  }),
  nativeProviders: effectHandler(aiAccountsApi, 'nativeProviders', async ({ ctx }) => readNativeProviders(ctx)),
  setNativeProviderEnabled: effectHandler(aiAccountsApi, 'setNativeProviderEnabled', async ({ input, ctx }) => setNativeProviderEnabled(ctx, input)),
  usage: effectHandler(aiAccountsApi, 'usage', async ({ ctx }) => accountRuntime(ctx)?.usageCache?.get() ?? readAccountsUsage(ctx)),
  refreshUsage: effectHandler(aiAccountsApi, 'refreshUsage', async ({ ctx }) => accountRuntime(ctx)?.usageCache?.refresh() ?? readAccountsUsage(ctx)),
  history: effectHandler(aiAccountsApi, 'history', async ({ input, ctx }) => ({
    instanceId: input.instanceId,
    points: [...(await createUsageHistoryService(ctx).read(input.instanceId, Date.now() - input.days * 24 * 60 * 60_000, input.bucketMinutes))],
  })),
  forecastHistoryBatch: effectHandler(aiAccountsApi, 'forecastHistoryBatch', async ({ input, ctx }) => ({
    histories: (
      await createUsageHistoryService(ctx).readMany(input.instanceIds, Date.now() - FORECAST_HISTORY_DAYS * 24 * 60 * 60_000, FORECAST_HISTORY_BUCKET_MINUTES)
    ).map(history => ({
      instanceId: history.instanceId,
      points: history.points.map(point => ({
        at: point.at,
        windows: point.windows,
        resetsAt: point.resetsAt,
        bankedResets: point.bankedResets,
        bankedResetExpiries: point.bankedResetExpiries ?? [],
      })),
    })),
  })),
  fastModeHistory: effectHandler(aiAccountsApi, 'fastModeHistory', async ({ input, ctx }) => ({
    instanceId: input.instanceId,
    ...((await accountRuntime(ctx)?.fastModeUsageHistory?.read(input.instanceId, Date.now() - input.days * 24 * 60 * 60_000)) ?? { points: [] }),
  })),
  historySettings: effectHandler(aiAccountsApi, 'historySettings', async ({ ctx }) => createUsageHistoryService(ctx).readSettings()),
  saveHistorySettings: effectHandler(aiAccountsApi, 'saveHistorySettings', async ({ input, ctx }) => {
    const settings = await createUsageHistoryService(ctx).saveSettings(input)
    try {
      await accountRuntime(ctx)?.fastModeUsageHistory?.prune(settings.retentionDays)
    } catch (error) {
      ctx.logger.warn('ai-accounts: Fast mode usage retention pruning failed (%s)', error instanceof Error ? error.name : 'unknown error')
    }
    return settings
  }),
  collectUsage: effectHandler(aiAccountsApi, 'collectUsage', async ({ ctx }) => ({ recorded: (await accountRuntime(ctx)?.scheduler?.collectNow()) ?? 0 })),
  pricingStatus: effectHandler(aiAccountsApi, 'pricingStatus', async ({ ctx }) => pricingFor(ctx).status()),
  refreshPricing: effectHandler(aiAccountsApi, 'refreshPricing', async ({ ctx }) => pricingFor(ctx).refresh()),
  quoteRoutes: effectHandler(aiAccountsApi, 'quoteRoutes', async ({ input, ctx }) => {
    const pricing = pricingFor(ctx)
    const settings = AccountSettingsModel.readPricingSettings()
    if (pricing.current() === null && settings.costEstimates) void pricing.ensureFresh(0)
    const file = await accountStoreService.readAccountFile()
    const kinds = new Map(file.accounts.map(account => [account.instanceId.trim() || account.kind, account.kind]))
    const cache = pricing.current()
    return {
      fetchedAt: cache?.fetchedAt ?? null,
      quotes: input.routes.map(route =>
        PricingCatalogModel.resolveRouteQuote({
          route,
          cache,
          accountKind: typeof route.provider === 'string' ? kinds.get(route.provider) : undefined,
          overrides: settings.pricingOverrides,
        }),
      ),
    }
  }),
  quotaContinuations: effectHandler(aiAccountsApi, 'quotaContinuations', async ({ ctx }) => quotaContinuationServiceFor(ctx).list()),
  quotaRecoveryModelCatalog: effectHandler(aiAccountsApi, 'quotaRecoveryModelCatalog', async ({ ctx }) => {
    const controller = ctx.get('sessionController')
    if (controller === undefined) throw new HostServiceUnavailable({ service: 'session-controller' })
    return quotaRecoveryCatalogForClient(await controller.modelCatalog())
  }),
  resumeQuotaContinuation: effectHandler(aiAccountsApi, 'resumeQuotaContinuation', async ({ input, ctx }) => {
    return quotaContinuationServiceFor(ctx).resume(input.continuationId, selectionForContinuation(input.selection))
  }),
  setQuotaContinuationAutoRetry: effectHandler(aiAccountsApi, 'setQuotaContinuationAutoRetry', async ({ input, ctx }) =>
    quotaContinuationServiceFor(ctx).setAutoRetry(input.continuationId, input.sessionId, input.enabled),
  ),
  snoozeQuotaContinuation: effectHandler(aiAccountsApi, 'snoozeQuotaContinuation', async ({ input, ctx }) =>
    quotaContinuationServiceFor(ctx).snooze(input.continuationId, input.duration),
  ),
  dismissQuotaContinuation: effectHandler(aiAccountsApi, 'dismissQuotaContinuation', async ({ input, ctx }) =>
    quotaContinuationServiceFor(ctx).dismiss(input.continuationId),
  ),
})

/** Provider reads are independent; bound them so a profile with 64 accounts is not a 64-request burst. */
const ACCOUNT_USAGE_READ_CONCURRENCY = 4

const readQuotaResetAt = async (ctx: Context, accountId: string): Promise<number | null> => {
  const file = await accountsFile(ctx)
  const account = file.accounts.find(profile => profile.instanceId === accountId)
  if (account === undefined) return null
  return knownQuotaResetAt(
    await readAccountUsage({
      account,
      shadowRoot: file.shadowRoot,
      resolveCredential: resolveKeyFromContext(ctx),
      readCopilotCredential: createCopilotCredentialsService(ctx.get('credentials')).read,
    }),
    Date.now(),
  )
}

/**
 * Live quota for every account, read with each account's own credential.
 *
 * One sweep covers the whole panel: the Client renders it as cards and refreshes
 * on an interval, so a provider that is slow or down costs its own card rather
 * than the panel.
 */
const readAccountsUsage = async (ctx: Context, signal?: AbortSignal): Promise<AccountsUsage> => {
  // Read the observed file so a Codex account uses the same shadow home the
  // panel already shows, not a re-derived guess.
  const file = await accountsFile(ctx)
  const resolveCredential = resolveKeyFromContext(ctx)
  const readCopilotCredential = createCopilotCredentialsService(ctx.get('credentials')).read
  const cards = await mapRolling({
    items: file.accounts,
    concurrency: ACCOUNT_USAGE_READ_CONCURRENCY,
    map: async account => ({
      instanceId: account.instanceId,
      displayName: account.displayName,
      kind: account.kind,
      enabled: account.enabled,
      usage: await readAccountUsage({ account, shadowRoot: file.shadowRoot, resolveCredential, readCopilotCredential, signal }),
    }),
  })
  return { readAt: Date.now(), hostName: hostname(), cards }
}

/**
 * Rebuild provider routes from the accounts file.
 *
 * Routes are derived state, so editing a profile changes the model picker. The
 * pool is reused across a rebuild so a rate-limited account stays cooling rather
 * than being reset by an unrelated save, and only accounts whose identity or
 * enabled flag actually changed are re-registered, because the adapter registry
 * rejects a duplicate route for one already taken.
 */
const refreshRoutes = async (ctx: Context): Promise<void> => {
  const runtime = accountRuntime(ctx)
  if (runtime === undefined) return
  if (runtime.refreshRoutes !== undefined) {
    await runtime.refreshRoutes()
    return
  }
  const activeAccounts = runtime.accounts
  if (activeAccounts === undefined) return
  const file = await accountStoreService.readAccountFile()
  const config = configFromAccountsFile(file)
  activeAccounts.config = config
  activeAccounts.pool.setDistribution(file.distribution)
}

export class AccountsHostApiModel {
  static scopedCatalogValues(values: SecretCatalogValues | undefined): SecretCatalogValues {
    if (values?.supportsExpectedScope !== true) throw new SecretCatalogUnavailable({ reason: 'outdated' })
    return values
  }

  static copilotForCaller(state: CopilotLoginState, caller: ApiCaller): CopilotLoginState {
    return caller.kind === 'client' ? state : { ...state, userCode: null, verificationUri: null }
  }

  static readonly accountsFile = accountsFile
  static readonly readAccountsUsage = readAccountsUsage
  static readonly readQuotaResetAt = readQuotaResetAt
}
