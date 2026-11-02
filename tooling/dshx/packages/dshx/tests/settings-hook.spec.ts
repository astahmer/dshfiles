import Schema from '@deepseek-ai/schemastery'
import React from 'react'
import type { SettingsContract } from '../src/settings/index.js'
import type { SettingsClientRuntime } from '../src/settings/client.js'
import { createSettingsClientRuntime, useSettings } from '../src/settings/client.js'
import { defineSettings } from '../src/settings/index.js'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as EffectSchema from 'effect/Schema'

type Setter<T> = T | ((previous: T) => T)

let currentClient: SettingsClientRuntime
const hookState: unknown[] = []
const hookRefs: Array<{ current: unknown }> = []
let stateCursor = 0
let refCursor = 0

const fakeReact = {
  useContext: () => currentClient,
  useDebugValue: () => undefined,
  useMemo: <T>(factory: () => T): T => factory(),
  useSyncExternalStore: <T>(_subscribe: unknown, snapshot: () => T): T => snapshot(),
  useEffect: () => undefined,
  useCallback: <T>(callback: T): T => callback,
  useState: <T>(initial: T): [T, (next: Setter<T>) => void] => {
    const index = stateCursor++
    if (!(index in hookState)) hookState[index] = initial
    return [
      hookState[index] as T,
      next => {
        const previous = hookState[index] as T
        hookState[index] = typeof next === 'function' ? (next as (value: T) => T)(previous) : next
      },
    ]
  },
  useRef: <T>(initial: T): { current: T } => {
    const index = refCursor++
    if (!(index in hookRefs)) hookRefs[index] = { current: initial }
    return hookRefs[index] as { current: T }
  },
}

// React 18 keeps the hook dispatcher on its internals; swapping it runs hooks without a renderer.
const reactInternalsShape = EffectSchema.Struct({ ReactCurrentDispatcher: EffectSchema.Struct({ current: EffectSchema.Unknown }) })
if (!('__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED' in React)) throw new Error('React 18 dispatcher internals are unavailable.')
const reactInternals = React['__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED']
if (!EffectSchema.is(reactInternalsShape)(reactInternals)) throw new Error('React 18 dispatcher internals are unavailable.')
const dispatcher = reactInternals.ReactCurrentDispatcher
const originalDispatcher = dispatcher.current
const setDispatcher = (value: unknown): void => {
  if (!Reflect.set(dispatcher, 'current', value)) throw new Error('React 18 dispatcher internals are not writable.')
}

function resetRender(): void {
  stateCursor = 0
  refCursor = 0
}

function render<Contract extends SettingsContract>(contract: Contract): ReturnType<typeof useSettings<Contract['schema'], never>> {
  resetRender()
  return useSettings(contract) as ReturnType<typeof useSettings<Contract['schema'], never>>
}

function clientWith(options: {
  readonly scope: {
    getSnapshot(): Record<string, unknown>
    subscribe(listener: () => void): () => void
    set(field: string, value: unknown): Promise<void>
    unset(field: string): Promise<void>
  }
  readonly mirror: Record<string, unknown>
}): SettingsClientRuntime {
  const configForms = {
    get: () => options.scope,
    describe: () => ({
      getSnapshot: () => options.mirror,
      subscribe: () => () => undefined,
      ensure: () => Promise.resolve(),
    }),
  }
  return createSettingsClientRuntime({ get: name => (name === 'configForms' ? configForms : undefined) })
}

beforeEach(() => {
  setDispatcher(fakeReact)
})

afterAll(() => {
  setDispatcher(originalDispatcher)
})

