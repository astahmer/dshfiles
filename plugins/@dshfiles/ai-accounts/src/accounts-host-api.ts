import type { Context } from '@deepseek-ai/cordis'
import type { ModelCatalog, ModelCatalogModel, ModelSelection } from '@deepseek-ai/dsh-api-session-controller'
import type { SecretCatalogCredentialBridge } from '@dshfiles/secret-catalog/credential-bridge-contract'
import { accountRuntime } from './account-runtime.js'
import { configFromAccountsFile } from './account-config.js'
import { hostname } from 'node:os'
import {
  aiAccountsApi,
  baseModelName,
  isKeyEnvName,
  type AccountsFile,
  type AccountsUsage,
  type QuotaRecoveryModelCatalog,
  type QuotaRecoveryModelSelection,
} from './api.js'
import { AccountStoreModel, accountStoreService } from './account-store.js'
import { readAccountUsage } from './account-usage.js'
import { resolveKeyFromContext } from './credentials.js'
import { createUsageHistoryService } from './usage-recorder.js'
import { knownQuotaResetAt } from './quota-reset.js'
import { mapRolling } from './rolling-concurrency.js'
import { readNativeProviders, setNativeProviderEnabled } from './native-providers.js'
import { PricingCatalogModel } from './pricing-catalog.js'
import { AccountSettingsModel } from './settings.js'
import { createCopilotCredentialsService } from './copilot-credentials.js'

/**
 * The one read operation. Profiles come from the accounts file, joined with the
 * pool's live health and each home's observed login, so the page and the agent's
 * `ai_accounts` tool can never describe different state.
 */
