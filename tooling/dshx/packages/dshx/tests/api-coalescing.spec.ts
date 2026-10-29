import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { defineApi, method } from '../src/api/index.js'
import { ApiRuntimeModel } from '../src/api/runtime.js'

const boardApi = defineApi({
  id: 'board',
  version: 1,
  methods: {
    list: method<{ readonly scope: string; readonly limit?: number }, { readonly rows: string[] }>(),
    status: method({ description: 'Read-only through its agent tool.', tool: { name: 'board_status', readOnly: true } }),
    kill: method<{ readonly id: string }, { readonly killed: boolean }>(),
  },
})

const readOnlyBoardApi = defineApi({
  id: 'board',
  version: 1,
  methods: {
    list: method({ input: z.object({ scope: z.string(), limit: z.number().optional() }), readOnly: true }),
    kill: method(),
  },
})

interface PendingCall {
  readonly endpoint: string
  readonly payload: unknown
  readonly signal: AbortSignal | undefined
  readonly resolve: (output: unknown) => void
}

const deferredConnection = () => {
  const pending: PendingCall[] = []
  const call = vi.fn(
    (_channel: string, endpoint: string, payload: unknown, signal?: AbortSignal) =>
      new Promise((resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        pending.push({ endpoint, payload, signal, resolve: output => resolve({ ok: true, value: { version: 1, output } }) })
      }),
  )
  const rpc = { call }
  return { pending, call, context: { get: (name: string) => (name === 'connection' ? { rpc } : undefined) } }
}

describe('API call coalescing', () => {
  it('shares one request between identical read-only calls and gives each caller its own copy', async () => {
    const connection = deferredConnection()
    const first = ApiRuntimeModel.createClient(connection.context, readOnlyBoardApi, '@acme/board')
    const second = ApiRuntimeModel.createClient(connection.context, readOnlyBoardApi, '@acme/board')
    const left = first.list({ scope: 'running', limit: 5 })
    const right = second.list({ limit: 5, scope: 'running' })
    await Promise.resolve()
    expect(connection.call).toHaveBeenCalledTimes(1)
    connection.pending[0]?.resolve({ rows: ['a'] })
    const [leftValue, rightValue] = await Promise.all([left, right])
    expect(leftValue).toEqual({ rows: ['a'] })
    expect(rightValue).toEqual({ rows: ['a'] })
    expect(leftValue).not.toBe(rightValue)
  })

  it('treats a method whose agent tool is read-only as read-only', async () => {
    const connection = deferredConnection()
    const client = ApiRuntimeModel.createClient(connection.context, boardApi, '@acme/board')
    const calls = [client.status(), client.status()]
    await Promise.resolve()
    expect(connection.call).toHaveBeenCalledTimes(1)
    connection.pending[0]?.resolve('ok')
    expect(await Promise.all(calls)).toEqual(['ok', 'ok'])
  })

  it('never shares a request for a method that is not declared read-only', async () => {
    const connection = deferredConnection()
    const client = ApiRuntimeModel.createClient(connection.context, boardApi, '@acme/board')
    const reads = [client.list({ scope: 'running' }), client.list({ scope: 'running' })]
    const kills = [client.kill({ id: 'job-1' }), client.kill({ id: 'job-1' })]
    await Promise.resolve()
    expect(connection.call).toHaveBeenCalledTimes(4)
    for (const call of connection.pending) call.resolve({ rows: [], killed: true })
    await Promise.all([...reads, ...kills])
  })

  it('starts a separate request for a different input', async () => {
    const connection = deferredConnection()
    const client = ApiRuntimeModel.createClient(connection.context, readOnlyBoardApi, '@acme/board')
    void client.list({ scope: 'running' })
    void client.list({ scope: 'all' })
    await Promise.resolve()
    expect(connection.pending.map(call => call.payload)).toEqual([
      { version: 1, input: { scope: 'running' } },
      { version: 1, input: { scope: 'all' } },
    ])
    for (const call of connection.pending) call.resolve({ rows: [] })
  })

  it('keeps the shared request alive while another caller still waits for it', async () => {
    const connection = deferredConnection()
    const client = ApiRuntimeModel.createClient(connection.context, readOnlyBoardApi, '@acme/board')
    const controller = new AbortController()
    const abandoned = client.list({ scope: 'running' }, { signal: controller.signal })
    const kept = client.list({ scope: 'running' })
    await Promise.resolve()
    controller.abort()
    await expect(abandoned).rejects.toMatchObject({ kind: 'aborted' })
    expect(connection.pending[0]?.signal?.aborted).toBe(false)
    connection.pending[0]?.resolve({ rows: ['b'] })
    expect(await kept).toEqual({ rows: ['b'] })
  })

  it('aborts the shared request once every caller left, and the next call starts fresh', async () => {
    const connection = deferredConnection()
    const client = ApiRuntimeModel.createClient(connection.context, readOnlyBoardApi, '@acme/board')
    const controllers = [new AbortController(), new AbortController()]
    const calls = controllers.map(controller => client.list({ scope: 'running' }, { signal: controller.signal }))
    await Promise.resolve()
    for (const controller of controllers) controller.abort()
    await expect(Promise.all(calls)).rejects.toMatchObject({ kind: 'aborted' })
    expect(connection.pending[0]?.signal?.aborted).toBe(true)
    const next = client.list({ scope: 'running' })
    await Promise.resolve()
    expect(connection.call).toHaveBeenCalledTimes(2)
    connection.pending[1]?.resolve({ rows: [] })
    expect(await next).toEqual({ rows: [] })
  })

  it('starts a new request after the shared one settled', async () => {
    const connection = deferredConnection()
    const client = ApiRuntimeModel.createClient(connection.context, readOnlyBoardApi, '@acme/board')
    const first = client.list({ scope: 'running' })
    await Promise.resolve()
    connection.pending[0]?.resolve({ rows: ['old'] })
    await first
    const second = client.list({ scope: 'running' })
    await Promise.resolve()
    expect(connection.call).toHaveBeenCalledTimes(2)
    connection.pending[1]?.resolve({ rows: ['new'] })
    expect(await second).toEqual({ rows: ['new'] })
  })
})
