// @vitest-environment jsdom
// @vitest-environment-options {"pretendToBeVisual":true}
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient, ApiContract } from '@dshfiles/dshx/api'
import { PluginQueryProvider, QueryClient } from '@dshfiles/plugin-ui/query'
import type { aiAccountsApi, AccountsUsage } from './api.js'
import { QuotaStatusLine } from './quota-status-line.js'

// Only the typed Host boundary is replaced; Query, the usage hooks, the arrangement and Radix stay real.
type AccountsClient = typeof aiAccountsApi extends ApiContract<infer Methods> ? ApiClient<Methods> : never
const host = vi.hoisted(() => ({
  read: vi.fn<AccountsClient['read']>(),
  usage: vi.fn<AccountsClient['usage']>(),
  refreshUsage: vi.fn<AccountsClient['refreshUsage']>(),
}))
const settings = vi.hoisted(() => ({
  value: { hiddenUsageAccounts: [], usageShortNameOverrides: {}, edgeWidget: false },
  set: vi.fn(async () => true),
  unset: vi.fn(async () => true),
}))
vi.mock('@dshfiles/dshx/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@dshfiles/dshx/client')>()),
  useApi: () => host,
  useSettings: () => settings,
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ relativeTime: vi.fn(() => ({ n: 1, unit: 'hours' })) }))

