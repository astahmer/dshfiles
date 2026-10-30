// @vitest-environment jsdom
// @vitest-environment-options {"pretendToBeVisual":true}
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient, ApiContract } from '@dshfiles/dshx/api'
import { PluginQueryProvider, QueryClient } from '@dshfiles/plugin-ui/query'
import { AccountDraftModel } from './account-draft.js'
import { accountProfileSchema, aiAccountsApi, type AccountsFile, type AccountsUsage } from './api.js'
import { aiAccountsKeys, aiAccountsQueries } from './accounts-queries.js'
import { QuotaFooter, QuotaStrip } from './quota-footer.js'
import { EdgeUsageWidget } from './edge-usage.js'
import type { usePreferences } from './use-preferences.js'

// Only the typed Host boundary is replaced. Query, usage/preferences hooks, arrangement,
// provider glyphs, Radix popover/collapsible and the overview's quota Progress stay real.
type AccountsClient = typeof aiAccountsApi extends ApiContract<infer Methods> ? ApiClient<Methods> : never
const host = vi.hoisted(() => ({
  read: vi.fn<AccountsClient['read']>(),
  save: vi.fn<AccountsClient['save']>(),
  usage: vi.fn<AccountsClient['usage']>(),
  refreshUsage: vi.fn<AccountsClient['refreshUsage']>(),
  reorderAccount: vi.fn<AccountsClient['reorderAccount']>(),
}))
type FixturePreferences = Pick<ReturnType<typeof usePreferences>, 'hiddenUsageAccounts' | 'usageShortNameOverrides' | 'edgeWidget'>
const settings = vi.hoisted(() => {
  const value: FixturePreferences = {
    hiddenUsageAccounts: [],
    usageShortNameOverrides: {},
    edgeWidget: false,
  }
  return { value, set: vi.fn(async () => true), unset: vi.fn(async () => true) }
})
vi.mock('@dshfiles/dshx/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@dshfiles/dshx/client')>()),
  useApi: () => host,
  useSettings: () => settings,
}))
// Native primitives eagerly import an unavailable simple-icons peer in this fixture.
// These snapshots have no reset time, so the formatter must never be called.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  relativeTime: vi.fn(() => {
    throw new Error('No reset formatter is needed by these synthetic snapshots')
  }),
}))

