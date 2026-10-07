import type { Context } from '@deepseek-ai/cordis'
import { accountRuntime } from './account-runtime.js'
import { configFromAccountsFile } from './account-config.js'
import { aiAccountsApi, baseModelName, type AccountProfile, type AccountsFile, type AccountsUsage, type UsageCard } from './api.js'
import { buildAccountsFile, readAccountFile, readAccountIdentity, removeAccount, setDistribution, upsertAccount } from './account-store.js'
import { readCodexUsage, readOpenCodeUsage } from './usage.js'
import { readUsageHistory, readUsageHistorySettings, saveUsageHistorySettings } from './usage-recorder.js'
import { readKeyFromEnv } from './credentials.js'
import { resolveCodexHomeLayout } from './codex-home.js'
import { knownQuotaResetAt } from './quota-reset.js'

/**
 * The one read operation. Profiles come from the accounts file, joined with the
 * pool's live health and each home's observed login, so the page and the agent's
 * `ai_accounts` tool can never describe different state.
 */
export const accountsFile = async (ctx: Context): Promise<AccountsFile> =>
  buildAccountsFile(await readAccountFile(), accountRuntime(ctx)?.accounts?.pool.describe() ?? [])

export const accountsSnapshot = accountsFile

const quotaContinuationServiceFor = (ctx: Context) => {
  const service = accountRuntime(ctx)?.quotaContinuations
  if (service === undefined) throw new Error('Quota recovery service is unavailable')
  return service
}

export const accountsHostApi = aiAccountsApi.host({
  read: async ({ ctx }) => {
    // A changed file means changed routes, so rebuild before answering.
    await refreshRoutes(ctx)
    return accountsFile(ctx)
  },
  save: async ({ input, ctx }) => {
    await upsertAccount(input.draft)
    await refreshRoutes(ctx)
    return accountsFile(ctx)
  },
  remove: async ({ input, ctx }) => {
    await removeAccount(input.instanceId)
    await refreshRoutes(ctx)
    return accountsFile(ctx)
  },
  setDistribution: async ({ input, ctx }) => {
    await setDistribution(input.distribution)
    await refreshRoutes(ctx)
    return accountsFile(ctx)
  },
  identity: async ({ input }) => readAccountIdentity(input.instanceId),
  catalog: async ({ input, ctx }) => {
    const llm = ctx.get('llm')
    if (llm === undefined) return { instanceId: input.instanceId, models: [] }
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
    return { instanceId: input.instanceId, models: resolved }
  },
  usage: async ({ ctx }) => readAccountsUsage(ctx),
  history: async ({ input, ctx }) => ({
    instanceId: input.instanceId,
    points: [...(await readUsageHistory(ctx, input.instanceId, Date.now() - input.days * 24 * 60 * 60_000))],
  }),
  historySettings: async ({ ctx }) => readUsageHistorySettings(ctx),
  saveHistorySettings: async ({ input, ctx }) => saveUsageHistorySettings(ctx, input),
  overlaySettings: async ({ ctx }) => (await readUsageHistorySettings(ctx)).overlays,
  saveOverlaySettings: async ({ input, ctx }) => {
    const meta = await readUsageHistorySettings(ctx)
    const next = await saveUsageHistorySettings(ctx, { overlays: { ...meta.overlays, ...input.patch } })
    return next.overlays
  },
  collectUsage: async ({ ctx }) => ({ recorded: (await accountRuntime(ctx)?.scheduler?.collectNow()) ?? 0 }),
  quotaContinuations: async ({ ctx }) => quotaContinuationServiceFor(ctx).list(),
  resumeQuotaContinuation: async ({ input, ctx }) => quotaContinuationServiceFor(ctx).resume(input.continuationId),
  snoozeQuotaContinuation: async ({ input, ctx }) => quotaContinuationServiceFor(ctx).snooze(input.continuationId, input.duration),
})

/**
 * One account's live quota.
 *
 * A keyed provider reports against its own key, and Codex against the login in
 * its own home. A provider with no reachable quota endpoint is reported as
 * unsupported rather than failing the sweep.
 */
const readAccountUsage = async (account: AccountProfile): Promise<UsageCard> => {
  if (account.kind === 'codex') {
    return readCodexUsage(
      resolveCodexHomeLayout({
        homePath: account.homePath,
        shadowHomePath: account.shadowHomePath,
      }).effectiveHomePath,
    )
  }
  if (account.kind === 'commandcode') return unsupported()
  return readOpenCodeUsage(readKeyFromEnv(account.apiKeyEnv))
}

export const readQuotaResetAt = async (ctx: Context, accountId: string): Promise<number | null> => {
  const account = (await accountsFile(ctx)).accounts.find(profile => profile.instanceId === accountId)
  if (account === undefined) return null
  return knownQuotaResetAt(await readAccountUsage(account), Date.now())
}

const unsupported = (): UsageCard => ({
  status: 'unsupported',
  message: null,
  identity: null,
  plan: null,
  windows: [],
  bankedResets: 0,
  bankedResetExpiries: [],
})

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
  const cards = await Promise.all(
    file.accounts.map(async account => ({
      instanceId: account.instanceId,
      usage: await readAccountUsage(account),
    })),
  )
  return { readAt: Date.now(), cards }
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
