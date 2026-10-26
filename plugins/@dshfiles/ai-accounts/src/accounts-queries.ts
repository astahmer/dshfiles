import { isApiError, isApiOwnerMissing, type ApiClient, type ApiContract } from '@dshfiles/dshx/api'
import { queryOptions } from '@dshfiles/plugin-ui/query'
import { z } from 'zod'
import {
  accountKindSchema,
  aiAccountsApi,
  FORECAST_HISTORY_BUCKET_MINUTES,
  FORECAST_HISTORY_DAYS,
  MAX_FORECAST_HISTORY_BATCH_SIZE,
  usageCardSchema,
  type AccountsCatalog,
  type AccountsUsage,
  type NativeProviders,
  type SecretCatalogKeys,
} from './api.js'

type AccountsClient = typeof aiAccountsApi extends ApiContract<infer Methods> ? ApiClient<Methods> : never

const SIGN_IN_POLL_MS = 2_500
/** A live reload lands a couple of seconds after the profile patch is written. */
const LIVE_RELOAD_POLL_MS = 3_500
const unsupportedForecastHistoryClients = new WeakSet<object>()

const isForecastHistoryBatchUnavailable = (error: unknown): boolean =>
  isApiError(error) && error.apiId === aiAccountsApi.id && error.method === 'forecastHistoryBatch' && (isApiOwnerMissing(error) || error.kind === 'contract')

const readLegacyForecastHistories = async (accounts: Pick<AccountsClient, 'history'>, instanceIds: readonly string[], signal: AbortSignal) => ({
  histories: await Promise.all(
    instanceIds.map(async instanceId => {
      try {
        return await accounts.history({ instanceId, days: FORECAST_HISTORY_DAYS, bucketMinutes: FORECAST_HISTORY_BUCKET_MINUTES }, { signal })
      } catch (error) {
        if (signal.aborted) throw error
        return { instanceId, points: [] }
      }
    }),
  ),
})

const readForecastHistoryBatch = async (accounts: Pick<AccountsClient, 'forecastHistoryBatch' | 'history'>, instanceIds: string[], signal: AbortSignal) => {
  if (unsupportedForecastHistoryClients.has(accounts)) return readLegacyForecastHistories(accounts, instanceIds, signal)
  try {
    return await accounts.forecastHistoryBatch({ instanceIds }, { signal })
  } catch (error) {
    if (!isForecastHistoryBatchUnavailable(error)) throw error
    unsupportedForecastHistoryClients.add(accounts)
    return readLegacyForecastHistories(accounts, instanceIds, signal)
  }
}

const readForecastHistories = async (
  accounts: Pick<AccountsClient, 'forecastHistoryBatch' | 'history'>,
  instanceIds: readonly string[],
  signal: AbortSignal,
) => {
  const batches: string[][] = []
  for (let offset = 0; offset < instanceIds.length; offset += MAX_FORECAST_HISTORY_BATCH_SIZE)
    batches.push(instanceIds.slice(offset, offset + MAX_FORECAST_HISTORY_BATCH_SIZE))
  const responses = await Promise.all(batches.map(batch => readForecastHistoryBatch(accounts, batch, signal)))
  return { histories: responses.flatMap(response => response.histories) }
}

const AI_ACCOUNTS_HISTORY_KEY = ['ai-accounts', 'history'] as const

export const aiAccountsKeys = {
  file: ['ai-accounts', 'file'] as const,
  usage: ['ai-accounts', 'usage'] as const,
  secretCatalogKeys: (cwd: string | null) => ['ai-accounts', 'secret-catalog-keys', cwd] as const,
  credential: (ref: string) => ['ai-accounts', 'credential', ref] as const,
  catalog: (instanceId: string) => ['ai-accounts', 'catalog', instanceId] as const,
  history: AI_ACCOUNTS_HISTORY_KEY,
  historyRange: (instanceId: string, days: number) => ['ai-accounts', 'history', instanceId, days] as const,
  forecastHistories: (instanceIds: readonly string[]) => [...AI_ACCOUNTS_HISTORY_KEY, 'forecast-batch', [...instanceIds]] as const,
  historySettings: ['ai-accounts', 'history-settings'] as const,
  identity: (instanceId: string) => ['ai-accounts', 'identity', instanceId] as const,
  quotaContinuations: ['ai-accounts', 'quota-continuations'] as const,
  nativeProviders: ['ai-accounts', 'native-providers'] as const,
  pricing: ['ai-accounts', 'pricing'] as const,
  pricingStatus: ['ai-accounts', 'pricing', 'status'] as const,
  routeQuotes: (routeKeys: string, overrides: string) => ['ai-accounts', 'pricing', 'quotes', routeKeys, overrides] as const,
}