const UNAVAILABLE_ACCOUNT_ID = 'codex_unavailable'
const REJECTED = 'Codex rejected this login; sign in again.'
const UNAVAILABLE_LABEL = `Codex Example: Sign in again. ${REJECTED}`
type Card = AccountsUsage['cards'][number]
const healthy = (instanceId: string, displayName: string, percentRemaining = 42): Card => ({
  instanceId,
  displayName,
  kind: 'codex',
  enabled: true,
  usage: {
    status: 'ok',
    message: null,
    identity: 'synthetic@example.invalid',
    plan: null,
    windows: [{ label: 'Weekly limit', percentRemaining, resetsAt: null }],
    bankedResets: 0,
    bankedResetExpiries: [],
  },
})
const unavailableAccount = (status: Card['usage']['status'] = 'unauthenticated', message: string | null = REJECTED): Card => {
  const card = healthy(UNAVAILABLE_ACCOUNT_ID, 'Codex Example')
  return { ...card, usage: { ...card.usage, status, message, windows: [] } }
}
const snapshot = (cards: Card[]): AccountsUsage => ({ readAt: Date.now(), hostName: 'synthetic-host', cards })
const savedFile = (cards: readonly Card[]): AccountsFile => ({
  distribution: 'priority',
  cooldownMs: 0,
  shadowRoot: '/synthetic/shadows',
  accounts: cards.map(card =>
    accountProfileSchema.parse({
      ...AccountDraftModel.newAccountDraft({ kind: card.kind, existing: [] }),
      instanceId: card.instanceId,
      displayName: card.displayName,
      enabled: card.enabled,
      badge: card.instanceId === UNAVAILABLE_ACCOUNT_ID ? 'EX' : 'OK',
      homePath: '/synthetic/codex/shared',
      shadowHomePath: `/synthetic/auth/${card.instanceId}`,
      mode: 'authOverlay',
      // The Host sees a local credential, but the usage endpoint rejected it.
      // This must not turn the account into a healthy quota or make it disappear.
      signedIn: true,
      identity: 'synthetic@example.invalid',
      plan: null,
      state: card.enabled ? 'healthy' : 'disabled',
      loginHint: '',
      detail: null,
    }),
  ),
})
const roots: { root: Root; container: HTMLDivElement; client: QueryClient }[] = []
const flush = async (): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
}
const mount = async (input: {
  usage: AccountsUsage
  file?: AccountsFile
  activeAccountId?: string | null
  activeAccountRunning?: boolean
  surface?: 'strip' | 'rail' | 'edge'
  onConnectAccount?: (accountId: string) => void
  onOpenAccounts?: () => void
}) => {
  const onConnectAccount = input.onConnectAccount ?? vi.fn<(accountId: string) => void>()
  const onOpenAccounts = input.onOpenAccounts ?? vi.fn<() => void>()
  const file = input.file ?? savedFile(input.usage.cards)
  host.read.mockResolvedValue(file)
  host.usage.mockResolvedValue(input.usage)
  host.refreshUsage.mockResolvedValue(input.usage)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push({ root, container, client })
  await act(async () => {
    root.render(
      <PluginQueryProvider client={client}>
        {input.surface === 'edge' ? (
          <EdgeUsageWidget onConnectAccount={onConnectAccount} onOpenUsageHistory={() => undefined} />
        ) : input.surface === 'rail' ? (
          <QuotaFooter
            wide={false}
            stripSeated={false}
            activeAccountId={input.activeAccountId ?? null}
            activeAccountRunning={input.activeAccountRunning ?? false}
            onOpenAccounts={onOpenAccounts}
            onAddAccount={() => undefined}
            onConnectAccount={onConnectAccount}
            onOpenUsageHistory={() => undefined}
          />
        ) : (
          <QuotaStrip
            activeAccountId={input.activeAccountId ?? null}
            activeAccountRunning={input.activeAccountRunning ?? false}
            onOpenAccounts={onOpenAccounts}
            onAddAccount={() => undefined}
            onConnectAccount={onConnectAccount}
            onOpenUsageHistory={() => undefined}
          />
        )}
      </PluginQueryProvider>,
    )
  })
  await flush()
  return { client, container, file }
}
const strip = (): HTMLElement => {
  const element = document.querySelector<HTMLElement>('[role="group"][aria-label^="AI accounts usage"]')
  if (element === null) throw new Error('Missing actual quota strip')
  return element
}
const accountButtons = (): HTMLButtonElement[] =>
  [...strip().querySelectorAll('button')].filter(button => !['Add AI account', 'AI account settings'].includes(button.getAttribute('aria-label') ?? ''))
const quotaButton = (displayName: string): HTMLButtonElement => {
  const button = accountButtons().find(candidate => candidate.getAttribute('aria-label')?.startsWith(`${displayName}:`))
  if (button === undefined) throw new Error(`Missing account quota button: ${displayName}`)
  return button
}
const click = async (button: HTMLButtonElement): Promise<void> => {
  await act(async () => button.click())
  await flush()
}
const overview = (): HTMLElement => {
  const element = document.querySelector<HTMLElement>('section[aria-label="AI account usage"]')
  if (element === null) throw new Error('Missing actual usage popover')
  return element
}
const overviewCard = (displayName: string): HTMLElement => {
  const card = [...overview().querySelectorAll('article')].find(article => article.querySelector('header strong')?.textContent === displayName)
  if (card === undefined) throw new Error(`Missing visible overview card: ${displayName}`)
  expect(card.closest('[hidden], [data-slot="collapsible"], [data-slot="collapsible-content"]')).toBeNull()
  return card
}
const expectNoSyntheticQuota = (element: Element): void => {
  expect(element.textContent).not.toMatch(/%|\b(?:0|100)\b/u)
  expect(element.querySelector('[role="progressbar"], [aria-valuenow]')).toBeNull()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  )
  settings.value.hiddenUsageAccounts = []
  settings.value.usageShortNameOverrides = {}
  settings.value.edgeWidget = false
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
    await vi.advanceTimersByTimeAsync(1)
  })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const surfaces = ['strip', 'rail', 'edge'] as const
