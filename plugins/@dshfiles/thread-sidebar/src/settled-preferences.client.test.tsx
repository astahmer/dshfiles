// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFERENCES, type SidebarPreferences } from './organization.js'
import type { SettledChange } from './settled-api.js'
import type { SettledStatus } from './settled-threads.js'

/** A Host failure as the stubbed classifiers read it. */
interface StubError {
  readonly kind: string
  readonly remoteCode?: string
}

interface StubRead {
  status: string
  data: (SettledStatus & { readonly revision: number }) | undefined
  error: StubError | undefined
  updatedAt: number
  fetching: boolean
}

interface StubHost {
  settingsValue: Partial<SidebarPreferences>
  read: StubRead
}

/** The Host as the hooks see it: one settings namespace, the settled store's read and its write. */
const host = vi.hoisted(() => {
  const state: StubHost = { settingsValue: {}, read: { status: 'success', data: undefined, error: undefined, updatedAt: 1, fetching: false } }
  return {
    state,
    setMany: vi.fn(async (_patch: Partial<SidebarPreferences>) => true),
    changeSettled: vi.fn(async (_change: SettledChange): Promise<(SettledStatus & { readonly revision: number }) | undefined> => undefined),
    mutate: vi.fn(),
  }
})
/** `useApi` hands out one client per contract, as dshx caches it; `useResource` a new read object each render. */
const settledApi = { change: (change: SettledChange) => host.changeSettled(change) }

vi.mock('@dshfiles/dshx/api', async importOriginal => {
  const original = await importOriginal<typeof import('@dshfiles/dshx/api')>()
  const apiError = (value: StubError | null | undefined): value is StubError => typeof value === 'object' && value !== null && 'kind' in value
  return {
    ...original,
    isApiError: apiError,
    isApiOwnerMissing: (value: StubError | null | undefined) => apiError(value) && value.kind === 'unavailable' && value.remoteCode === 'owner-missing',
  }
})

vi.mock('@dshfiles/dshx/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@dshfiles/dshx/client')>()),
  useSettings: () => ({ status: 'ready', writable: true, value: host.state.settingsValue, setMany: host.setMany }),
  useApi: () => settledApi,
  useResource: () => ({ ...host.state.read, refetch: () => undefined }),
  apiResource: () => 'settled-key',
  resourceStore: () => ({ mutate: host.mutate }),
}))

const { SidebarStateProvider, usePreferences, useSidebarState } = await import('./sidebar-state.js')

const STATUS: SettledStatus = { settledSessionIds: ['session-b', 'session-a'], settledAt: { 'session-b': 2_000, 'session-a': 1_000 } }
const settingsWith = (settled: SettledStatus) => ({ ...DEFAULT_PREFERENCES, ...settled, parkedSessionIds: ['session-p'] })
const storeAnswers = (status: SettledStatus, revision = 7) => {
  host.state.read = { status: 'success', data: { ...status, revision }, error: undefined, updatedAt: 1, fetching: false }
}
const olderHost = () => {
  host.state.read = { status: 'error', data: undefined, error: { kind: 'remote', remoteCode: 'bad-request' }, updatedAt: 0, fetching: false }
}
const settledOf = (preferences: { readonly settledSessionIds: readonly string[]; readonly settledAt: Readonly<Record<string, number>> }) => ({
  settledSessionIds: [...preferences.settledSessionIds],
  settledAt: { ...preferences.settledAt },
})

