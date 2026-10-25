// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginQueryProvider, QueryClient } from '@dshfiles/plugin-ui/query'
import { networkEnglish, type NetworkTranslate } from './locales.js'
import type { NetworkSnapshot } from './network-api.js'
import { NetworkPreferences, NetworkSection } from './network-section.js'

const unavailableHost = vi.hoisted(() => ({
  network: vi.fn(async () => {
    throw new Error('Host method is unavailable')
  }),
}))
vi.mock('@dshfiles/dshx/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@dshfiles/dshx/client')>()),
  useApi: () => unavailableHost,
}))

const t: NetworkTranslate = key => Object.entries(networkEnglish).find(([name]) => name === key)?.[1] ?? key

const initialSnapshot = (): NetworkSnapshot => ({
  revision: 4,
  writable: true,
  saved: { lanEnabled: false, bindAddress: null, localhostEnabled: true, port: 0 },
  active: { host: '127.0.0.1', port: 3199, localhostEnabled: true, urls: ['http://127.0.0.1:3199'] },
  addresses: [{ interfaceName: 'en0', address: '192.168.1.94', family: 'IPv4' }],
  cliOverrides: { host: null, port: null },
  pendingRestart: false,
  integration: 'managed',
  unavailableReason: null,
})

const mount = (snapshot = initialSnapshot()) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const save = vi.fn(async (input: Parameters<Parameters<typeof NetworkPreferences>[0]['save']>[0]): Promise<NetworkSnapshot> => ({
    ...snapshot,
    revision: input.expectedRevision + 1,
    saved: { lanEnabled: input.lanEnabled, bindAddress: input.bindAddress, localhostEnabled: input.localhostEnabled, port: input.port },
    pendingRestart: true,
  }))
  const view = render(
    <PluginQueryProvider client={client}>
      <NetworkPreferences snapshot={snapshot} t={t} save={save} />
    </PluginQueryProvider>,
  )
  return {
    save,
    refresh: (next: NetworkSnapshot, unavailable = false) =>
      view.rerender(
        <PluginQueryProvider client={client}>
          <NetworkPreferences snapshot={next} t={t} save={save} unavailable={unavailable} />
        </PluginQueryProvider>,
      ),
  }
}

