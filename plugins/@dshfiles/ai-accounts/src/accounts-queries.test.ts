import { QueryClient, QueryObserver, type QueryKey } from '@dshfiles/plugin-ui/query'
import { describe, expect, it } from 'vitest'
import { acceptAccountOrder, aiAccountsKeys, aiAccountsQueries } from './accounts-queries.js'
import type { AccountsFile, NativeProviders } from './api.js'
import { AccountDraftModel } from './account-draft.js'

/** What an older Host actually sends: JSON that the current schema types do not describe. */
const overTheWire = (value: unknown) => JSON.parse(JSON.stringify(value))

const usageCard = { status: 'ok', message: null, identity: null, plan: null, windows: [], bankedResets: 0, bankedResetExpiries: [] }

const nextPollAfterFetch = (client: QueryClient, options: { readonly queryKey: QueryKey; readonly refetchInterval?: unknown }): unknown => {
  const query = client.getQueryCache().find({ queryKey: options.queryKey })
  if (query === undefined || typeof options.refetchInterval !== 'function') return options.refetchInterval
  return options.refetchInterval(query)
}

const nativeProviders = (provider: { readonly enabled: boolean; readonly running: boolean }, liveReload = true): NativeProviders => ({
  available: true,
  liveReload,
  reason: null,
  providers: [{ entryId: 'llm-deepseek', label: 'DeepSeek', routes: [], lockedReason: null, ...provider }],
})

const fileFor = (ids: string[]): AccountsFile => ({
  distribution: 'priority',
  cooldownMs: 0,
  shadowRoot: '',
  accounts: ids.map(instanceId => ({
    ...AccountDraftModel.newAccountDraft({ kind: 'github-copilot', existing: [] }),
    instanceId,
    mode: 'direct',
    signedIn: false,
    identity: null,
    plan: null,
    state: 'unconfigured',
    loginHint: '',
    detail: null,
  })),
})

