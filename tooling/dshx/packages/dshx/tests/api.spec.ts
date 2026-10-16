import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { z } from 'zod'
import { createApiClientRuntime, startApiQueryEffect } from '../src/api/client.js'
import { defineApi, method } from '../src/api/define.js'
import * as publicApi from '../src/api/index.js'
import { ApiClientRuntimeModel, apiChannel } from '../src/api/runtime.js'
import { registerApi } from '../src/api/host-runtime.js'

function schema<Input, Output>(validate: (value: unknown) => StandardSchemaV1.Result<Output>): StandardSchemaV1<Input, Output> {
  return { '~standard': { version: 1, vendor: 'dshx-test', validate } }
}

const api = defineApi({
  id: 'status',
  version: 1,
  methods: {
    get: method<void, { value: string }>(),
    refresh: method<{ force?: boolean }, { value: string }>(),
  },
})

const routeResponseSchema = z.object({
  result: z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value: z.unknown() }),
    z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string(), details: z.looseObject({}) }) }),
  ]),
})

function connectionFixture() {
  const routes = new Map<string, ConnectionFetchRoute>()
  const removers: Array<() => Promise<void>> = []
  const remove = vi.fn(async (path: string) => {
    routes.delete(path)
  })
  const call = vi.fn(async (channel: string, endpoint: string, payload: unknown, signal?: AbortSignal) => {
    const path = `${channel}/${endpoint}`
    const route = routes.get(path)
    if (route === undefined) return { ok: false as const, error: { code: 'not-found', message: 'Route not found.', details: {} } }
    const request = new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'test-rpc', method: endpoint, payload }),
      ...(signal === undefined ? {} : { signal }),
    })
    const response = await route.fetch(request)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return routeResponseSchema.parse(await response.json()).result
  })
  const context = {
    get(name: string) {
      return name === 'connection'
        ? {
            operator: {},
            fetch: {
              register(route: ConnectionFetchRoute) {
                if (routes.has(route.path)) throw new Error(`Route already registered: ${route.path}`)
                routes.set(route.path, route)
                const dispose = async (): Promise<void> => {
                  await remove(route.path)
                }
                return dispose
              },
            },
            rpc: { call },
          }
        : undefined
    },
    effect(setup: () => () => Promise<void>) {
      removers.push(setup())
    },
  }
  Object.assign(context, { root: context })
  return { context, routes, removers, remove, call }
}