/** Quotes change only when the catalog refreshes or an override is edited, both of which invalidate them. */
const QUOTE_STALE_MS = 15 * 60_000

/**
 * A Host older than this Client answers without the card labels or the
 * `refreshUsage` method; read what is there and fill the rest, so a surface
 * degrades to plainer cards instead of failing until DSH restarts.
 */
const tolerantUsageSchema = z.object({
  readAt: z.number().catch(() => Date.now()),
  hostName: z.string().catch(''),
  cards: z.array(
    z.object({
      instanceId: z.string(),
      displayName: z.string().optional().catch(undefined),
      kind: accountKindSchema.catch('codex'),
      enabled: z.boolean().catch(true),
      usage: usageCardSchema,
    }),
  ),
})

const normalizeUsage = (raw: unknown): AccountsUsage | null => {
  const parsed = tolerantUsageSchema.safeParse(raw)
  if (!parsed.success) return null
  return { ...parsed.data, cards: parsed.data.cards.map(card => ({ ...card, displayName: card.displayName ?? card.instanceId })) }
}

/** A provider read that failed or was throttled says nothing new about the quota; the last good windows still stand. */
const TRANSIENT_USAGE_STATUS = new Set<AccountsUsage['cards'][number]['usage']['status']>(['error', 'rate-limited'])

/**
 * Keeps each account's last good quota through a failed read, so a meter does
 * not vanish between polls: an unreadable answer keeps the whole snapshot, and
 * a card whose provider read failed keeps its previous windows. Removed
 * accounts and real state changes (signed out, unsupported) still apply.
 */
const keepLastGoodUsage = (previous: AccountsUsage | null | undefined, next: AccountsUsage | null): AccountsUsage | null => {
  if (next === null) return previous ?? null
  if (previous === null || previous === undefined) return next
  const previousById = new Map(previous.cards.map(card => [card.instanceId, card]))
  return {
    ...next,
    cards: next.cards.map(card => {
      const last = previousById.get(card.instanceId)
      if (!TRANSIENT_USAGE_STATUS.has(card.usage.status) || last?.usage.status !== 'ok') return card
      return { ...card, usage: last.usage }
    }),
  }
}

const hasPendingLiveReload = (state: NativeProviders | undefined): boolean =>
  state?.liveReload === true && state.providers.some(provider => provider.enabled !== provider.running && provider.lockedReason === null)

