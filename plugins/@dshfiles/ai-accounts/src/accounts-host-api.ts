import type { Context } from '@deepseek-ai/cordis'
import type { SecretCatalogCredentialBridge } from '@dshfiles/secret-catalog/credential-bridge-contract'
import { accountRuntime } from './account-runtime.js'
import { configFromAccountsFile } from './account-config.js'
import { hostname } from 'node:os'
import { aiAccountsApi, baseModelName, isKeyEnvName, type AccountsFile, type AccountsUsage } from './api.js'
import { accountFilePath, buildAccountsFile, readAccountFile, readAccountIdentity, removeAccount, setDistribution, upsertAccount } from './account-store.js'
import { readAccountUsage } from './account-usage.js'
import { resolveKeyFromContext } from './credentials.js'
import { readUsageHistory, readUsageHistorySettings, saveUsageHistorySettings } from './usage-recorder.js'
import { knownQuotaResetAt } from './quota-reset.js'
import { readNativeProviders, setNativeProviderEnabled } from './native-providers.js'
import { resolveRouteQuote } from './pricing-catalog.js'
import { readPricingSettings } from './settings.js'
import { readCopilotCredential } from './copilot-credentials.js'

/**
 * The one read operation. Profiles come from the accounts file, joined with the
 * pool's live health and each home's observed login, so the page and the agent's
 * `ai_accounts` tool can never describe different state.
 */
export const accountsFile = async (ctx: Context): Promise<AccountsFile> =>
  buildAccountsFile(
    await readAccountFile(),
    accountRuntime(ctx)?.accounts?.pool.describe() ?? [],
    resolveKeyFromContext(ctx),
    async instanceId => (await readCopilotCredential(ctx.get('credentials'), instanceId)) !== undefined,
  )

export const accountsSnapshot = accountsFile

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
  filePath: () => accountFilePath(),
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
    const account = (await readAccountFile()).accounts.find(candidate => candidate.instanceId === input.instanceId)
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
    await upsertAccount(input.draft, input.previousInstanceId)
    accountRuntime(ctx)?.usageCache?.invalidate()
    await refreshRoutes(ctx)
    return accountsFile(ctx)
  },
  remove: async ({ input, ctx }) => {
    await removeAccount(input.instanceId)
    accountRuntime(ctx)?.usageCache?.invalidate()
    await refreshRoutes(ctx)
    return accountsFile(ctx)
  },
  setDistribution: async ({ input, ctx }) => {
    await setDistribution(input.distribution)
    await refreshRoutes(ctx)
    return accountsFile(ctx)
  },
  identity: async ({ input }) => readAccountIdentity(input.instanceId),
  beginCopilotLogin: async ({ input, ctx }) => copilotLoginFor(ctx).begin(input.instanceId),
  copilotLoginStatus: async ({ input, ctx }) => copilotLoginFor(ctx).state(input.instanceId),
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
    points: [...(await readUsageHistory(ctx, input.instanceId, Date.now() - input.days * 24 * 60 * 60_000))],
  }),
  historySettings: async ({ ctx }) => readUsageHistorySettings(ctx),
  saveHistorySettings: async ({ input, ctx }) => saveUsageHistorySettings(ctx, input),
  collectUsage: async ({ ctx }) => ({ recorded: (await accountRuntime(ctx)?.scheduler?.collectNow()) ?? 0 }),
  pricingStatus: async ({ ctx }) => pricingFor(ctx).status(),
  refreshPricing: async ({ ctx }) => pricingFor(ctx).refresh(),
  quoteRoutes: async ({ input, ctx }) => {
    const pricing = pricingFor(ctx)
    const settings = readPricingSettings()
    if (pricing.current() === null && settings.costEstimates) void pricing.ensureFresh(0)
    const file = await readAccountFile()
    const kinds = new Map(file.accounts.map(account => [account.instanceId.trim() || account.kind, account.kind]))
    const cache = pricing.current()
    return {
      fetchedAt: cache?.fetchedAt ?? null,
      quotes: input.routes.map(route => resolveRouteQuote({ route, cache, accountKind: kinds.get(route.provider), overrides: settings.pricingOverrides })),
    }
  },
  quotaContinuations: async ({ ctx }) => quotaContinuationServiceFor(ctx).list(),
  resumeQuotaContinuation: async ({ input, ctx }) => quotaContinuationServiceFor(ctx).resume(input.continuationId),
  snoozeQuotaContinuation: async ({ input, ctx }) => quotaContinuationServiceFor(ctx).snooze(input.continuationId, input.duration),
})

export const readQuotaResetAt = async (ctx: Context, accountId: string): Promise<number | null> => {
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
export const readAccountsUsage = async (ctx: Context): Promise<AccountsUsage> => {
  // Read the observed file so a Codex account uses the same shadow home the
  // panel already shows, not a re-derived guess.
  const file = await accountsFile(ctx)
  const resolveCredential = resolveKeyFromContext(ctx)
  const cards = await Promise.all(
    file.accounts.map(async account => ({
      instanceId: account.instanceId,
      displayName: account.displayName,
      kind: account.kind,
      enabled: account.enabled,
      usage: await readAccountUsage({ account, shadowRoot: file.shadowRoot, resolveCredential }),
    })),
  )
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
  const file = await readAccountFile()
  const config = configFromAccountsFile(file)
  activeAccounts.config = config
  activeAccounts.pool.setDistribution(file.distribution)
}
