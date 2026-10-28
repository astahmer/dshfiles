// @vitest-environment jsdom
import type { ApiClient, ApiContract } from '@dshfiles/dshx/api'
import { PluginQueryProvider, QueryClient } from '@dshfiles/plugin-ui/query'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountDraftModel } from './account-draft.js'
import { acceptAccountOrder, aiAccountsKeys } from './accounts-queries.js'
import { aiAccountsApi, accountProfileSchema, type AccountsFile } from './api.js'
import { DEFAULT_CLIENT_SETTINGS } from './settings.js'
import { useAccountsPanelState, type AccountsPanelState } from './use-accounts-panel-state.js'

type AccountsClient = typeof aiAccountsApi extends ApiContract<infer Methods> ? ApiClient<Methods> : never
const api = vi.hoisted(() => ({
  read: vi.fn<AccountsClient['read']>(),
  usage: vi.fn<AccountsClient['usage']>(),
  history: vi.fn<AccountsClient['history']>(),
  catalog: vi.fn<AccountsClient['catalog']>(),
  save: vi.fn<AccountsClient['save']>(),
}))
// Query, preferences, draft reconciliation and the debounce actor are real; only Host/settings are replaced.
vi.mock('@dshfiles/dshx/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@dshfiles/dshx/client')>()),
  useApi: (): Pick<AccountsClient, keyof typeof api> => api,
  // Loading/unavailable Settings uses the real usePreferences defaults, including auto-save mode and delay.
  useSettings: (): Pick<AccountsPanelState['preferences']['settings'], 'value'> => ({ value: undefined }),
}))

// As in quota-footer.test.tsx, native primitives eagerly import an unavailable simple-icons peer.
// This hook fixture never copies anything; fail loudly if it crosses that unrelated boundary.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  writeClipboard: vi.fn<typeof import('@deepseek-ai/dsh-client-ui-primitives').writeClipboard>(() => {
    throw new Error('Clipboard use is outside this account synchronization fixture.')
  }),
}))

const initialFile = (): AccountsFile => ({
  distribution: 'priority',
  cooldownMs: 0,
  shadowRoot: '',
  accounts: [
    accountProfileSchema.parse({
      ...AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }),
      instanceId: 'synthetic',
      displayName: 'Synthetic Work',
      mode: 'authOverlay',
      signedIn: true,
      identity: null,
      plan: null,
      state: 'healthy',
      loginHint: '',
      detail: null,
    }),
  ],
})
let stored: AccountsFile
const views: { root: Root; container: HTMLDivElement; client: QueryClient; mounted: boolean }[] = []
const advance = async (milliseconds = 1): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds)
  })
}
const mount = async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const view = { root, container, client, mounted: true }
  views.push(view)
  let snapshot: AccountsPanelState | null = null
  const Probe = () => {
    const state = useAccountsPanelState()
    useEffect(() => {
      snapshot = state
    }, [state])
    return null
  }
  await act(async () => {
    root.render(
      <PluginQueryProvider client={client}>
        <Probe />
      </PluginQueryProvider>,
    )
  })
  await advance()
  await advance()
  const current = (): AccountsPanelState => {
    if (snapshot === null) throw new Error('The actual accounts hook has not rendered.')
    return snapshot
  }
  const unmount = async (): Promise<void> => {
    await act(async () => {
      root.unmount()
      view.mounted = false
    })
  }
  // Publish the same committed Host snapshot the compact popover publishes, including its invalidating reread.
  const externallyDisable = async (): Promise<void> => {
    stored = { ...stored, accounts: stored.accounts.map(account => ({ ...account, enabled: false, state: 'disabled' })) }
    await act(async () => {
      await acceptAccountOrder(client, stored)
    })
    await advance()
  }
  expect(current().selectedId).toBe('synthetic')
  expect(current().draft?.enabled).toBe(true)
  expect(current().dirty).toBe(false)
  expect(current().saveMode).toBe('auto')
  expect(api.save).not.toHaveBeenCalled()
  return { client, current, unmount, externallyDisable }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stored = initialFile()
  api.read.mockReset().mockImplementation(async () => stored)
  api.usage.mockReset().mockResolvedValue({ readAt: 1, hostName: 'synthetic-host', cards: [] })
  api.history.mockReset().mockResolvedValue({ instanceId: 'synthetic', points: [] })
  api.catalog.mockReset().mockResolvedValue({ instanceId: 'synthetic', models: [] })
  api.save.mockReset().mockImplementation(async ({ draft }) => {
    stored = {
      ...stored,
      accounts: stored.accounts.map(account => (account.instanceId === draft.instanceId ? accountProfileSchema.parse({ ...account, ...draft }) : account)),
    }
    return stored
  })
})
afterEach(async () => {
  await act(async () => {
    for (const view of views.splice(0)) {
      if (view.mounted) view.root.unmount()
      view.container.remove()
      view.client.clear()
    }
  })
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('actual accounts panel hook following external account changes', () => {
  it.each(['debounce', 'unmount'] as const)('does not re-enable a clean selected account on %s after a popover disable', async trigger => {
    const view = await mount()
    await view.externallyDisable()
    expect(view.current().draft?.enabled).toBe(false)
    expect(view.current().selected?.enabled).toBe(false)
    expect(view.current().dirty).toBe(false)

    if (trigger === 'unmount') await view.unmount()
    await advance(DEFAULT_CLIENT_SETTINGS.autoSaveDelayMs + 1)
    await advance()

    expect(api.save).not.toHaveBeenCalled()
    expect(stored.accounts[0]?.enabled).toBe(false)
    expect(view.client.getQueryData<AccountsFile>(aiAccountsKeys.file)?.accounts[0]?.enabled).toBe(false)
    if (trigger === 'debounce') {
      expect(view.current().draft?.enabled).toBe(false)
      expect(view.current().dirty).toBe(false)
    }
  })

  it('keeps an unrelated pending local edit without saving a stale enabled flag', async () => {
    const view = await mount()
    const draft = view.current().draft
    if (draft === null) throw new Error('Expected an initialized account draft.')
    await act(async () => {
      view.current().setDraft({ ...draft, displayName: 'Locally edited name' })
    })
    expect(view.current().dirty).toBe(true)
    await view.externallyDisable()
    expect(view.current().draft).toMatchObject({ displayName: 'Locally edited name', enabled: false })

    await advance(DEFAULT_CLIENT_SETTINGS.autoSaveDelayMs + 1)
    await advance()
    await view.unmount()
    await advance()

    expect(api.save).toHaveBeenCalledOnce()
    expect(api.save.mock.calls[0]?.[0].draft).toMatchObject({ displayName: 'Locally edited name', enabled: false })
    expect(stored.accounts[0]).toMatchObject({ displayName: 'Locally edited name', enabled: false })
    expect(view.client.getQueryData<AccountsFile>(aiAccountsKeys.file)?.accounts[0]?.enabled).toBe(false)
  })
})
