// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient, ApiContract } from '@dshfiles/dshx/api'
import { focusManager, PluginQueryProvider, QueryClient } from '@dshfiles/plugin-ui/query'
import type { aiAccountsApi, AccountKind, AccountsUsage } from './api.js'
import { useAccountsUsage } from './use-accounts-usage.js'

// Only the typed Host boundary and the settings store are replaced; Query, its focus manager and the hook are real.
type AccountsClient = typeof aiAccountsApi extends ApiContract<infer Methods> ? ApiClient<Methods> : never
const host = vi.hoisted(() => ({ usage: vi.fn<AccountsClient['usage']>(), refreshUsage: vi.fn<AccountsClient['refreshUsage']>() }))
const USAGE_REFRESH_MS = 60_000
const settings = vi.hoisted(() => ({ value: { usageRefreshSeconds: 60 }, set: vi.fn(async () => true), unset: vi.fn(async () => true) }))
vi.mock('@dshfiles/dshx/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@dshfiles/dshx/client')>()),
  useApi: () => host,
  useSettings: () => settings,
}))

const KINDS: readonly AccountKind[] = ['codex', 'claude', 'opencode-go', 'commandcode', 'github-copilot', 'cursor', 'mistral']
type Card = AccountsUsage['cards'][number]
const card = (kind: AccountKind, percentRemaining: number, readAt: number): Card => ({
  instanceId: `${kind.replace('-', '_')}_work`,
  displayName: `${kind} work`,
  kind,
  enabled: true,
  usage: {
    status: 'ok',
    message: null,
    identity: null,
    plan: null,
    windows: [{ label: 'Weekly limit', percentRemaining, resetsAt: null }],
    bankedResets: 0,
    bankedResetExpiries: [],
    readAt,
  },
})
const sweep = (readAt: number, cards: readonly Card[]): AccountsUsage => ({ readAt, hostName: 'synthetic-host', cards })
const everyProvider = (percentRemaining: number, readAt: number): AccountsUsage =>
  sweep(
    readAt,
    KINDS.map(kind => card(kind, percentRemaining, readAt)),
  )
const percents = (usage: AccountsUsage | null): (number | undefined)[] => (usage?.cards ?? []).map(item => item.usage.windows[0]?.percentRemaining)

const deferred = <Value,>() => {
  let resolve: (value: Value) => void = () => undefined
  const promise = new Promise<Value>(settle => {
    resolve = settle
  })
  return { promise, resolve }
}

let latest: ReturnType<typeof useAccountsUsage>
const Probe = (props: { readonly report: (value: ReturnType<typeof useAccountsUsage>) => void; readonly ambient: boolean }): null => {
  const value = useAccountsUsage({ ambient: props.ambient })
  useEffect(() => props.report(value))
  return null
}
const flush = async (ms = 1): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

const mounted: { root: Root; client: QueryClient; container: HTMLElement }[] = []
const mount = async (options: { readonly ambient?: boolean; readonly client?: QueryClient } = {}): Promise<QueryClient> => {
  const client = options.client ?? new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const container = document.createElement('div')
  const root = createRoot(container)
  mounted.push({ root, client, container })
  await act(async () => {
    root.render(
      <PluginQueryProvider client={client}>
        <Probe
          ambient={options.ambient === true}
          report={value => {
            latest = value
          }}
        />
      </PluginQueryProvider>,
    )
  })
  await flush()
  return client
}