type Card = AccountsUsage['cards'][number]
const HOUR = 3_600_000
const card = (instanceId: string, displayName: string, percentRemaining: number, resetsIn: number | null = 45.5 * HOUR): Card => ({
  instanceId,
  displayName,
  kind: 'codex',
  enabled: true,
  usage: {
    status: 'ok',
    message: null,
    identity: 'synthetic@example.invalid',
    plan: null,
    windows: [{ label: 'Weekly limit', percentRemaining, resetsAt: resetsIn === null ? null : Date.now() + resetsIn }],
    bankedResets: 0,
    bankedResetExpiries: [],
  },
})
const roots: { root: Root; container: HTMLDivElement; client: QueryClient }[] = []
const flush = async (): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
}
const mount = async (input: {
  readonly cards: readonly Card[]
  readonly compact?: boolean
  readonly stripWidth?: number
  readonly activeAccountId?: string
}): Promise<HTMLElement> => {
  const usage: AccountsUsage = { readAt: Date.now(), hostName: 'synthetic-host', cards: [...input.cards] }
  host.usage.mockResolvedValue(usage)
  host.refreshUsage.mockResolvedValue(usage)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  const container = document.createElement('div')
  container.setAttribute('data-status-strip', 'full')
  container.getBoundingClientRect = () => ({ width: input.stripWidth ?? 1400 }) as DOMRect
  document.body.append(container)
  const root = createRoot(container)
  roots.push({ root, container, client })
  await act(async () => {
    root.render(
      <PluginQueryProvider client={client}>
        <QuotaStatusLine
          activeAccountId={input.activeAccountId ?? null}
          activeAccountRunning={false}
          compact={input.compact ?? false}
          onAddAccount={() => undefined}
          onOpenAccounts={() => undefined}
          onConnectAccount={() => undefined}
          onOpenUsageHistory={() => undefined}
        />
      </PluginQueryProvider>,
    )
  })
  await flush()
  await flush()
  return container
}
const accountText = (container: HTMLElement, id: string): string => container.querySelector(`[data-quota-account="${id}"]`)?.textContent ?? ''
const toneOf = (container: HTMLElement, id: string): string | null =>
  container.querySelector(`[data-quota-account="${id}"] [data-quota-tone]`)?.getAttribute('data-quota-tone') ?? null

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  )
  localStorage.clear()
  for (const mock of Object.values(host)) mock.mockReset()
})
afterEach(async () => {
  await act(async () => {
    for (const { root, container, client } of roots.splice(0)) {
      root.unmount()
      container.remove()
      client.clear()
    }
  })
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('quota status line', () => {
  it('shows one compact segment per account, in order, neutral while healthy (b:hbtt)', async () => {
    const container = await mount({ cards: [card('jarvis', 'Jarvis', 51), card('alfred', 'Alfred', 99)] })
    expect(accountText(container, 'jarvis')).toBe('J51%· 1d 21h')
    expect(accountText(container, 'alfred')).toBe('A99%· 1d 21h')
    expect(container.querySelector('[data-quota-overflow]')).toBeNull()
    expect(container.textContent).not.toContain('↻')
    expect(toneOf(container, 'jarvis')).toBe('ok')
    // Two segments, plus the invisible measuring row that holds them all.
    expect(container.querySelectorAll('[data-quota-segment] [data-quota-meter]')).toHaveLength(2)
    const button = container.querySelector('[data-quota-segment] button')
    expect(button?.className).not.toMatch(/ring-1|border/u)
    // Screen readers keep the usage strip's exact wording, window label included.
    expect(button?.getAttribute('aria-label')).toBe('Jarvis: Weekly limit: 51% left, resets in 1d 21h')
    expect(container.querySelector('[role="group"]')?.getAttribute('aria-label')).toMatch(/^AI accounts usage\. Jarvis: Weekly limit: 51% left/u)
  })

  it('turns amber at 15% left or less and red only once the limit is reached', async () => {
    const container = await mount({ cards: [card('near', 'Near', 12), card('spent', 'Spent', 0), card('fine', 'Fine', 70)] })
    expect(toneOf(container, 'near')).toBe('low')
    expect(accountText(container, 'near')).toBe('N12%· 1d 21h')
    expect(toneOf(container, 'spent')).toBe('critical')
    expect(accountText(container, 'spent')).toBe('Slimit· 1d 21h')
    expect(toneOf(container, 'fine')).toBe('ok')
  })

  it('shows six and eight accounts at once while unmeasured, an account that is off dimmed in its place (b:hbtt)', async () => {
    const eight = Array.from({ length: 8 }, (_, index) => card(`cc${String(index + 1)}`, `Command Code ${String(index + 1)}`, 10 * (index + 1)))
    const container = await mount({ cards: eight.map(entry => (entry.instanceId === 'cc5' ? { ...entry, enabled: false } : entry)) })
    expect(container.querySelector('[data-quota-status-line]')?.getAttribute('data-quota-segments')).toBe('8')
    const segments = Array.from(container.querySelectorAll('[data-quota-segment] [data-quota-account]'), element => element.getAttribute('data-quota-account'))
    expect(segments[4]).toBe('cc5')
    expect(accountText(container, 'cc5')).toBe('CC5off')
    expect(container.querySelector('[data-quota-account="cc5"]')?.hasAttribute('data-quota-off')).toBe(true)
    expect(accountText(container, 'cc1')).toBe('CC110%· 1d 21h')
  })

  it('names a segment by its short name, or in full once short names are off', async () => {
    const value = settings.value as Record<string, unknown>
    value.usageShortNameOverrides = { cc1: 'WRK' }
    try {
      const named = await mount({ cards: [card('cc1', 'Command Code 1', 51)] })
      expect(accountText(named, 'cc1')).toBe('WRK51%· 1d 21h')
      value.usageShortNames = false
      const full = await mount({ cards: [card('cc1', 'Command Code 1', 51)] })
      expect(accountText(full, 'cc1')).toBe('Command Code 151%· 1d 21h')
    } finally {
      value.usageShortNameOverrides = {}
      delete value.usageShortNames
    }
  })

  it('names the account the open thread uses, in use', async () => {
    const container = await mount({ cards: [card('jarvis', 'Jarvis', 51), card('alfred', 'Alfred', 9)], activeAccountId: 'jarvis' })
    expect(container.querySelector('[data-active-account="jarvis"]')?.getAttribute('aria-current')).toBe('true')
    expect(container.querySelector('[data-quota-segment] [data-quota-account="alfred"]')).not.toBeNull()
  })

  it('keeps the add and settings tools, an empty state, and an account that is off', async () => {
    const empty = await mount({ cards: [] })
    expect(empty.querySelector('[aria-label="Add AI account"]')).not.toBeNull()
    expect(empty.querySelector('[aria-label="AI account settings"]')).not.toBeNull()
    expect(empty.textContent).toContain('Usage')
    const off = card('off', 'Spare', 42)
    const container = await mount({ cards: [{ ...off, enabled: false }] })
    expect(accountText(container, 'off')).toBe('Soff')
    expect(container.querySelector('[data-quota-segment] [data-quota-account="off"]')?.closest('button')?.getAttribute('aria-label')).toMatch(/\. OFF\./u)
  })

  it('ends each segment with its reset, muted on one line, and the limit with the time it lifts (b:jaz6)', async () => {
    const container = await mount({
      cards: [card('fine', 'Fine', 51), card('spent', 'Spent', 0, (2 * 60 + 40.5) * 60_000), card('soon', 'Soon', 40, 12.5 * 60_000)],
    })
    expect(accountText(container, 'spent')).toBe('Slimit· 2h 40m')
    expect(accountText(container, 'soon')).toBe('S40%· 12m')
    const reset = container.querySelector('[data-quota-segment] [data-quota-account="spent"] [data-quota-reset]')
    expect(reset?.className).toMatch(/text-muted-foreground/u)
    expect(reset?.className).toMatch(/tabular-nums/u)
    expect(container.querySelector('[data-quota-account="spent"] [data-quota-tone]')?.textContent).toBe('limit')
    expect(container.textContent).not.toContain('↻')
  })

  it('hides reset times when Show reset times is off (b:jaz6)', async () => {
    const value = settings.value as Record<string, unknown>
    value.showResetTimes = false
    try {
      const container = await mount({ cards: [card('fine', 'Fine', 51), card('spent', 'Spent', 0)] })
      expect(accountText(container, 'fine')).toBe('F51%')
      expect(accountText(container, 'spent')).toBe('Slimit')
      expect(container.querySelector('[data-quota-reset]')).toBeNull()
    } finally {
      delete value.showResetTimes
    }
  })

  it('names a reset in the phone pill only for an account at its limit, and every reset in the sheet (b:jaz6)', async () => {
    vi.stubGlobal('innerWidth', 390)
    const container = await mount({
      cards: [card('cc1', 'Command Code 1', 10), card('cc2', 'Command Code 2', 0, (2 * 60 + 40.5) * 60_000), card('cc3', 'Command Code 3', 60)],
      compact: true,
    })
    expect(container.querySelector('[data-quota-pill]')?.textContent).toBe('CC1 10% · CC2 limit 2h 40m · CC3 60%')
    const detail = container.querySelector('[data-status-detail]')
    expect(detail?.querySelectorAll('[data-quota-reset]')).toHaveLength(3)
    expect(detail?.querySelector('[data-quota-account="cc1"]')?.textContent).toBe('Command Code 110% left· 1d 21h')
  })

  it('names at least three accounts in the phone pill and lists every account in the sheet (b:hbtt)', async () => {
    vi.stubGlobal('innerWidth', 390)
    const six = Array.from({ length: 6 }, (_, index) => card(`cc${String(index + 1)}`, `Command Code ${String(index + 1)}`, 10 * (index + 1)))
    const container = await mount({ cards: six, compact: true })
    const pill = container.querySelector('[data-quota-pill]')?.textContent ?? ''
    expect(pill).toMatch(/^CC1 10% · CC2 20% · CC3 30%/u)
    expect(pill).toMatch(/\+\d$/u)
    const detail = container.querySelector('[data-status-detail]')
    expect(detail?.querySelectorAll('[data-quota-account]')).toHaveLength(6)
    expect(detail?.textContent).toContain('Command Code 6')
  })
})