const surfaceOpener = (surface: (typeof surfaces)[number]): HTMLButtonElement => {
  if (surface === 'strip') return quotaButton('Codex Example')
  const selector = surface === 'rail' ? 'button[aria-label^="AI accounts usage."]' : 'aside[aria-label="AI Accounts usage"] button'
  const button = document.querySelector<HTMLButtonElement>(selector)
  if (button === null) throw new Error(`Missing actual ${surface} quota opener`)
  return button
}
const reauthenticateButtons = (card: HTMLElement): HTMLButtonElement[] =>
  [...card.querySelectorAll('button')].filter(button => button.textContent?.trim() === 'Reauthenticate')

describe('popover account availability', () => {
  it('saves the requested availability using fresh account settings and updates every surface without closing', async () => {
    const initial = healthy('work', 'Work')
    const view = await mount({ usage: snapshot([initial]) })
    await click(quotaButton('Work'))
    const toggle = overviewCard('Work').querySelector<HTMLButtonElement>('[role="switch"]')
    if (toggle === null) throw new Error('Missing Enable Work toggle')
    expect(toggle.getAttribute('aria-label')).toBe('Enable Work')
    expect(toggle.getAttribute('data-state')).toBe('checked')
    expect(toggle.classList.contains('dshx:data-[state=checked]:bg-info')).toBe(true)
    expect(overviewCard('Work').querySelector('[role="checkbox"]')).toBeNull()
    const latest = savedFile([initial])
    latest.accounts[0]!.displayName = 'Renamed elsewhere'
    latest.accounts[0]!.badge = 'NEW'
    host.read.mockResolvedValue(latest)
    const next = { ...latest, accounts: latest.accounts.map(account => ({ ...account, enabled: false, state: 'disabled' as const })) }
    host.save.mockImplementation(async () => {
      host.read.mockResolvedValue(next)
      host.usage.mockResolvedValue(snapshot([{ ...initial, displayName: 'Renamed elsewhere', enabled: false }]))
      return next
    })
    await click(toggle)
    await flush()
    expect(host.save).toHaveBeenCalledWith({ draft: { ...AccountDraftModel.toDraft(latest.accounts[0]!), enabled: false } })
    expect(settings.set).not.toHaveBeenCalled()
    expect(view.client.getQueryData(aiAccountsKeys.file)).toEqual(next)
    expect(overviewCard('Renamed elsewhere').textContent).toContain('OFF')
    expect(overviewCard('Renamed elsewhere').textContent).toContain('42% left')
    expect(quotaButton('Renamed elsewhere').classList.contains('dshx:opacity-50')).toBe(true)
    expect(overviewCard('Renamed elsewhere').querySelector('[role="switch"]')?.getAttribute('data-state')).toBe('unchecked')
  })

  it('keeps failed changes visible, preserves committed state and permits a retry', async () => {
    await mount({ usage: snapshot([healthy('work', 'Work')]) })
    await click(quotaButton('Work'))
    const toggle = overviewCard('Work').querySelector<HTMLButtonElement>('[role="switch"]')
    if (toggle === null) throw new Error('Missing Enable Work toggle')
    host.save.mockRejectedValue(new Error('Synthetic save refused'))
    await click(toggle)
    expect(overviewCard('Work').querySelector('[role="alert"]')?.textContent).toContain('Synthetic save refused')
    expect(toggle.getAttribute('data-state')).toBe('checked')
    expect(toggle.disabled).toBe(false)
    await click(toggle)
    expect(host.save).toHaveBeenCalledTimes(2)
  })

  it('disables the toggle while a save is pending and sends only one change', async () => {
    await mount({ usage: snapshot([healthy('work', 'Work')]) })
    await click(quotaButton('Work'))
    const toggle = overviewCard('Work').querySelector<HTMLButtonElement>('[role="switch"]')
    if (toggle === null) throw new Error('Missing Enable Work toggle')
    let rejectSave: (reason: Error) => void = () => {
      throw new Error('Pending save was not initialized')
    }
    const held = new Promise<AccountsFile>((_resolve, reject) => {
      rejectSave = reject
    })
    host.save.mockReturnValue(held)
    await click(toggle)
    expect(toggle.disabled).toBe(true)
    expect(overviewCard('Work').querySelector('[role="status"]')?.textContent).toContain('Saving')
    await click(toggle)
    expect(host.save).toHaveBeenCalledTimes(1)
    await act(async () => rejectSave(new Error('Synthetic deferred failure')))
    await flush()
    expect(toggle.disabled).toBe(false)
  })
})