const setVisibility = async (state: 'hidden' | 'visible'): Promise<void> => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host.usage.mockReset()
  host.refreshUsage.mockReset()
})
afterEach(async () => {
  await setVisibility('visible')
  await act(async () => {
    for (const { root, client } of mounted.splice(0)) {
      root.unmount()
      client.clear()
    }
    await vi.advanceTimersByTimeAsync(1)
  })
  focusManager.setFocused(undefined)
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('manual usage refresh', () => {
  it('reads every provider through the refresh route and shows the new reading', async () => {
    host.usage.mockResolvedValue(everyProvider(40, 1_000))
    await mount()
    expect(percents(latest.usage)).toEqual(KINDS.map(() => 40))
    const held = deferred<AccountsUsage>()
    host.refreshUsage.mockReturnValue(held.promise)

    const refreshed = latest.refresh()
    await flush()
    expect(latest.refreshing).toBe(true)
    held.resolve(everyProvider(30, 2_000))
    await flush()
    await refreshed

    expect(host.refreshUsage).toHaveBeenCalledTimes(1)
    expect(host.usage).toHaveBeenCalledTimes(1)
    expect(latest.refreshing).toBe(false)
    expect(percents(latest.usage)).toEqual(KINDS.map(() => 30))
    expect(latest.usage?.cards.map(item => item.usage.readAt)).toEqual(KINDS.map(() => 2_000))
    expect(latest.failure).toBeNull()
  })

  it('keeps the last reading through a failed refresh, says why, and clears once a retry succeeds', async () => {
    host.usage.mockResolvedValue(everyProvider(40, 1_000))
    await mount()
    host.refreshUsage.mockRejectedValueOnce(new Error('Account usage read timed out after 30000 ms.'))

    await flush(1_000)
    await expect(latest.refresh()).resolves.toBeUndefined()
    await flush()
    expect(latest.failure).toBe('Account usage read timed out after 30000 ms.')
    expect(percents(latest.usage)).toEqual(KINDS.map(() => 40))

    host.refreshUsage.mockResolvedValueOnce(everyProvider(35, 3_000))
    await latest.refresh()
    await flush()
    expect(latest.failure).toBeNull()
    expect(percents(latest.usage)).toEqual(KINDS.map(() => 35))
  })

  it.each(KINDS)('keeps %s on its own older reading while the other providers move on', async failing => {
    host.usage.mockResolvedValue(everyProvider(40, 1_000))
    await mount()
    const next = everyProvider(30, 2_000)
    host.refreshUsage.mockResolvedValue({
      ...next,
      cards: next.cards.map(item =>
        item.kind === failing ? { ...item, usage: { ...item.usage, status: 'error', message: `${failing} returned 502.`, windows: [], readAt: 2_000 } } : item,
      ),
    })

    await latest.refresh()
    await flush()

    for (const item of latest.usage?.cards ?? []) {
      if (item.kind === failing) {
        expect(item.usage).toMatchObject({ status: 'ok', readAt: 1_000, readFailure: { status: 'error', message: `${failing} returned 502.` } })
        expect(item.usage.windows[0]?.percentRemaining).toBe(40)
      } else {
        expect(item.usage).toMatchObject({ status: 'ok', readAt: 2_000 })
        expect(item.usage.readFailure).toBeUndefined()
      }
    }
    expect(latest.failure).toBeNull()
  })

  it('does not let a poll already in flight put the older reading back', async () => {
    host.usage.mockResolvedValueOnce(everyProvider(40, 1_000))
    const client = await mount()
    const poll = deferred<AccountsUsage>()
    host.usage.mockReturnValueOnce(poll.promise)
    void client.refetchQueries({ queryKey: ['ai-accounts', 'usage'] })
    await flush()
    host.refreshUsage.mockResolvedValue(everyProvider(20, 3_000))

    await latest.refresh()
    poll.resolve(everyProvider(40, 1_000))
    await flush()

    expect(percents(latest.usage)).toEqual(KINDS.map(() => 20))
  })

  it('says what to do when the Host answers in a shape this page cannot read', async () => {
    const malformed = card('codex', Number.NaN, 1_000)
    host.usage.mockResolvedValue(sweep(1_000, [malformed]))
    await mount()
    expect(latest.usage).toBeNull()
    expect(latest.failure).toContain('Reload the page')
  })
})

describe('background to foreground', () => {
  it('keeps polling while hidden and reads again the moment the page returns', async () => {
    host.usage.mockResolvedValue(everyProvider(40, 1_000))
    await mount()
    await setVisibility('hidden')
    host.usage.mockResolvedValue(everyProvider(30, 2_000))
    await flush(USAGE_REFRESH_MS)
    expect(host.usage).toHaveBeenCalledTimes(2)
    expect(percents(latest.usage)).toEqual(KINDS.map(() => 30))

    host.usage.mockResolvedValue(everyProvider(20, 3_000))
    await flush(5_000)
    await setVisibility('visible')
    await flush()

    expect(host.usage).toHaveBeenCalledTimes(3)
    expect(percents(latest.usage)).toEqual(KINDS.map(() => 20))
  })

  it('shows a failed foreground read beside the last reading, and recovers on the next one', async () => {
    host.usage.mockResolvedValue(everyProvider(40, 1_000))
    await mount()
    await setVisibility('hidden')
    host.usage.mockRejectedValue(new Error('HTTP 503'))
    await setVisibility('visible')
    await flush()
    expect(latest.failure).toBe('HTTP 503')
    expect(percents(latest.usage)).toEqual(KINDS.map(() => 40))

    host.usage.mockResolvedValue(everyProvider(30, 2_000))
    await flush(USAGE_REFRESH_MS)
    expect(latest.failure).toBeNull()
    expect(percents(latest.usage)).toEqual(KINDS.map(() => 30))
  })
})

describe('ambient polling', () => {
  it('reads every five minutes while only an ambient surface is mounted, and on the configured interval once a view opens', async () => {
    host.usage.mockResolvedValue(everyProvider(40, 1_000))
    const client = await mount({ ambient: true })
    expect(host.usage).toHaveBeenCalledTimes(1)
    await flush(4 * USAGE_REFRESH_MS)
    expect(host.usage).toHaveBeenCalledTimes(1)
    await flush(USAGE_REFRESH_MS)
    expect(host.usage).toHaveBeenCalledTimes(2)

    await mount({ client })
    const afterViewOpened = host.usage.mock.calls.length
    await flush(USAGE_REFRESH_MS)
    expect(host.usage).toHaveBeenCalledTimes(afterViewOpened + 1)
  })

  it('stops ambient polling while the page is hidden', async () => {
    host.usage.mockResolvedValue(everyProvider(40, 1_000))
    await mount({ ambient: true })
    await setVisibility('hidden')
    await flush(10 * USAGE_REFRESH_MS)
    expect(host.usage).toHaveBeenCalledTimes(1)
  })
})
