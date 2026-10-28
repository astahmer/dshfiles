// @vitest-environment jsdom
// @vitest-environment-options {"pretendToBeVisual":true}
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient, ApiContract } from '@dshfiles/dshx/api'
import { PluginQueryProvider, QueryClient } from '@dshfiles/plugin-ui/query'
import { AccountDraftModel } from './account-draft.js'
import { accountProfileSchema, type AccountProfile } from './api.js'
import { aiAccountsSessionApi } from './account-session-api.js'
import { AccountSignOut } from './account-sign-out.js'
import { aiAccountsKeys } from './accounts-queries.js'

type SessionClient = typeof aiAccountsSessionApi extends ApiContract<infer Methods> ? ApiClient<Methods> : never
const api = vi.hoisted(() => ({ capability: vi.fn<SessionClient['capability']>(), signOut: vi.fn<SessionClient['signOut']>() }))
vi.mock('@dshfiles/dshx/client', async importOriginal => ({ ...(await importOriginal<typeof import('@dshfiles/dshx/client')>()), useApi: () => api }))
const profile = (patch: Partial<AccountProfile> = {}): AccountProfile =>
  accountProfileSchema.parse({
    ...AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }),
    instanceId: 'synthetic',
    displayName: 'Synthetic Work',
    signedIn: true,
    identity: null,
    plan: null,
    state: 'healthy',
    loginHint: '',
    detail: null,
    mode: 'authOverlay',
    ...patch,
  })
const views: { root: Root; container: HTMLDivElement; client: QueryClient }[] = []
const flush = async (): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
}
const mount = async (account = profile(), callback = vi.fn()) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  views.push({ root, container, client })
  await act(async () => {
    root.render(
      <PluginQueryProvider client={client}>
        <AccountSignOut account={account} onSignedOut={callback} />
      </PluginQueryProvider>,
    )
  })
  await flush()
  return { root, container, client, callback }
}
const button = (scope: ParentNode, label: string): HTMLButtonElement => {
  const found = [...scope.querySelectorAll('button')].find(element => element.textContent === label)
  if (found === undefined) throw new Error(`Missing button ${label}`)
  return found
}
const click = async (element: HTMLElement): Promise<void> => {
  await act(async () => {
    element.click()
  })
  await flush()
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
  api.capability.mockReset().mockResolvedValue({
    instanceId: 'synthetic',
    available: true,
    reason: null,
    credentialScope: 'Only the private synthetic account credential; shared credentials stay unchanged.',
  })
  api.signOut.mockReset().mockResolvedValue({ signedOut: true })
})
afterEach(async () => {
  await act(async () => {
    for (const view of views.splice(0)) {
      view.root.unmount()
      view.container.remove()
      view.client.clear()
    }
  })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
describe('real account sign-out confirmation component with fake Host', () => {
  it('opens a named scoped confirmation without mutating; Cancel preserves authentication', async () => {
    const view = await mount()
    await click(button(view.container, 'Sign out'))
    const dialog = document.querySelector('[role="alertdialog"]')
    expect(dialog?.textContent).toContain('Sign out of Synthetic Work?')
    expect(dialog?.textContent).toContain('Only the private synthetic account credential')
    expect(dialog?.textContent).toContain('profile, enabled setting and model preferences stay')
    expect(api.signOut).not.toHaveBeenCalled()
    if (dialog === null) throw new Error('Expected confirmation')
    await click(button(dialog, 'Cancel'))
    expect(api.signOut).not.toHaveBeenCalled()
  })
  it('requires explicit confirmation, prevents duplicate submission and invalidates file/usage after success', async () => {
    let finish = (): void => {
      throw new Error('Synthetic request not ready')
    }
    api.signOut.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = () => resolve({ signedOut: true })
        }),
    )
    const view = await mount()
    const invalidate = vi.spyOn(view.client, 'invalidateQueries')
    await click(button(view.container, 'Sign out'))
    const dialog = document.querySelector('[role="alertdialog"]')
    if (dialog === null) throw new Error('Expected confirmation')
    await click(button(dialog, 'Sign out'))
    expect(api.signOut).toHaveBeenCalledExactlyOnceWith({ instanceId: 'synthetic', confirm: true })
    expect(button(dialog, 'Signing out…').disabled).toBe(true)
    await click(button(dialog, 'Signing out…'))
    expect(api.signOut).toHaveBeenCalledOnce()
    await act(async () => {
      finish()
    })
    await flush()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: aiAccountsKeys.file })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: aiAccountsKeys.usage })
    expect(view.callback).toHaveBeenCalledOnce()
  })
  it('shows truthful unsupported reasons on a disabled action without a fake click', async () => {
    api.capability.mockResolvedValue({
      instanceId: 'synthetic',
      available: false,
      reason: 'This source is a shared CLI login. Run cmd logout manually.',
      credentialScope: null,
    })
    const view = await mount(profile({ kind: 'commandcode' }))
    expect(button(view.container, 'Sign out').disabled).toBe(true)
    expect(view.container.querySelector('[aria-label]')?.getAttribute('aria-label')).toContain('Run cmd logout manually')
    await click(button(view.container, 'Sign out'))
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    expect(api.signOut).not.toHaveBeenCalled()
  })
  it('redacts Host errors and does not announce success', async () => {
    api.signOut.mockRejectedValue(new Error('synthetic-sensitive-error-output'))
    const view = await mount()
    await click(button(view.container, 'Sign out'))
    const dialog = document.querySelector('[role="alertdialog"]')
    if (dialog === null) throw new Error('Expected confirmation')
    await click(button(dialog, 'Sign out'))
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('Could not sign out')
    expect(document.body.textContent).not.toContain('synthetic-sensitive-error-output')
    expect(view.callback).not.toHaveBeenCalled()
  })
  it('degrades safely against an older Host without the new contract', async () => {
    api.capability.mockRejectedValue(new Error('Unknown API'))
    const view = await mount()
    expect(button(view.container, 'Sign out').disabled).toBe(true)
    expect(view.container.textContent).toBe('Sign out')
    expect(view.container.querySelector('[aria-label]')?.getAttribute('aria-label')).toContain('updated Host')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(api.capability).toHaveBeenCalledOnce()
    expect(api.signOut).not.toHaveBeenCalled()
  })
})