describe('uniform sidebar account card surfaces', () => {
  it('keeps a small vertical gap around full-height preview cards', async () => {
    await mount({ usage: snapshot([healthy('work', 'Work')]) })
    expect(strip().classList.contains('dshx:py-0.5')).toBe(true)
    expect(strip().classList.contains('dshx:py-1')).toBe(false)
    expect(quotaButton('Work').classList.contains('dshx:h-8')).toBe(true)
  })
  it('keeps disabled quota and reset data visible with a compact OFF label and muted meter', async () => {
    const off = healthy('off', 'Work', 42)
    off.enabled = false
    off.usage.windows[0]!.resetsAt = Date.now() + 2 * 3_600_000
    await mount({ usage: snapshot([off]) })
    const button = quotaButton('Work')
    expect(button.textContent).toContain('42%')
    expect(button.textContent).toContain('↻')
    expect(button.textContent).toContain('OFF')
    expect(button.textContent).not.toContain('Disabled')
    expect(button.getAttribute('aria-label')).toContain('OFF')
    expect(button.classList.contains('dshx:h-8')).toBe(true)
    const percent = [...button.querySelectorAll('span')].find(span => span.textContent === '42%')
    expect(percent?.classList.contains('dshx:text-muted-foreground')).toBe(true)
    await click(button)
    const card = overviewCard('Work')
    expect(card.textContent).toContain('42% left')
    expect(card.textContent).toContain('Resets in')
    expect(card.querySelector('[role="switch"]')?.getAttribute('data-state')).toBe('unchecked')
  })
  it('renders the account preview without a horizontal divider above the list', async () => {
    await mount({ usage: snapshot([healthy('work', 'Work')]) })
    expect(strip().classList.contains('dshx:border-t')).toBe(false)
    expect(quotaButton('Work')).toBeDefined()
  })
  it('paints active and exhausted states on the same full-height button, not a shorter inner badge', async () => {
    await mount({
      usage: snapshot([healthy('active', 'Active', 80), healthy('exhausted', 'Exhausted', 0)]),
      activeAccountId: 'active',
      activeAccountRunning: true,
    })
    const active = quotaButton('Active')
    const exhausted = quotaButton('Exhausted')
    expect(active.classList.contains('dshx:h-8')).toBe(true)
    expect(exhausted.classList.contains('dshx:h-8')).toBe(true)
    expect(active.classList.contains('dshx:bg-primary/10')).toBe(true)
    expect(exhausted.classList.contains('dshx:bg-destructive/10')).toBe(true)
    expect(exhausted.querySelector('[class~="dshx:bg-destructive/10"]')).toBeNull()
    expect(exhausted.getAttribute('aria-label')).toContain('limit reached')
  })
  it('keeps the exhausted background when that account is also the active account', async () => {
    await mount({ usage: snapshot([healthy('active', 'Active', 0)]), activeAccountId: 'active' })
    const active = quotaButton('Active')
    expect(active.classList.contains('dshx:bg-destructive/10')).toBe(true)
    expect(active.classList.contains('dshx:bg-primary/10')).toBe(false)
    expect(active.getAttribute('aria-current')).toBe('true')
  })
})