export const aiAccountsQueries = {
  secretCatalogKeys: (accounts: Pick<AccountsClient, 'secretCatalogKeys'>, cwd: string | null) =>
    queryOptions<SecretCatalogKeys>({
      queryKey: aiAccountsKeys.secretCatalogKeys(cwd),
      queryFn: ({ signal }) => accounts.secretCatalogKeys({ cwd }, { signal }).catch(() => ({ available: false, items: [] })),
      retry: false,
    }),

  file: (accounts: Pick<AccountsClient, 'read'>) =>
    queryOptions({ queryKey: aiAccountsKeys.file, queryFn: ({ signal }) => accounts.read(undefined, { signal }) }),

  /** `null` when the Host answered with a shape this Client cannot read. */
  usage: (accounts: Pick<AccountsClient, 'usage'>, refetchInterval: number) =>
    queryOptions({
      queryKey: aiAccountsKeys.usage,
      queryFn: async ({ signal, client }) =>
        keepLastGoodUsage(client.getQueryData<AccountsUsage | null>(aiAccountsKeys.usage), normalizeUsage(await accounts.usage(undefined, { signal }))),
      refetchInterval,
      refetchIntervalInBackground: true,
      refetchOnWindowFocus: 'always',
    }),

  /** Bypasses the Host's shared sweep cache; an older Host without `refreshUsage` falls back to the cached read. */
  readFreshUsage: async (accounts: Pick<AccountsClient, 'usage' | 'refreshUsage'>): Promise<AccountsUsage | null> =>
    normalizeUsage(await accounts.refreshUsage().catch(() => accounts.usage())),

  keepLastGoodUsage,

  catalog: (accounts: Pick<AccountsClient, 'catalog'>, instanceId: string) =>
    queryOptions({
      queryKey: aiAccountsKeys.catalog(instanceId),
      queryFn: ({ signal }): Promise<AccountsCatalog> => accounts.catalog({ instanceId }, { signal }),
    }),

  /** Stored history grows on the Host's schedule, so it is reread with the live quota. */
  history: (accounts: Pick<AccountsClient, 'history'>, input: { readonly instanceId: string; readonly days: number; readonly refetchInterval: number }) =>
    queryOptions({
      queryKey: aiAccountsKeys.historyRange(input.instanceId, input.days),
      queryFn: ({ signal }) => accounts.history({ instanceId: input.instanceId, days: input.days }, { signal }),
      refetchInterval: input.refetchInterval,
    }),

  forecastHistories: (
    accounts: Pick<AccountsClient, 'forecastHistoryBatch' | 'history'>,
    input: { readonly instanceIds: readonly string[]; readonly refetchInterval: number },
  ) => {
    const instanceIds = [...new Set(input.instanceIds)].sort()
    return queryOptions({
      queryKey: aiAccountsKeys.forecastHistories(instanceIds),
      queryFn: ({ signal }) => readForecastHistories(accounts, instanceIds, signal),
      enabled: instanceIds.length > 0,
      refetchInterval: input.refetchInterval,
    })
  },

  /** `null` from a Host without history settings, so the page still draws. */
  historySettings: (accounts: Pick<AccountsClient, 'historySettings'>) =>
    queryOptions({
      queryKey: aiAccountsKeys.historySettings,
      queryFn: ({ signal }) => accounts.historySettings(undefined, { signal }).catch(() => null),
    }),

  /** Polls a signed-out account until its login appears; failures wait for the next tick. */
  signInIdentity: (accounts: Pick<AccountsClient, 'identity'>, instanceId: string) =>
    queryOptions({
      queryKey: aiAccountsKeys.identity(instanceId),
      queryFn: ({ signal }) => accounts.identity({ instanceId }, { signal }),
      refetchInterval: query => (query.state.data?.signedIn === true ? false : SIGN_IN_POLL_MS),
      retry: false,
    }),

  quotaContinuations: (accounts: Pick<AccountsClient, 'quotaContinuations'>) =>
    queryOptions({ queryKey: aiAccountsKeys.quotaContinuations, queryFn: ({ signal }) => accounts.quotaContinuations(undefined, { signal }) }),

  /** `null` from a Host older than cost estimates, so surfaces hide instead of failing. */
  pricingStatus: (accounts: Pick<AccountsClient, 'pricingStatus'>) =>
    queryOptions({
      queryKey: aiAccountsKeys.pricingStatus,
      queryFn: ({ signal }) => accounts.pricingStatus(undefined, { signal }).catch(() => null),
    }),

  routeQuotes: (
    accounts: Pick<AccountsClient, 'quoteRoutes'>,
    input: { readonly routes: readonly { readonly provider: string; readonly model: string }[]; readonly overrides: Readonly<Record<string, string>> },
  ) =>
    queryOptions({
      queryKey: aiAccountsKeys.routeQuotes(input.routes.map(route => `${route.provider}/${route.model}`).join('|'), JSON.stringify(input.overrides)),
      queryFn: ({ signal }) => accounts.quoteRoutes({ routes: [...input.routes] }, { signal }).catch(() => null),
      staleTime: QUOTE_STALE_MS,
      retry: false,
    }),

  /** A Host older than this Client lacks the method; it fails once and the list explains a restart. */
  nativeProviders: (accounts: Pick<AccountsClient, 'nativeProviders'>) =>
    queryOptions({
      queryKey: aiAccountsKeys.nativeProviders,
      queryFn: ({ signal }) => accounts.nativeProviders(undefined, { signal }),
      refetchInterval: query => (hasPendingLiveReload(query.state.data) ? LIVE_RELOAD_POLL_MS : false),
      retry: false,
    }),
}