// jsdom has no layout observer; Radix Switch measures its hidden form input with this browser API.
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Network access preferences', () => {
  it('remembers an explicit address and forces localhost on when disabling LAN', async () => {
    const snapshot = initialSnapshot()
    snapshot.saved.bindAddress = '192.168.1.94'
    const { save } = mount(snapshot)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByRole('switch', { name: 'Localhost access' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('switch', { name: 'LAN access' }))
    expect(screen.getByRole('combobox', { name: 'LAN address' }).textContent).toContain('en0 · 192.168.1.94')
    fireEvent.click(screen.getByRole('switch', { name: 'Localhost access' }))
    expect(screen.getByRole('switch', { name: 'Localhost access' }).getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByRole('switch', { name: 'LAN access' }))
    expect(screen.getByRole('switch', { name: 'Localhost access' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({ lanEnabled: false, bindAddress: '192.168.1.94', localhostEnabled: true, port: 0, expectedRevision: 4 }),
    )
  })

  it('requires an explicit interface choice instead of exposing the first available network', async () => {
    const { save } = mount()
    fireEvent.click(screen.getByRole('switch', { name: 'LAN access' }))
    expect(screen.getByRole('combobox', { name: 'LAN address' }).textContent).toContain(networkEnglish.chooseAddress)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByText(networkEnglish.addressRequired)).toBeTruthy())
    expect(save).not.toHaveBeenCalled()
  })

  it('retains a dirty draft and its revision when actual status refreshes', async () => {
    const snapshot = initialSnapshot()
    const { save, refresh } = mount(snapshot)
    fireEvent.change(screen.getByLabelText('Port'), { target: { value: '4321' } })
    refresh({ ...snapshot, revision: 9, saved: { ...snapshot.saved, port: 7777 }, active: { ...snapshot.active, port: 3200, urls: ['http://127.0.0.1:3200'] } })
    expect(screen.getByLabelText<HTMLInputElement>('Port').value).toBe('4321')
    expect(screen.getByText('http://127.0.0.1:3200')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ ...snapshot.saved, port: 4321, expectedRevision: 4 }))
  })

  it('shows an unavailable saved address and never silently chooses an available replacement', async () => {
    const snapshot = initialSnapshot()
    snapshot.saved = { ...snapshot.saved, lanEnabled: true, bindAddress: '192.168.2.20' }
    const { save } = mount(snapshot)
    expect(screen.getByRole('combobox', { name: 'LAN address' }).textContent).toContain('Unavailable saved address · 192.168.2.20')
    fireEvent.click(screen.getByRole('switch', { name: 'LAN access' }))
    fireEvent.click(screen.getByRole('switch', { name: 'LAN access' }))
    expect(screen.getByRole('combobox').textContent).toContain('192.168.2.20')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByText('Choose an available LAN address before saving.')).toBeTruthy())
    expect(save).not.toHaveBeenCalled()
  })

  it('rejects out-of-range port drafts without a Host write', async () => {
    const { save } = mount()
    fireEvent.change(screen.getByLabelText('Port'), { target: { value: '65536' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByText('Enter a whole number from 0 to 65535.')).toBeTruthy())
    expect(save).not.toHaveBeenCalled()
  })

  it('disables writes for unsupported launchers and shows actual status and CLI overrides', () => {
    const snapshot = initialSnapshot()
    mount({ ...snapshot, integration: 'unsupported', pendingRestart: true, cliOverrides: { host: '192.168.1.94', port: 3198 } })
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('switch', { name: 'LAN access' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(networkEnglish.cliOverride)).toBeTruthy()
    expect(screen.getByText(networkEnglish.pendingRestart)).toBeTruthy()
    expect(screen.getByText('http://127.0.0.1:3199')).toBeTruthy()
  })

  it('keeps custom startup configurations read-only until offline wiring is updated', () => {
    mount({ ...initialSnapshot(), integration: 'needs-setup', writable: false })
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(networkEnglish.setup)).toBeTruthy()
  })

  it('advances the form baseline only after a successful save', async () => {
    const { save } = mount()
    fireEvent.change(screen.getByLabelText('Port'), { target: { value: '4321' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByText(networkEnglish.saved)).toBeTruthy())
    expect(screen.getByLabelText<HTMLInputElement>('Port').value).toBe('4321')
    fireEvent.change(screen.getByLabelText('Port'), { target: { value: '4322' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(save).toHaveBeenLastCalledWith({ lanEnabled: false, bindAddress: null, localhostEnabled: true, port: 4322, expectedRevision: 5 }),
    )
  })

  it('keeps a failed save draft and displays the mutation failure', async () => {
    const { save } = mount()
    save.mockRejectedValueOnce(new Error('Network preferences changed; read them again.'))
    fireEvent.change(screen.getByLabelText('Port'), { target: { value: '4321' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByText('Network preferences changed; read them again.')).toBeTruthy())
    expect(screen.getByLabelText<HTMLInputElement>('Port').value).toBe('4321')
    expect(screen.queryByText(networkEnglish.saved)).toBeNull()
  })

  it('shows an unavailable update/restart message without editable controls on an old Host', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <PluginQueryProvider client={client}>
        <NetworkSection t={t} />
      </PluginQueryProvider>,
    )
    await waitFor(() => expect(screen.getByText(networkEnglish.unavailable)).toBeTruthy())
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('disables an existing form if a later Host query becomes unavailable', () => {
    const snapshot = initialSnapshot()
    const { refresh } = mount(snapshot)
    refresh(snapshot, true)
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true)
  })
})