describe('sidebar account settings shortcut', () => {
  it('closes the quota popover and opens AI Accounts without reconnecting', async () => {
    const onOpenAccounts = vi.fn<() => void>()
    const onConnectAccount = vi.fn<(accountId: string) => void>()
    const view = await mount({ usage: snapshot([healthy('work', 'Work')]), onOpenAccounts, onConnectAccount })
    await click(quotaButton('Work'))
    expect(view.container.querySelector('[aria-expanded="true"]')).not.toBeNull()
    const settings = strip().querySelector<HTMLButtonElement>('button[aria-label="AI account settings"]')
    expect(settings?.type).toBe('button')
    expect(settings?.querySelector('svg')).not.toBeNull()
    if (settings === null) throw new Error('Missing sidebar account settings button')
    await click(settings)
    await flush()
    expect(onOpenAccounts).toHaveBeenCalledOnce()
    expect(onConnectAccount).not.toHaveBeenCalled()
    expect(view.container.querySelector('[aria-expanded="true"]')).toBeNull()
  })
  it('keeps settings accessible beside Add even when the account list is empty', async () => {
    const onOpenAccounts = vi.fn<() => void>()
    await mount({ usage: snapshot([]), onOpenAccounts })
    expect(strip().querySelector('button[aria-label="Add AI account"]')).not.toBeNull()
    const settings = strip().querySelector<HTMLButtonElement>('button[aria-label="AI account settings"]')
    expect(settings).not.toBeNull()
    if (settings === null) throw new Error('Missing sidebar account settings button')
    await click(settings)
    expect(onOpenAccounts).toHaveBeenCalledOnce()
  })
})

describe('actual quota reauthentication entry points', () => {
  it.each(surfaces)('%s opens all accounts without reconnecting, then closes on the selected account action', async surface => {
    settings.value.edgeWidget = true
    const other = { ...unavailableAccount(), instanceId: 'codex_other', displayName: 'Codex Other' }
    const onConnectAccount = vi.fn<(accountId: string) => void>()
    const view = await mount({ usage: snapshot([unavailableAccount(), other, healthy('healthy', 'Codex Healthy')]), surface, onConnectAccount })
    expect(onConnectAccount).not.toHaveBeenCalled()

    const opener = surfaceOpener(surface)
    await click(opener)
    expect([...overview().querySelectorAll('article header strong')].map(element => element.textContent)).toEqual([
      'Codex Example',
      'Codex Other',
      'Codex Healthy',
    ])
    expect(onConnectAccount).not.toHaveBeenCalled()
    expect(reauthenticateButtons(overviewCard('Codex Example'))).toHaveLength(1)
    const buttons = reauthenticateButtons(overviewCard('Codex Other'))
    expect(buttons).toHaveLength(1)
    const action = buttons[0]
    if (action === undefined) throw new Error('Missing actual card Reauthenticate button')
    await click(action)
    expect(onConnectAccount).toHaveBeenCalledExactlyOnceWith('codex_other')
    expect(document.querySelector('section[aria-label="AI account usage"]')).toBeNull()
    expect(opener.getAttribute('aria-expanded')).toBe('false')
    expect(view.client.getQueryData(aiAccountsKeys.file)).toEqual(view.file)
    expect(host.reorderAccount).not.toHaveBeenCalled()

    await click(opener)
    expect(overviewCard('Codex Example')).toBeDefined()
    expect(onConnectAccount).toHaveBeenCalledTimes(1)
  })

  describe.each(surfaces)('%s excludes reconnect actions for other quota states', surface => {
    it.each([
      ['healthy', healthy(UNAVAILABLE_ACCOUNT_ID, 'Codex Example')],
      ['error', unavailableAccount('error', 'Synthetic quota read failed.')],
      ['rate-limited', unavailableAccount('rate-limited', 'Synthetic quota throttled.')],
      ['unsupported', unavailableAccount('unsupported', 'No synthetic quota support.')],
      ['ok-empty', unavailableAccount('ok', 'No quota windows reported.')],
    ] as const)('%s has no Reauthenticate action and opening has no callback', async (_label, card) => {
      settings.value.edgeWidget = true
      const onConnectAccount = vi.fn<(accountId: string) => void>()
      await mount({ usage: snapshot([card]), surface, onConnectAccount })
      await click(surfaceOpener(surface))
      expect(reauthenticateButtons(overviewCard('Codex Example'))).toHaveLength(0)
      expect(onConnectAccount).not.toHaveBeenCalled()
      expect(host.reorderAccount).not.toHaveBeenCalled()
    })
  })
})