describe('generic API runtime', () => {
  it('does not expose transport construction helpers', () => {
    expect(publicApi).not.toHaveProperty('createApiClient')
    expect(publicApi).not.toHaveProperty('registerApi')
    expect(publicApi).not.toHaveProperty('apiChannel')
  })
  it('creates a stable single-segment channel', () => {
    expect(apiChannel('@scope/plugin', 'status')).toMatch(/^\/dshx-[0-9a-f]+$/)
    expect(apiChannel('@scope/plugin', 'status')).toBe(apiChannel('@scope/plugin', 'status'))
    expect(apiChannel('@scope/plugin', 'status')).not.toBe(apiChannel('@scope/plugin', 'other'))
  })

  it('registers handlers through the official Connection shape', async () => {
    const fixture = connectionFixture()
    const registration = api.host({
      async get() {
        return { value: 'ready' }
      },
      async refresh({ input }) {
        return { value: input.force === true ? 'forced' : 'normal' }
      },
    })
    await registerApi(fixture.context as never, '@scope/plugin', registration)
    const statusChannel = apiChannel('@scope/plugin', 'status')
    expect([...fixture.routes.keys()].filter(path => path.startsWith(`/api${statusChannel}/`))).toHaveLength(2)
    const endpoint = `${apiChannel('@scope/plugin', 'status').slice(1)}/get`
    await expect(fixture.call('/api', endpoint, { version: 1, input: undefined })).resolves.toEqual({
      ok: true,
      value: { version: 1, output: { value: 'ready' } },
    })
    await expect(fixture.call('/api', endpoint, { version: 2, input: undefined })).resolves.toMatchObject({
      ok: false,
      error: { code: 'DSHX6401' },
    })
  })

  it('releases channel ownership with the Host fiber lifecycle', async () => {
    const fixture = connectionFixture()
    const registration = api.host({
      async get() {
        return { value: 'ready' }
      },
      async refresh() {
        return { value: 'ready' }
      },
    })
    // These package ids are a deterministic FNV-1a collision for the status API.
    const first = 'pkg-ppsie4'
    const second = 'pkg-1m7n0mo'
    expect(apiChannel(first, 'status')).toBe(apiChannel(second, 'status'))
    await registerApi(fixture.context as never, first, registration)
    await expect(registerApi(fixture.context as never, second, registration)).rejects.toThrow('API channel collision')
    await fixture.removers[0]?.()
    await expect(registerApi(fixture.context as never, second, registration)).resolves.toBeUndefined()
    expect(fixture.remove).toHaveBeenCalledTimes(2)
  })

  it('routes a Client of another package to the Host that owns the contract', async () => {
    const fixture = connectionFixture()
    const owned = defineApi({ id: 'status', version: 1, owner: '@scope/owner', methods: { get: method<void, { value: string }>() } })
    await registerApi(fixture.context as never, '@scope/owner', owned.host({ get: async () => ({ value: 'from owner' }) }))
    await expect(ApiClientRuntimeModel.create(fixture.context, owned, '@scope/caller').get()).resolves.toEqual({ value: 'from owner' })
    await expect(registerApi(fixture.context as never, '@scope/caller', owned.host({ get: async () => ({ value: 'impostor' }) }))).rejects.toThrow(
      'owned by @scope/owner',
    )
  })

  it('provides typed calls and safe errors over Connection.call', async () => {
    const call = vi.fn(
      async (
        _channel: string,
        endpoint: string,
      ): Promise<
        { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
      > => ({
        ok: true,
        value: { version: 1, output: { value: endpoint.split('/').at(-1) } },
      }),
    )
    const client = ApiClientRuntimeModel.create(
      {
        get(name: string) {
          return name === 'connection' ? { rpc: { call } } : undefined
        },
      } as never,
      api,
      '@scope/plugin',
    )
    await expect(client.get()).resolves.toEqual({ value: 'get' })
    await expect(client.refresh({ force: true })).resolves.toEqual({ value: 'refresh' })
    expect(call).toHaveBeenCalledWith('/api', `${apiChannel('@scope/plugin', 'status').slice(1)}/get`, { version: 1, input: undefined }, undefined)

    call.mockResolvedValueOnce({ ok: false, error: { code: 'internal', message: 'boom' } })
    const result = await client.safe.get()
    expect(result).toMatchObject({ ok: false, error: { kind: 'remote', remoteCode: 'internal' } })
  })

  it('lazily reuses API clients by contract identity within one Client Fiber runtime', () => {
    const get = vi.fn(() => ({ rpc: { call: vi.fn() } }))
    const firstRuntime = createApiClientRuntime({ get }, '@scope/plugin')
    const sameShape = defineApi({
      id: 'status-copy',
      version: 1,
      methods: {
        get: method<void, { value: string }>(),
        refresh: method<{ force?: boolean }, { value: string }>(),
      },
    })

    const first = firstRuntime.client(api)
    expect(firstRuntime.client(api)).toBe(first)
    expect(firstRuntime.client(sameShape)).not.toBe(first)
    expect(get).toHaveBeenCalledTimes(2)

    const nextRuntime = createApiClientRuntime({ get }, '@scope/plugin')
    expect(nextRuntime.client(api)).not.toBe(first)
    expect(get).toHaveBeenCalledTimes(3)
  })

  it('does not eagerly bind contracts before useApi requests one', () => {
    const get = vi.fn(() => ({ rpc: { call: vi.fn() } }))
    const client = createApiClientRuntime({ get }, '@scope/plugin')
    expect(get).not.toHaveBeenCalled()
    expect(client.client(api)).toBe(client.client(api))
    expect(get).toHaveBeenCalledOnce()
  })

  it('uses an unambiguous AbortSignal position for no-input methods', async () => {
    const call = vi.fn(async (): Promise<{ readonly ok: true; readonly value: unknown }> => ({
      ok: true,
      value: { version: 1, output: { value: 'ready' } },
    }))
    const client = ApiClientRuntimeModel.create(
      {
        get(name: string) {
          return name === 'connection' ? { rpc: { call } } : undefined
        },
      } as never,
      api,
      '@scope/plugin',
    )
    const controller = new AbortController()
    controller.abort('cancelled before dispatch')
    await expect(client.get(undefined, { signal: controller.signal })).rejects.toMatchObject({ kind: 'aborted', retryable: false })
    expect(call).not.toHaveBeenCalled()
  })

  it('sends a PluginApiError message to the Client and keeps other failures generic but logged', async () => {
    const fixture = connectionFixture()
    const logged = vi.fn()
    const context = { ...fixture.context, logger: (name: string) => (name === 'dshx:api' ? { error: logged } : undefined) }
    const contract = defineApi({
      id: 'failing',
      version: 1,
      methods: { prepare: method<{ readonly secret: string }, string>(), confirm: method<void, string>(), reserved: method<void, string>() },
    })
    await registerApi(
      context as never,
      '@scope/plugin',
      contract.host({
        prepare() {
          throw new Error('jj exited 1 with token=abc123secret')
        },
        confirm() {
          throw new publicApi.PluginApiError('The working copy changed; review it again.', { code: 'stale-review' })
        },
        reserved() {
          throw new publicApi.PluginApiError('Refused.', { code: 'internal' })
        },
      }),
    )
    const client = ApiClientRuntimeModel.create(context as never, contract, '@scope/plugin')
    await expect(client.prepare({ secret: 'input-value' })).rejects.toMatchObject({
      kind: 'remote',
      remoteCode: 'internal',
      message: 'API handler failed. See Host diagnostics.',
    })
    expect(logged).toHaveBeenCalledOnce()
    const line = String(logged.mock.calls[0]?.[0])
    expect(line).toContain('API handler @scope/plugin failing.prepare failed: Error: jj exited 1 with token=[redacted]')
    expect(line).not.toContain('abc123secret')
    expect(line).not.toContain('input-value')

    await expect(client.confirm()).rejects.toMatchObject({ kind: 'remote', remoteCode: 'stale-review', message: 'The working copy changed; review it again.' })
    await expect(client.reserved()).rejects.toMatchObject({ kind: 'remote', remoteCode: 'plugin', message: 'Refused.' })
    expect(logged).toHaveBeenCalledOnce()
  })

  it('maps Host and Client API version mismatches to contract errors', async () => {
    const fixture = connectionFixture()
    const host = defineApi({ id: 'versioned', version: 1, methods: { get: method<void, string>() } })
    const clientContract = defineApi({ id: 'versioned', version: 2, methods: { get: method<void, string>() } })
    await registerApi(
      fixture.context as never,
      '@scope/plugin',
      host.host({
        async get() {
          return 'ready'
        },
      }),
    )
    const client = ApiClientRuntimeModel.create(fixture.context as never, clientContract, '@scope/plugin')
    await expect(client.get()).rejects.toMatchObject({ kind: 'contract', remoteCode: 'DSHX6401', retryable: false })
  })

  it('returns Standard Schema transformed output from the Host boundary', async () => {
    const fixture = connectionFixture()
    const validateOutput = vi.fn((value: unknown) => ({ value: String(value).toUpperCase() }))
    const transformed = defineApi({
      id: 'transformed',
      version: 1,
      methods: {
        get: method({ output: schema<string, string>(validateOutput) }),
      },
    })
    await registerApi(
      fixture.context as never,
      '@scope/plugin',
      transformed.host({
        async get() {
          return 'ready'
        },
      }),
    )
    const endpoint = `${apiChannel('@scope/plugin', 'transformed').slice(1)}/get`
    await expect(fixture.call('/api', endpoint, { version: 1, input: undefined })).resolves.toMatchObject({
      ok: true,
      value: { output: 'READY' },
    })
    expect(validateOutput).toHaveBeenCalledOnce()
  })

  it('checks the JSON boundary before transforming Client input into a Host-only value', async () => {
    const fixture = connectionFixture()
    const transformed = defineApi({
      id: 'host-input-transform',
      version: 1,
      methods: {
        parse: method({
          input: schema<{ raw: string }, { parsed: bigint }>(value => ({
            value: { parsed: BigInt((value as { raw: string }).raw) },
          })),
        }),
      },
    })
    const implementation = vi.fn(({ input }: { input: { parsed: bigint } }) => input.parsed.toString())
    await registerApi(fixture.context as never, '@scope/plugin', transformed.host({ parse: implementation }))

    const endpoint = `${apiChannel('@scope/plugin', 'host-input-transform').slice(1)}/parse`
    await expect(fixture.call('/api', endpoint, { version: 1, input: { raw: '9007199254740993' } })).resolves.toMatchObject({
      ok: true,
      value: { output: '9007199254740993' },
    })
    expect(implementation).toHaveBeenCalledWith(expect.objectContaining({ input: { parsed: 9007199254740993n } }))
  })

  it('maps JSON-safe and schema failures to contract errors', async () => {
    const fixture = connectionFixture()
    const validateInput = vi.fn(() => ({ issues: [{ message: 'nope' }] }))
    const contract = defineApi({
      id: 'validated',
      version: 1,
      methods: {
        get: method({ input: schema<{ readonly accepted?: boolean }, { readonly accepted: boolean }>(validateInput) }),
      },
    })
    await registerApi(fixture.context as never, '@scope/plugin', contract.host({ get: () => ({ value: 'ready' }) }))
    const client = ApiClientRuntimeModel.create(fixture.context as never, contract, '@scope/plugin')
    await expect(client.get({})).rejects.toMatchObject({ kind: 'contract', retryable: false })
    expect(validateInput).toHaveBeenCalledOnce()
  })

  it('exposes the official Host description lifecycle to query adapters', () => {
    let connected = false
    const listeners = new Set<() => void>()
    const client = ApiClientRuntimeModel.create(
      {
        get(name: string) {
          return name === 'connection'
            ? {
                hostDescription: {
                  getSnapshot: () => (connected ? { profile: 'web' } : undefined),
                  subscribe(listener: () => void) {
                    listeners.add(listener)
                    return () => listeners.delete(listener)
                  },
                },
                rpc: { call: vi.fn() },
              }
            : undefined
        },
      } as never,
      api,
      '@scope/plugin',
    )
    const listener = vi.fn()
    const dispose = ApiClientRuntimeModel.subscribeConnection(client, listener)
    expect(ApiClientRuntimeModel.connectionAvailable(client)).toBe(false)
    connected = true
    for (const callback of listeners) callback()
    expect(listener).toHaveBeenCalledOnce()
    expect(ApiClientRuntimeModel.connectionAvailable(client)).toBe(true)
    dispose()
    expect(listeners).toHaveLength(0)
  })

  it('waits for a Host generation before asking React to retry a query', () => {
    let connected = false
    const listeners = new Set<() => void>()
    const invoke = vi.fn(async () => 'ready')
    const onReconnect = vi.fn()
    const dispose = startApiQueryEffect({
      available: () => connected,
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      invoke,
      onPending: vi.fn(),
      onSuccess: vi.fn(),
      onError: vi.fn(),
      onReconnect,
    })
    expect(invoke).not.toHaveBeenCalled()
    connected = true
    for (const listener of listeners) listener()
    for (const listener of listeners) listener()
    expect(onReconnect).toHaveBeenCalledOnce()
    dispose()
    expect(listeners).toHaveLength(0)
  })

  it('aborts an in-flight query on connection loss and retries on the next generation', async () => {
    let connected = true
    const listeners = new Set<() => void>()
    let requestSignal: AbortSignal | undefined
    const onPending = vi.fn()
    const onError = vi.fn()
    const onReconnect = vi.fn()
    const dispose = startApiQueryEffect({
      available: () => connected,
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      invoke(signal) {
        requestSignal = signal
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
      },
      onPending,
      onSuccess: vi.fn(),
      onError,
      onReconnect,
    })
    expect(requestSignal?.aborted).toBe(false)
    connected = false
    for (const listener of listeners) listener()
    await Promise.resolve()
    expect(requestSignal?.aborted).toBe(true)
    expect(onPending).toHaveBeenCalledTimes(2)
    expect(onError).not.toHaveBeenCalled()
    connected = true
    for (const listener of listeners) listener()
    expect(onReconnect).toHaveBeenCalledOnce()
    dispose()
  })

  it('infers all four Standard Schema stages and checks exact handlers', () => {
    const input = schema<{ raw: string }, { parsed: number }>(value => ({ value: { parsed: Number((value as { raw: string }).raw) } }))
    const output = schema<{ count: number }, { text: string }>(value => ({ value: { text: String((value as { count: number }).count) } }))
    const contract = defineApi({ id: 'four-stage', version: 1, methods: { convert: method({ input, output }) } })
    contract.host({
      convert({ input: hostInput }) {
        expectTypeOf(hostInput).toEqualTypeOf<{ parsed: number }>()
        return { count: hostInput.parsed }
      },
    })
    const client = ApiClientRuntimeModel.create(undefined, contract)
    expectTypeOf(client.convert).parameter(0).toEqualTypeOf<{ raw: string }>()
    expectTypeOf(client.convert).returns.resolves.toEqualTypeOf<{ text: string }>()
    expect(() => contract.host({ convert: () => ({ count: 1 }), extra: () => 1 } as never)).toThrow('unexpected')
  })
})