describe('settled status in the sidebar preferences', () => {
  beforeEach(() => {
    host.setMany.mockClear()
    host.changeSettled.mockReset()
    host.mutate.mockClear()
  })
  afterEach(cleanup)

  it('gives the thread list, the settled dock and the header the same settled set the settings fields gave them', () => {
    // Before: an older Host keeps the status in Settings.
    host.state.settingsValue = settingsWith(STATUS)
    olderHost()
    const before = renderHook(() => usePreferences()).result.current.preferences
    // After: the Host store holds it and the settings fields are empty.
    host.state.settingsValue = settingsWith({ settledSessionIds: [], settledAt: {} })
    storeAnswers(STATUS)
    // The dock and the header read usePreferences; the thread list reads the provider's useSidebarState.
    const dockAndHeader = renderHook(() => usePreferences()).result.current.preferences
    const list = renderHook(() => useSidebarState(), { wrapper: ({ children }: { children: ReactNode }) => <SidebarStateProvider>{children}</SidebarStateProvider> })
      .result.current.preferences
    expect(settledOf(before)).toEqual(STATUS)
    expect(settledOf(dockAndHeader)).toEqual(settledOf(before))
    expect(settledOf(list)).toEqual(settledOf(before))
    expect(dockAndHeader.parkedSessionIds).toEqual(['session-p'])
  })

  it('writes a mixed patch in one call: the settled change to the store, the rest to Settings', async () => {
    host.state.settingsValue = settingsWith({ settledSessionIds: [], settledAt: {} })
    storeAnswers(STATUS)
    const next: SettledStatus = { settledSessionIds: ['session-b', 'session-a', 'session-p'], settledAt: { ...STATUS.settledAt, 'session-p': 5_000 } }
    host.changeSettled.mockResolvedValue({ ...next, revision: 8 })
    const { result } = renderHook(() => usePreferences())
    await act(async () => {
      result.current.updatePreferences({ ...next, parkedSessionIds: [] })
    })
    expect(host.changeSettled).toHaveBeenCalledWith({ settle: { 'session-p': 5_000 }, unsettle: [] })
    expect(host.mutate).toHaveBeenCalledWith('settled-key', expect.any(Function))
    expect(host.setMany).toHaveBeenCalledTimes(1)
    expect(host.setMany.mock.calls[0]?.[0]).toEqual({ parkedSessionIds: [] })
  })

  it('shows a settle at once and drops it when the Host refuses, with the storage warning', async () => {
    host.state.settingsValue = settingsWith({ settledSessionIds: [], settledAt: {} })
    storeAnswers(STATUS)
    let refuse: (error: unknown) => void = () => undefined
    host.changeSettled.mockReturnValue(new Promise((_resolve, reject) => (refuse = reject)))
    const { result } = renderHook(() => usePreferences())
    act(() => {
      result.current.updatePreferences({ settledSessionIds: ['session-b'], settledAt: { 'session-b': 2_000 } })
    })
    expect(result.current.preferences.settledSessionIds).toEqual(['session-b'])
    expect(host.changeSettled).toHaveBeenCalledWith({ settle: {}, unsettle: ['session-a'] })
    await act(async () => {
      refuse({ kind: 'remote', remoteCode: 'settings-write-failed' })
    })
    expect(settledOf(result.current.preferences)).toEqual(STATUS)
    expect(result.current.storageWarning).toBe(true)
    expect(host.setMany).not.toHaveBeenCalled()
  })

  it('reads and writes the settings fields on an older Host without the store', async () => {
    host.state.settingsValue = settingsWith(STATUS)
    olderHost()
    const { result } = renderHook(() => usePreferences())
    expect(settledOf(result.current.preferences)).toEqual(STATUS)
    await act(async () => {
      result.current.updatePreferences({ settledSessionIds: ['session-b'], settledAt: { 'session-b': 2_000 } })
    })
    expect(host.changeSettled).not.toHaveBeenCalled()
    expect(host.setMany.mock.calls.at(-1)?.[0]).toEqual({ settledSessionIds: ['session-b'], settledAt: { 'session-b': 2_000 } })
  })
})

// Performance P1 (round 34): the settled store pair was a new object on every render, so `updatePreferences` was too,
// and the sidebar re-added every command palette row (a dependency of their memo) on each thread switch.
describe('updatePreferences keeps its identity (performance P1)', () => {
  afterEach(cleanup)
  it('is the same function after a re-render with unchanged data', () => {
    host.state.settingsValue = settingsWith(STATUS)
    storeAnswers(STATUS)
    const { result, rerender } = renderHook(() => usePreferences())
    const first = result.current.updatePreferences
    rerender()
    rerender()
    expect(result.current.updatePreferences).toBe(first)
  })
})