describe('actual quota strip and usage popover unavailable-account regression', () => {
  it('keeps enabled Example visible when local credentials exist but usage is unauthenticated, without a fake quota', async () => {
    const view = await mount({ usage: snapshot([unavailableAccount()]) })
    expect(view.file.accounts[0]).toMatchObject({ instanceId: UNAVAILABLE_ACCOUNT_ID, enabled: true, signedIn: true })
    const button = quotaButton('Codex Example')
    expect(button.getAttribute('aria-label')).toBe(UNAVAILABLE_LABEL)
    expect(button.textContent).toContain('EX')
    expect(button.textContent).toContain('Sign in again')
    expect(button.querySelector('[class~="dshx:flex-col"]')?.textContent).toContain('Sign in again')
    expect(button.querySelector('[role="img"][aria-label="Codex"]')).not.toBeNull()
    expectNoSyntheticQuota(button)
    expect(host.usage).toHaveBeenCalledWith(undefined, expect.objectContaining({ signal: expect.any(AbortSignal) }))

    await click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    const card = overviewCard('Codex Example')
    expect(card.textContent).toContain('Sign in again')
    expect(card.textContent).toContain(REJECTED)
    expectNoSyntheticQuota(card)
    expect(overview().textContent).not.toContain('without quota data')
    expect(overview().textContent).not.toContain('No account with quota to show')
    expect([...overview().querySelectorAll('button')].some(candidate => /hidden/u.test(candidate.textContent ?? ''))).toBe(false)
  })

  it.each([true, false])('keeps the known active-account wire highlighted while unavailable (running=%s)', async running => {
    await mount({ usage: snapshot([unavailableAccount()]), activeAccountId: UNAVAILABLE_ACCOUNT_ID, activeAccountRunning: running })
    const button = quotaButton('Codex Example')
    expect(button.getAttribute('data-active-account')).toBe(UNAVAILABLE_ACCOUNT_ID)
    expect(button.getAttribute('aria-current')).toBe('true')
    expect(button.getAttribute('aria-label')).toBe(`${UNAVAILABLE_LABEL}. ${running ? 'In use by active chat' : 'Last used by active chat'}`)
    expect(strip().querySelectorAll(`[data-active-account="${UNAVAILABLE_ACCOUNT_ID}"]`)).toHaveLength(1)
    expectNoSyntheticQuota(button)
    expect(button.textContent).toContain('Sign in again')
    expect(button.getAttribute('aria-label')).not.toContain('Quota unavailable or hidden')
  })

  it.each([
    ['error', 'Synthetic provider read failed.'],
    ['rate-limited', 'Synthetic provider is throttled.'],
    ['unsupported', 'This synthetic provider reports no quota.'],
    ['ok', 'No quota windows reported.'],
  ] as const)('renders %s without windows as quota unavailable, not a percentage', async (status, reason) => {
    await mount({ usage: snapshot([unavailableAccount(status, reason)]) })
    const button = quotaButton('Codex Example')
    expect(button.getAttribute('aria-label')).toBe(`Codex Example: Quota unavailable. ${reason}`)
    expect(button.textContent).toContain('Quota unavailable')
    expectNoSyntheticQuota(button)
    await click(button)
    const card = overviewCard('Codex Example')
    expect(card.textContent).toContain('Quota unavailable')
    expect(card.textContent).toContain(reason)
    expectNoSyntheticQuota(card)
  })

  it('keeps disabled accounts visible and dimmed while explicitly hidden accounts stay hidden', async () => {
    settings.value.hiddenUsageAccounts = [UNAVAILABLE_ACCOUNT_ID]
    const disabled = { ...healthy('disabled', 'Codex Disabled'), enabled: false }
    const visible = healthy('visible', 'Codex Visible')
    await mount({ usage: snapshot([unavailableAccount(), disabled, visible]) })
    expect(accountButtons().map(button => button.getAttribute('aria-label')?.split(':')[0])).toEqual(['Codex Disabled', 'Codex Visible'])
    expect(quotaButton('Codex Disabled').classList.contains('dshx:opacity-50')).toBe(true)
    expect(quotaButton('Codex Disabled').disabled).toBe(false)
    expect(quotaButton('Codex Disabled').textContent).toContain('OFF')
    expect(quotaButton('Codex Disabled').textContent).toContain('42%')
    await click(quotaButton('Codex Visible'))
    expect([...overview().querySelectorAll('article header strong')].map(element => element.textContent)).toEqual(['Codex Disabled', 'Codex Visible'])
    expect(overviewCard('Codex Disabled').textContent).toContain('42% left')
    expect(overview().textContent).toContain('hidden by you')
    expect(overviewCard('Codex Disabled').querySelector('[role="switch"]')?.getAttribute('data-state')).toBe('unchecked')
    expect(overview().textContent).not.toContain(REJECTED)
  })

  it('preserves the intentional active-account fallback chip for an explicitly hidden account', async () => {
    settings.value.hiddenUsageAccounts = [UNAVAILABLE_ACCOUNT_ID]
    await mount({
      usage: snapshot([unavailableAccount(), healthy('other', 'Codex Other')]),
      activeAccountId: UNAVAILABLE_ACCOUNT_ID,
      activeAccountRunning: true,
    })
    const chip = strip().querySelector<HTMLButtonElement>(`button[data-active-account="${UNAVAILABLE_ACCOUNT_ID}"]`)
    expect(chip?.getAttribute('aria-label')).toBe('Codex Example. In use by active chat. Quota unavailable or hidden.')
    expect(chip?.getAttribute('aria-current')).toBe('true')
    expect(accountButtons()).toHaveLength(2)
    expect(accountButtons().some(button => button.getAttribute('aria-label') === UNAVAILABLE_LABEL)).toBe(false)
    if (chip === null) throw new Error('Missing intentional active hidden-account chip')
    expectNoSyntheticQuota(chip)
  })

  it('interleaves healthy and unavailable accounts in canonical store order, not stale sweep order', async () => {
    const first = healthy('first', 'Codex First', 61)
    const last = healthy('last', 'Codex Last', 17)
    const usage = snapshot([last, first, unavailableAccount()])
    await mount({ usage, file: savedFile([first, unavailableAccount(), last]) })
    expect(accountButtons().map(button => button.getAttribute('aria-label')?.split(':')[0])).toEqual(['Codex First', 'Codex Example', 'Codex Last'])
    await click(quotaButton('Codex Example'))
    expect([...overview().querySelectorAll('article header strong')].map(element => element.textContent)).toEqual([
      'Codex First',
      'Codex Example',
      'Codex Last',
    ])
    expectNoSyntheticQuota(overviewCard('Codex Example'))
    expect(overviewCard('Codex First').textContent).toContain('61% left')
    expect(overviewCard('Codex First').querySelector('[role="progressbar"]')).not.toBeNull()
    expect(overviewCard('Codex Last').textContent).toContain('17% left')
    expect(overviewCard('Codex Last').querySelector('[role="progressbar"]')).not.toBeNull()
  })

  it('keeps session before weekly quota in the actual popover even when the Host reports weekly first', async () => {
    const card = healthy(UNAVAILABLE_ACCOUNT_ID, 'Codex Example', 42)
    card.usage.windows.push({ label: 'Current session', percentRemaining: 69, resetsAt: null })
    await mount({ usage: snapshot([card]) })
    await click(quotaButton('Codex Example'))
    expect([...overviewCard('Codex Example').querySelectorAll('[role="progressbar"]')].map(progress => progress.getAttribute('aria-label'))).toEqual([
      'Codex Example Current session remaining',
      'Codex Example Weekly limit remaining',
    ])
  })

  it('keeps an all-unavailable collapsed rail actionable with a sign-in status, never a synthetic percentage', async () => {
    const view = await mount({ usage: snapshot([unavailableAccount()]), surface: 'rail' })
    const button = [...view.container.querySelectorAll('button')].find(candidate => candidate.getAttribute('aria-label')?.startsWith('AI accounts usage.'))
    if (button === undefined) throw new Error('Missing unavailable collapsed rail button')
    expect(button.getAttribute('aria-label')).toBe(`AI accounts usage. ${UNAVAILABLE_LABEL}`)
    expect(button.textContent).toContain('Sign in')
    expect(button.querySelector('[role="img"][aria-label="Codex"]')).not.toBeNull()
    expectNoSyntheticQuota(button)
    await click(button)
    expect(overviewCard('Codex Example').textContent).toContain(REJECTED)
    expectNoSyntheticQuota(overviewCard('Codex Example'))
  })

  it('keeps the all-unavailable edge widget visible and neutral instead of implying healthy quota', async () => {
    settings.value.edgeWidget = true
    await mount({ usage: snapshot([unavailableAccount()]), surface: 'edge' })
    const button = document.querySelector<HTMLButtonElement>('aside[aria-label="AI Accounts usage"] button')
    if (button === null) throw new Error('Missing unavailable edge usage opener')
    expect(button.getAttribute('aria-label')).toBe('Open AI Accounts usage')
    expect(button.textContent).toBe('AI·')
    expectNoSyntheticQuota(button)
    const summary = button.querySelector('span:last-child')
    expect(summary?.classList.contains('dshx:text-muted-foreground')).toBe(true)
    expect(summary?.classList.contains('dshx:text-success')).toBe(false)
    await click(button)
    expect(overviewCard('Codex Example').textContent).toContain(REJECTED)
    expectNoSyntheticQuota(overviewCard('Codex Example'))
  })

  it('keeps the same identity and active button through healthy → unauthenticated → recovered usage reads', async () => {
    const initial = snapshot([healthy(UNAVAILABLE_ACCOUNT_ID, 'Codex Example', 42)])
    const view = await mount({ usage: initial, activeAccountId: UNAVAILABLE_ACCOUNT_ID, activeAccountRunning: true })
    const originalButton = quotaButton('Codex Example')
    expect(originalButton.textContent).toContain('42%')
    await click(originalButton)
    expect(overviewCard('Codex Example').textContent).toContain('42% left')
    expect(overviewCard('Codex Example').querySelector('[role="progressbar"]')).not.toBeNull()

    const readNext = async (next: AccountsUsage): Promise<void> => {
      host.usage.mockResolvedValue(next)
      await act(async () => {
        await view.client.fetchQuery({ ...aiAccountsQueries.usage(host, 60_000), staleTime: 0 })
      })
      await flush()
    }
    await readNext(snapshot([unavailableAccount()]))
    const unavailable = quotaButton('Codex Example')
    expect(unavailable).toBe(originalButton)
    expect(unavailable.getAttribute('data-active-account')).toBe(UNAVAILABLE_ACCOUNT_ID)
    expect(unavailable.getAttribute('aria-current')).toBe('true')
    expect(unavailable.textContent).toContain('Sign in again')
    expectNoSyntheticQuota(unavailable)
    expect(overviewCard('Codex Example').textContent).toContain(REJECTED)
    expectNoSyntheticQuota(overviewCard('Codex Example'))

    await readNext(snapshot([healthy(UNAVAILABLE_ACCOUNT_ID, 'Codex Example', 73)]))
    const recovered = quotaButton('Codex Example')
    expect(recovered).toBe(originalButton)
    expect(recovered.getAttribute('data-active-account')).toBe(UNAVAILABLE_ACCOUNT_ID)
    expect(recovered.getAttribute('aria-current')).toBe('true')
    expect(recovered.textContent).toContain('73%')
    expect(recovered.textContent).not.toContain('Sign in again')
    expect(overviewCard('Codex Example').textContent).toContain('73% left')
    expect(overviewCard('Codex Example').querySelector('[role="progressbar"]')).not.toBeNull()
    expect(overview().textContent).not.toContain(REJECTED)
    expect(view.client.getQueryData(aiAccountsKeys.file)).toEqual(view.file)
  })
})