const quotaRecoveryModelForClient = (model: ModelCatalogModel): QuotaRecoveryModelCatalog['groups'][number]['models'][number] => {
  const result: QuotaRecoveryModelCatalog['groups'][number]['models'][number] = { id: model.id, name: model.name }
  if (model.description !== undefined) result.description = model.description
  if (model.reasoning !== undefined) {
    const reasoning: NonNullable<typeof result.reasoning> = {
      efforts: model.reasoning.efforts.map(effort => ({ id: effort.id, name: effort.name })),
    }
    if (model.reasoning.defaultEffort !== undefined) reasoning.defaultEffort = model.reasoning.defaultEffort
    result.reasoning = reasoning
  }
  return result
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

const copilotLoginFor = (ctx: Context) => {
  const service = accountRuntime(ctx)?.copilotLogin
  if (service === undefined) throw new Error('GitHub Copilot sign-in is unavailable.')
  return service
}

export const accountsHostApi = aiAccountsApi.host({
  read: async ({ ctx }) => {
    // A changed file means changed routes, so rebuild before answering.
    await refreshRoutes(ctx)
    return accountsFile(ctx)
  },
  filePath: () => AccountStoreModel.filePath(),
  secretCatalogKeys: async ({ input, ctx }) => {
    const bridge = secretCatalogBridgeFor(ctx)
    if (bridge === undefined) return { available: false, items: [] }
    try {
      return { available: true, items: [...(await bridge.listKeys(input.cwd))] }
    } catch {
      return { available: false, items: [] }
    }
  },
  importSecretCatalogKey: async ({ input, ctx }) => {
    const account = (await accountStoreService.readAccountFile()).accounts.find(candidate => candidate.instanceId === input.instanceId)
    if (account === undefined || account.kind === 'codex') throw new Error('This keyed account is no longer available.')
    if (!isKeyEnvName(account.apiKeyEnv)) throw new Error('Save a valid API-key variable ending in _API_KEY first.')
    const bridge = secretCatalogBridgeFor(ctx)
    if (bridge === undefined) throw new Error('Secret Catalog is not active.')
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
  },
  save: async ({ input, ctx }) => {
    await accountStoreService.upsertAccount(input.draft, input.previousInstanceId)
    accountRuntime(ctx)?.usageCache?.invalidate()
    await refreshRoutes(ctx)
    return accountsFile(ctx)
  },
  remove: async ({ input, ctx }) => {
    await accountStoreService.removeAccount(input.instanceId)
    accountRuntime(ctx)?.usageCache?.invalidate()
    await refreshRoutes(ctx)
    return accountsFile(ctx)
  },
  moveAccount: async ({ input, ctx }) => {
    await accountStoreService.moveAccount(input.instanceId, input.direction)
    await refreshRoutes(ctx)
    return accountsFile(ctx)
  },
  setDistribution: async ({ input, ctx }) => {
    await accountStoreService.setDistribution(input.distribution)
    await refreshRoutes(ctx)
    return accountsFile(ctx)
  },
  identity: async ({ input }) => accountStoreService.readAccountIdentity(input.instanceId),
  beginCopilotLogin: async ({ input, ctx }) => copilotLoginFor(ctx).begin(input.instanceId),
  copilotLoginStatus: async ({ input, ctx }) => copilotLoginFor(ctx).state(input.instanceId),
  cancelCopilotLogin: async ({ input, ctx }) => {
    copilotLoginFor(ctx).cancel(input.instanceId)
    return { cancelled: true }
  },
  signOutCopilot: async ({ input, ctx }) => {
    await copilotLoginFor(ctx).signOut(input.instanceId)
    accountRuntime(ctx)?.usageCache?.invalidate()
    return { signedOut: true }
  },
  catalog: async ({ input, ctx }) => {
    await refreshRoutes(ctx)
    const llm = ctx.get('llm')
    if (llm === undefined) return { instanceId: input.instanceId, models: [] }
    let warning: string | undefined
    try {
      await accountRuntime(ctx)?.refreshModelCatalog?.(input.instanceId)
    } catch {
      warning = 'Live catalog refresh failed; showing the last-known model list.'
    }
    const models = await llm.listModels(input.instanceId)
    const resolved = await Promise.all(
      models.map(async model => {
        const info = await llm.resolveModelInfo(input.instanceId, model.id)
        return {
          id: model.id,
          name: baseModelName(input.instanceId, model.name),
          efforts: (info.reasoning?.efforts ?? []).map(effort => ({
            id: effort.id,
            name: effort.name,
          })),
          defaultEffort: info.reasoning?.defaultEffort ?? null,
        }
      }),
    )
    const catalog = { instanceId: input.instanceId, models: resolved }
    if (warning === undefined) return catalog
    return { ...catalog, warning }
  },
  nativeProviders: async ({ ctx }) => readNativeProviders(ctx),
  setNativeProviderEnabled: async ({ input, ctx }) => setNativeProviderEnabled(ctx, input),
  usage: async ({ ctx }) => accountRuntime(ctx)?.usageCache?.get() ?? readAccountsUsage(ctx),
  refreshUsage: async ({ ctx }) => accountRuntime(ctx)?.usageCache?.refresh() ?? readAccountsUsage(ctx),
  history: async ({ input, ctx }) => ({
    instanceId: input.instanceId,
    points: [...(await createUsageHistoryService(ctx).read(input.instanceId, Date.now() - input.days * 24 * 60 * 60_000, input.bucketMinutes))],
  }),
  historySettings: async ({ ctx }) => createUsageHistoryService(ctx).readSettings(),
  saveHistorySettings: async ({ input, ctx }) => createUsageHistoryService(ctx).saveSettings(input),
  collectUsage: async ({ ctx }) => ({ recorded: (await accountRuntime(ctx)?.scheduler?.collectNow()) ?? 0 }),
  pricingStatus: async ({ ctx }) => pricingFor(ctx).status(),
  refreshPricing: async ({ ctx }) => pricingFor(ctx).refresh(),
  quoteRoutes: async ({ input, ctx }) => {
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
  },
  quotaContinuations: async ({ ctx }) => quotaContinuationServiceFor(ctx).list(),
  quotaRecoveryModelCatalog: async ({ ctx }) => {
    const controller = ctx.get('sessionController')
    if (controller === undefined) throw new Error('Session model selection is unavailable.')
    return quotaRecoveryCatalogForClient(await controller.modelCatalog())
  },
  resumeQuotaContinuation: async ({ input, ctx }) => {
    return quotaContinuationServiceFor(ctx).resume(input.continuationId, selectionForContinuation(input.selection))
  },
  setQuotaContinuationAutoRetry: async ({ input, ctx }) => quotaContinuationServiceFor(ctx).setAutoRetry(input.continuationId, input.sessionId, input.enabled),
  snoozeQuotaContinuation: async ({ input, ctx }) => quotaContinuationServiceFor(ctx).snooze(input.continuationId, input.duration),
})

/** Provider reads are independent; bound them so a profile with 64 accounts is not a 64-request burst. */
const ACCOUNT_USAGE_READ_CONCURRENCY = 4

const readQuotaResetAt = async (ctx: Context, accountId: string): Promise<number | null> => {
  const file = await accountsFile(ctx)
  const account = file.accounts.find(profile => profile.instanceId === accountId)
  if (account === undefined) return null
  return knownQuotaResetAt(await readAccountUsage({ account, shadowRoot: file.shadowRoot, resolveCredential: resolveKeyFromContext(ctx) }), Date.now())
}

/**
 * Live quota for every account, read with each account's own credential.
 *
 * One sweep covers the whole panel: the Client renders it as cards and refreshes
 * on an interval, so a provider that is slow or down costs its own card rather
 * than the panel.
 */
const readAccountsUsage = async (ctx: Context): Promise<AccountsUsage> => {
  // Read the observed file so a Codex account uses the same shadow home the
  // panel already shows, not a re-derived guess.
  const file = await accountsFile(ctx)
  const resolveCredential = resolveKeyFromContext(ctx)
  const cards = await mapRolling({
    items: file.accounts,
    concurrency: ACCOUNT_USAGE_READ_CONCURRENCY,
    map: async account => ({
      instanceId: account.instanceId,
      displayName: account.displayName,
      kind: account.kind,
      enabled: account.enabled,
      usage: await readAccountUsage({ account, shadowRoot: file.shadowRoot, resolveCredential }),
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
  static readonly accountsFile = accountsFile
  static readonly readAccountsUsage = readAccountsUsage
  static readonly readQuotaResetAt = readQuotaResetAt
}
