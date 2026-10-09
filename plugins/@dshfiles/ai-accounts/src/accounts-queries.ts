import type { ApiClient, ApiContract } from '@dshfiles/dshx/api'
import { queryOptions } from '@dshfiles/plugin-ui/query'
import { z } from 'zod'
import { accountKindSchema, aiAccountsApi, usageCardSchema, type AccountsUsage, type NativeProviders } from './api.js'

type AccountsClient = typeof aiAccountsApi extends ApiContract<infer Methods> ? ApiClient<Methods> : never

const SIGN_IN_POLL_MS = 2_500
/** A live reload lands a couple of seconds after the profile patch is written. */
const LIVE_RELOAD_POLL_MS = 3_500

export const aiAccountsKeys = {
  file: ['ai-accounts', 'file'] as const,
  usage: ['ai-accounts', 'usage'] as const,
  catalog: (instanceId: string) => ['ai-accounts', 'catalog', instanceId] as const,
  history: ['ai-accounts', 'history'] as const,
  historyRange: (instanceId: string, days: number) => ['ai-accounts', 'history', instanceId, days] as const,
  historySettings: ['ai-accounts', 'history-settings'] as const,
  identity: (instanceId: string) => ['ai-accounts', 'identity', instanceId] as const,
  quotaContinuations: ['ai-accounts', 'quota-continuations'] as const,
  nativeProviders: ['ai-accounts', 'native-providers'] as const,
}

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

const hasPendingLiveReload = (state: NativeProviders | undefined): boolean =>
  state?.liveReload === true && state.providers.some(provider => provider.enabled !== provider.running && provider.lockedReason === null)

export const aiAccountsQueries = {
  file: (accounts: Pick<AccountsClient, 'read'>) =>
    queryOptions({ queryKey: aiAccountsKeys.file, queryFn: ({ signal }) => accounts.read(undefined, { signal }) }),

  /** `null` when the Host answered with a shape this Client cannot read. */
  usage: (accounts: Pick<AccountsClient, 'usage'>, refetchInterval: number) =>
    queryOptions({
      queryKey: aiAccountsKeys.usage,
      queryFn: async ({ signal }) => normalizeUsage(await accounts.usage(undefined, { signal })),
      refetchInterval,
    }),

  /** Bypasses the Host's shared sweep cache; an older Host without `refreshUsage` falls back to the cached read. */
  readFreshUsage: async (accounts: Pick<AccountsClient, 'usage' | 'refreshUsage'>): Promise<AccountsUsage | null> =>
    normalizeUsage(await accounts.refreshUsage().catch(() => accounts.usage())),

  catalog: (accounts: Pick<AccountsClient, 'catalog'>, instanceId: string) =>
    queryOptions({ queryKey: aiAccountsKeys.catalog(instanceId), queryFn: ({ signal }) => accounts.catalog({ instanceId }, { signal }) }),

  /** Stored history grows on the Host's schedule, so it is reread with the live quota. */
  history: (accounts: Pick<AccountsClient, 'history'>, input: { readonly instanceId: string; readonly days: number; readonly refetchInterval: number }) =>
    queryOptions({
      queryKey: aiAccountsKeys.historyRange(input.instanceId, input.days),
      queryFn: ({ signal }) => accounts.history({ instanceId: input.instanceId, days: input.days }, { signal }),
      refetchInterval: input.refetchInterval,
    }),

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

  /** A Host older than this Client lacks the method; it fails once and the list explains a restart. */
  nativeProviders: (accounts: Pick<AccountsClient, 'nativeProviders'>) =>
    queryOptions({
      queryKey: aiAccountsKeys.nativeProviders,
      queryFn: ({ signal }) => accounts.nativeProviders(undefined, { signal }),
      refetchInterval: query => (hasPendingLiveReload(query.state.data) ? LIVE_RELOAD_POLL_MS : false),
      retry: false,
    }),
}