describe('ai-accounts queries', () => {
  it('updates page and usage subscribers together, cancels stale reads and reconciles a concurrent Host change', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const initial = fileFor(['a', 'b', 'c'])
    const committed = fileFor(['b', 'a', 'c'])
    const concurrent = fileFor(['c', 'b', 'a'])
    let read = async () => initial
    const options = aiAccountsQueries.file({ read: () => read() })
    await client.fetchQuery(options)
    const page: string[][] = []
    const usage: string[][] = []
    const pageObserver = new QueryObserver(client, { ...options, staleTime: Infinity })
    const usageObserver = new QueryObserver(client, { ...options, staleTime: Infinity })
    const stopPage = pageObserver.subscribe(state => page.push(state.data?.accounts.map(account => account.instanceId) ?? []))
    const stopUsage = usageObserver.subscribe(state => usage.push(state.data?.accounts.map(account => account.instanceId) ?? []))
    let resolveStale: ((file: AccountsFile) => void) | undefined
    read = () =>
      new Promise(resolve => {
        resolveStale = resolve
      })
    const obsolete = client.fetchQuery(options).catch(() => undefined)
    read = async () => concurrent
    await acceptAccountOrder(client, committed)
    resolveStale?.(initial)
    await obsolete
    expect(page).toContainEqual(['b', 'a', 'c'])
    expect(usage).toContainEqual(['b', 'a', 'c'])
    expect(page.at(-1)).toEqual(['c', 'b', 'a'])
    expect(usage.at(-1)).toEqual(['c', 'b', 'a'])
    expect(client.getQueryData<AccountsFile>(aiAccountsKeys.file)?.accounts.map(account => account.instanceId)).toEqual(['c', 'b', 'a'])
    stopPage()
    stopUsage()
    client.clear()
  })

  it('reads usage from an older Host by filling the labels it does not send', async () => {
    const options = aiAccountsQueries.usage(
      { usage: async () => overTheWire({ readAt: 1, hostName: 'mac', cards: [{ instanceId: 'work', kind: 'codex', enabled: true, usage: usageCard }] }) },
      60_000,
    )
    const usage = await new QueryClient().fetchQuery(options)
    expect(usage?.cards[0]?.displayName).toBe('work')
  })

  it('reports an unreadable usage answer as null rather than failing the surface', async () => {
    const usage = await new QueryClient().fetchQuery(aiAccountsQueries.usage({ usage: async () => overTheWire({ cards: 'nope' }) }, 60_000))
    expect(usage).toBeNull()
  })

  it('keeps the last good quota of each account through a failed or unreadable poll', async () => {
    const goodCard = { ...usageCard, windows: [{ label: 'Weekly limit', percentRemaining: 40, resetsAt: 9 }] }
    const answers = [
      {
        readAt: 1,
        hostName: 'mac',
        cards: [
          { instanceId: 'work', kind: 'codex', enabled: true, usage: goodCard },
          { instanceId: 'home', kind: 'claude', enabled: true, usage: goodCard },
        ],
      },
      {
        readAt: 2,
        hostName: 'mac',
        cards: [
          { instanceId: 'work', kind: 'codex', enabled: true, usage: { ...usageCard, status: 'error', message: 'Codex returned 502 for usage.' } },
          { instanceId: 'home', kind: 'claude', enabled: true, usage: { ...usageCard, status: 'unauthenticated' } },
        ],
      },
      { cards: 'nope' },
    ]
    const client = new QueryClient()
    const options = aiAccountsQueries.usage({ usage: async () => overTheWire(answers.shift()) }, 60_000)
    await client.fetchQuery(options)

    const afterFailure = await client.fetchQuery(options)
    expect(afterFailure?.cards.map(card => [card.instanceId, card.usage.status, card.usage.windows.length])).toEqual([
      ['work', 'ok', 1],
      ['home', 'unauthenticated', 0],
    ])

    const afterUnreadable = await client.fetchQuery(options)
    expect(afterUnreadable?.readAt).toBe(2)
  })

  it('falls back to the cached usage read when the Host has no refreshUsage', async () => {
    const usage = await aiAccountsQueries.readFreshUsage({
      refreshUsage: async () => {
        throw new Error('unknown method')
      },
      usage: async () => overTheWire({ readAt: 2, hostName: 'mac', cards: [] }),
    })
    expect(usage?.readAt).toBe(2)
  })

  it('forwards the query signal so an abandoned read is cancelled at the Host', async () => {
    const signals: (AbortSignal | undefined)[] = []
    await new QueryClient().fetchQuery(
      aiAccountsQueries.catalog(
        {
          catalog: async (input, callOptions) => {
            signals.push(callOptions?.signal)
            return { instanceId: input.instanceId, models: [] }
          },
        },
        'work',
      ),
    )
    expect(signals[0]).toBeInstanceOf(AbortSignal)
  })

  it('keeps the history page drawing when the Host has no history settings', async () => {
    const settings = await new QueryClient().fetchQuery(
      aiAccountsQueries.historySettings({
        historySettings: async () => {
          throw new Error('unknown method')
        },
      }),
    )
    expect(settings).toBeNull()
  })

  it('polls a signed-out account until its login appears', async () => {
    const client = new QueryClient()
    const signedOut = aiAccountsQueries.signInIdentity({ identity: async () => ({ instanceId: 'work', email: null, plan: null, signedIn: false }) }, 'work')
    await client.fetchQuery(signedOut)
    expect(nextPollAfterFetch(client, signedOut)).toBe(2_500)

    const signedIn = aiAccountsQueries.signInIdentity({ identity: async () => ({ instanceId: 'work', email: 'a@b.c', plan: null, signedIn: true }) }, 'work')
    await client.fetchQuery({ ...signedIn, staleTime: 0 })
    expect(nextPollAfterFetch(client, signedIn)).toBe(false)
  })

  it('rereads native providers only while a live reload is still landing', async () => {
    const pending = new QueryClient()
    const pendingOptions = aiAccountsQueries.nativeProviders({ nativeProviders: async () => nativeProviders({ enabled: true, running: false }) })
    await pending.fetchQuery(pendingOptions)
    expect(nextPollAfterFetch(pending, pendingOptions)).toBe(3_500)

    const restartOnly = new QueryClient()
    const restartOptions = aiAccountsQueries.nativeProviders({ nativeProviders: async () => nativeProviders({ enabled: true, running: false }, false) })
    await restartOnly.fetchQuery(restartOptions)
    expect(nextPollAfterFetch(restartOnly, restartOptions)).toBe(false)

    const settled = new QueryClient()
    const settledOptions = aiAccountsQueries.nativeProviders({ nativeProviders: async () => nativeProviders({ enabled: true, running: true }) })
    await settled.fetchQuery(settledOptions)
    expect(nextPollAfterFetch(settled, settledOptions)).toBe(false)
  })
})