describe('useSettings', () => {
  it('reads external snapshots and keeps only pending state local without optimistic values', async () => {
    hookState.length = 0
    hookRefs.length = 0
    const contract = defineSettings({ namespace: 'runtime-hook', schema: Schema.object({ enabled: Schema.boolean().default(true) }) })
    let resolveWrite: (() => void) | undefined
    const set = vi.fn(
      () =>
        new Promise<void>(resolve => {
          resolveWrite = resolve
        }),
    )
    const scope = {
      getSnapshot: () => ({ status: 'ready', value: { enabled: true }, base: { enabled: true }, user: {}, revision: 2, writable: true, mode: 'host' }),
      subscribe: () => () => undefined,
      set,
      unset: vi.fn(() => Promise.resolve()),
    }
    currentClient = clientWith({
      scope,
      mirror: {
        status: 'ready',
        view: { namespaces: [{ ns: 'runtime-hook', applies: 'live', secrets: [], revision: 2 }], writable: true },
        error: null,
      },
    })

    const initial = render(contract)
    expect(initial.value).toEqual({ enabled: true })
    expect(initial.error).toBeNull()
    const write = initial.set('enabled', false)
    expect(render(contract).mutation.pending).toBe(true)
    expect(render(contract).value).toEqual({ enabled: true })
    resolveWrite?.()
    await write
    expect(render(contract).mutation).toEqual({ pending: false })

    const failure = new Error('write failed')
    set.mockRejectedValueOnce(failure)
    await expect(render(contract).set('enabled', false)).rejects.toBe(failure)
    expect(render(contract).mutation).toEqual({ pending: false })
  })

  it('distinguishes unregistered namespaces and refuses their writes', async () => {
    hookState.length = 0
    hookRefs.length = 0
    const contract = defineSettings({ namespace: 'missing-hook', schema: Schema.object({ enabled: Schema.boolean() }) })
    const set = vi.fn(() => Promise.resolve())
    currentClient = clientWith({
      scope: {
        getSnapshot: () => ({ status: 'loading', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'host' }),
        subscribe: () => () => undefined,
        set,
        unset: vi.fn(() => Promise.resolve()),
      },
      mirror: { status: 'ready', view: { namespaces: [], writable: true }, error: null },
    })
    const state = render(contract)
    expect(state.status).toBe('unavailable')
    expect(state.writable).toBe(false)
    expect(state.error?.kind).toBe('namespace-unregistered')
    await expect(state.set('enabled', true)).rejects.toThrow('not registered')
    expect(set).not.toHaveBeenCalled()
  })

  it('distinguishes missing providers, decode failures, and mirror sync failures', () => {
    const contract = defineSettings({ namespace: 'error-hook', schema: Schema.object({ enabled: Schema.boolean() }) })
    hookState.length = 0
    hookRefs.length = 0
    currentClient = createSettingsClientRuntime({ get: () => undefined })
    expect(render(contract)).toMatchObject({ status: 'unavailable', writable: false, error: { kind: 'provider-unavailable' } })

    currentClient = clientWith({
      scope: {
        getSnapshot: () => ({ status: 'loading', value: undefined, base: undefined, user: undefined, revision: 4, writable: true, mode: 'host' }),
        subscribe: () => () => undefined,
        set: vi.fn(() => Promise.resolve()),
        unset: vi.fn(() => Promise.resolve()),
      },
      mirror: {
        status: 'ready',
        view: { namespaces: [{ ns: 'error-hook', applies: 'live', secrets: [], revision: 4 }], writable: true },
        error: null,
      },
    })
    expect(render(contract)).toMatchObject({ status: 'unavailable', error: { kind: 'decode-failed' } })

    currentClient = clientWith({
      scope: {
        getSnapshot: () => ({ status: 'ready', value: { enabled: true }, base: {}, user: {}, revision: 4, writable: true, mode: 'host' }),
        subscribe: () => () => undefined,
        set: vi.fn(() => Promise.resolve()),
        unset: vi.fn(() => Promise.resolve()),
      },
      mirror: { status: 'ready', view: { namespaces: [], writable: true }, error: 'refresh failed' },
    })
    expect(render(contract).error?.kind).toBe('sync-failed')
  })
})
