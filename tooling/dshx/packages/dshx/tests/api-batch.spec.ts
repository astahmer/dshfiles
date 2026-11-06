import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import * as Schema from 'effect/Schema'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineApi, method } from '../src/api/index.js'
import { ApiBatchModel, type BatchCall, type BatchRpcResult } from '../src/api/client-batch.js'
import { ApiChannelModel } from '../src/api/channel.js'
import { registerApi } from '../src/api/host-runtime.js'
import { ApiRuntimeModel } from '../src/api/runtime.js'
import { recordSpans } from '../src/tracing/index.js'

/** What the fake Host writes: a real answer line, or a malformed one the client must skip. */
type HostLine =
  | { readonly id: number | undefined; readonly result: BatchRpcResult }
  | { readonly id: number | undefined; readonly status: number }
  | { readonly nonsense: true }

interface SentBatch {
  readonly entries: ReadonlyArray<{ readonly id: number; readonly endpoint: string; readonly payload: unknown }>
  readonly signal: AbortSignal
  readonly write: (line: HostLine) => void
  readonly end: () => void
}

const lineSchema = Schema.Struct({
  entries: Schema.Array(Schema.Struct({ id: Schema.Number, endpoint: Schema.String, payload: Schema.Unknown })),
})

/** A fake Host batch route the test answers line by line. */
const streamingHost = () => {
  const batches: SentBatch[] = []
  const fetch = vi.fn(async (_input: string, init: RequestInit) => {
    const body = Schema.decodeUnknownSync(Schema.fromJsonString(lineSchema))(String(init.body))
    const encoder = new TextEncoder()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({ start: opened => void (controller = opened) })
    const signal = init.signal ?? new AbortController().signal
    signal.addEventListener('abort', () => controller.error(signal.reason), { once: true })
    batches.push({
      entries: body.entries,
      signal,
      write: line => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`)),
      end: () => controller.close(),
    })
    return new Response(stream, { headers: { 'content-type': 'application/x-ndjson' } })
  })
  return { batches, fetch }
}

const ok = (value: Extract<BatchRpcResult, { readonly ok: true }>['value']): BatchRpcResult => ({ ok: true, value })

const batchCall = (endpoint: string, overrides: Partial<BatchCall> = {}): BatchCall & { readonly send: ReturnType<typeof vi.fn> } => {
  const send = vi.fn(async () => ok(`alone ${endpoint}`))
  // SAFETY: `send` is the vi.fn built above unless an override replaces it with another mock.
  return { endpoint, payload: { version: 1, input: endpoint }, signal: undefined, send, ...overrides } as BatchCall & {
    readonly send: ReturnType<typeof vi.fn>
  }
}

describe('API read batcher', () => {
  it('sends the calls of one window as one POST and settles each from its own line, in the order the Host answers', async () => {
    const host = streamingHost()
    const batcher = ApiBatchModel.create({ fetch: host.fetch, windowMs: 5 })
    const slow = batchCall('dshx-a/slow')
    const fast = batchCall('dshx-a/fast')
    const slowResult = batcher.call(slow)
    const fastResult = batcher.call(fast)
    await vi.waitFor(() => expect(host.batches).toHaveLength(1))
    expect(host.fetch).toHaveBeenCalledTimes(1)
    expect(host.fetch.mock.calls[0]?.[0]).toBe('api/dshx-batch')
    const [batch] = host.batches
    expect(batch?.entries.map(entry => entry.endpoint)).toEqual(['dshx-a/slow', 'dshx-a/fast'])
    let slowSettled = false
    void slowResult.then(() => (slowSettled = true))
    batch?.write({ id: batch.entries[1]?.id, result: ok('fast') })
    expect(await fastResult).toEqual(ok('fast'))
    expect(slowSettled).toBe(false)
    batch?.write({ id: batch.entries[0]?.id, result: { ok: false, error: { code: 'internal', message: 'boom', details: {} } } })
    batch?.end()
    expect(await slowResult).toEqual({ ok: false, error: { code: 'internal', message: 'boom', details: {} } })
    expect(slow.send).not.toHaveBeenCalled()
    expect(fast.send).not.toHaveBeenCalled()
  })

  it('flushes at maxSize without waiting for the window, and starts the next batch with the call after it', async () => {
    const host = streamingHost()
    const batcher = ApiBatchModel.create({ fetch: host.fetch, windowMs: 60_000, maxSize: 3 })
    for (const index of [0, 1, 2, 3]) void batcher.call(batchCall(`dshx-a/m${index}`)).catch(() => undefined)
    await vi.waitFor(() => expect(host.batches).toHaveLength(1))
    expect(host.batches[0]?.entries).toHaveLength(3)
    expect(host.fetch).toHaveBeenCalledTimes(1)
  })

  it('drops a call aborted inside the window from the batch, and cancels the POST once every sent call aborted', async () => {
    const host = streamingHost()
    const batcher = ApiBatchModel.create({ fetch: host.fetch, windowMs: 5 })
    const early = new AbortController()
    const late = new AbortController()
    const kept = new AbortController()
    const earlyResult = batcher.call(batchCall('dshx-a/early', { signal: early.signal }))
    const lateResult = batcher.call(batchCall('dshx-a/late', { signal: late.signal }))
    const keptCall = batchCall('dshx-a/kept', { signal: kept.signal })
    const keptResult = batcher.call(keptCall)
    early.abort('gone')
    await expect(earlyResult).rejects.toBe('gone')
    await vi.waitFor(() => expect(host.batches).toHaveLength(1))
    const [batch] = host.batches
    expect(batch?.entries.map(entry => entry.endpoint)).toEqual(['dshx-a/late', 'dshx-a/kept'])
    late.abort('left')
    await expect(lateResult).rejects.toBe('left')
    expect(batch?.signal.aborted).toBe(false)
    batch?.write({ id: batch.entries[1]?.id, result: ok('kept') })
    expect(await keptResult).toEqual(ok('kept'))

    const second = batchCall('dshx-a/second', { signal: new AbortController().signal })
    const controller = new AbortController()
    const secondResult = batcher.call({ ...second, signal: controller.signal })
    await vi.waitFor(() => expect(host.batches).toHaveLength(2))
    controller.abort('cancelled')
    await expect(secondResult).rejects.toBe('cancelled')
    expect(host.batches[1]?.signal.aborted).toBe(true)
    expect(second.send).not.toHaveBeenCalled()
    expect(keptCall.send).not.toHaveBeenCalled()
  })

  it('reports an endpoint no API serves as the per-channel 404, and sends a call the Host could not batch on its own route', async () => {
    const host = streamingHost()
    const batcher = ApiBatchModel.create({ fetch: host.fetch, windowMs: 5 })
    const missing = batchCall('dshx-gone/read')
    const refused = batchCall('dshx-a/read')
    const missingResult = batcher.call(missing)
    const refusedResult = batcher.call(refused)
    await vi.waitFor(() => expect(host.batches).toHaveLength(1))
    const [batch] = host.batches
    batch?.write({ id: batch.entries[0]?.id, status: 404 })
    batch?.write({ id: batch.entries[1]?.id, status: 503 })
    batch?.end()
    await expect(missingResult).rejects.toThrow(/HTTP 404$/u)
    expect(await refusedResult).toEqual(ok('alone dshx-a/read'))
    expect(refused.send).toHaveBeenCalledTimes(1)
    expect(missing.send).not.toHaveBeenCalled()
  })

  it('sends each call the stream left unanswered on its own route exactly once', async () => {
    const host = streamingHost()
    const batcher = ApiBatchModel.create({ fetch: host.fetch, windowMs: 5 })
    const answered = batchCall('dshx-a/answered')
    const dropped = batchCall('dshx-a/dropped')
    const results = [batcher.call(answered), batcher.call(dropped)]
    await vi.waitFor(() => expect(host.batches).toHaveLength(1))
    const [batch] = host.batches
    batch?.write({ id: batch.entries[0]?.id, result: ok('batched') })
    batch?.write({ nonsense: true })
    batch?.end()
    expect(await Promise.all(results)).toEqual([ok('batched'), ok('alone dshx-a/dropped')])
    expect(dropped.send).toHaveBeenCalledTimes(1)
    expect(answered.send).not.toHaveBeenCalled()
  })

  it('retries every call of a POST that failed outright, but keeps batching later calls', async () => {
    let attempts = 0
    const host = streamingHost()
    const fetch = vi.fn(async (input: string, init: RequestInit) => {
      attempts += 1
      if (attempts === 1) throw new TypeError('network down')
      return host.fetch(input, init)
    })
    const batcher = ApiBatchModel.create({ fetch, windowMs: 5 })
    const first = batchCall('dshx-a/first')
    expect(await batcher.call(first)).toEqual(ok('alone dshx-a/first'))
    expect(first.send).toHaveBeenCalledTimes(1)
    const second = batcher.call(batchCall('dshx-a/second'))
    await vi.waitFor(() => expect(host.batches).toHaveLength(1))
    host.batches[0]?.write({ id: host.batches[0].entries[0]?.id, result: ok('second') })
    expect(await second).toEqual(ok('second'))
  })

  it.each([
    ['a 404', new Response('not found', { status: 404 })],
    ['a 405', new Response('no', { status: 405 })],
    ['an HTML page', new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } })],
  ])('falls back to per-channel calls for good when the Host answers %s', async (_label, response) => {
    const fetch = vi.fn(async () => response)
    const batcher = ApiBatchModel.create({ fetch, windowMs: 5 })
    const first = batchCall('dshx-a/first')
    expect(await batcher.call(first)).toEqual(ok('alone dshx-a/first'))
    const second = batchCall('dshx-a/second')
    expect(await batcher.call(second)).toEqual(ok('alone dshx-a/second'))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(first.send).toHaveBeenCalledTimes(1)
    expect(second.send).toHaveBeenCalledTimes(1)
  })

  it('keeps batching after a transient server error, sending that batch per channel', async () => {
    const host = streamingHost()
    let attempts = 0
    const fetch = vi.fn(async (input: string, init: RequestInit) => {
      attempts += 1
      return attempts === 1 ? new Response('busy', { status: 503 }) : host.fetch(input, init)
    })
    const batcher = ApiBatchModel.create({ fetch, windowMs: 5 })
    expect(await batcher.call(batchCall('dshx-a/first'))).toEqual(ok('alone dshx-a/first'))
    const second = batcher.call(batchCall('dshx-a/second'))
    await vi.waitFor(() => expect(host.batches).toHaveLength(1))
    host.batches[0]?.write({ id: host.batches[0].entries[0]?.id, result: ok('second') })
    expect(await second).toEqual(ok('second'))
  })
})

const hostFixture = () => {
  const routes = new Map<string, ConnectionFetchRoute>()
  const context = {
    get: (name: string) =>
      name === 'connection'
        ? {
            fetch: {
              register: (route: ConnectionFetchRoute) => {
                routes.set(route.path, route)
                return async () => {
                  routes.delete(route.path)
                }
              },
            },
          }
        : undefined,
    effect: () => undefined,
  }
  Object.assign(context, { root: context })
  return { context, routes }
}

const boardApi = defineApi({
  id: 'batch-board',
  version: 1,
  owner: '@acme/batch-board',
  methods: {
    fast: method({ input: Schema.Struct({ name: Schema.String }), output: Schema.String, readOnly: true }),
    slow: method({ output: Schema.String, readOnly: true }),
    broken: method({ output: Schema.String, readOnly: true }),
    write: method({ input: Schema.Struct({ name: Schema.String }), output: Schema.String }),
  },
})

const readLines = async (response: Response, count: number): Promise<unknown[]> => {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let text = ''
  const lines: unknown[] = []
  while (lines.length < count) {
    const chunk = await reader.read()
    if (chunk.done) break
    text += decoder.decode(chunk.value)
    for (let boundary = text.indexOf('\n'); boundary !== -1; boundary = text.indexOf('\n')) {
      lines.push(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(text.slice(0, boundary)))
      text = text.slice(boundary + 1)
    }
  }
  return lines
}

const mountBoard = async () => {
  const fixture = hostFixture()
  let releaseSlow!: (value: string) => void
  const slowAnswer = new Promise<string>(resolve => void (releaseSlow = resolve))
  await registerApi(
    fixture.context as never,
    '@acme/batch-board',
    boardApi.host({
      fast: ({ input }) => `hello ${input.name}`,
      slow: () => slowAnswer,
      broken: () => {
        throw new Error('handler exploded')
      },
      write: ({ input }) => `wrote ${input.name}`,
    }),
  )
  await vi.waitFor(() => expect(fixture.routes.has(ApiChannelModel.batchPath)).toBe(true))
  const channel = ApiChannelModel.apiChannel('@acme/batch-board', 'batch-board').slice(1)
  return { fixture, channel, releaseSlow }
}

describe('Host batch route', () => {
  it('dispatches every entry independently, streams each answer as it settles and records one dispatch span per entry', async () => {
    const { fixture, channel, releaseSlow } = await mountBoard()
    using recorder = recordSpans()
    const route = fixture.routes.get(ApiChannelModel.batchPath)!
    const response = await route.fetch(
      new Request('http://localhost/api/dshx-batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entries: [
            { id: 1, endpoint: `${channel}/slow`, payload: { version: 1 } },
            { id: 2, endpoint: `${channel}/fast`, payload: { version: 1, input: { name: 'ada' } } },
            { id: 3, endpoint: `${channel}/broken`, payload: { version: 1 } },
            { id: 4, endpoint: `${channel}/fast`, payload: { version: 1, input: { name: 42 } } },
            { id: 5, endpoint: 'dshx-00000000/read', payload: { version: 1 } },
          ],
        }),
      }),
    )
    expect(response.headers.get('content-type')).toBe('application/x-ndjson')
    const answers = readLines(response, 5)
    await vi.waitFor(() => expect(recorder.named(/^batch-board\//u)).toHaveLength(3))
    releaseSlow('finally')
    const lines = await answers
    expect(lines.at(-1)).toEqual({ id: 1, result: { ok: true, value: { version: 1, output: 'finally' } } })
    expect(lines).toEqual(
      expect.arrayContaining([
        { id: 2, result: { ok: true, value: { version: 1, output: 'hello ada' } } },
        { id: 3, result: { ok: false, error: { code: 'internal', message: 'API handler failed. See Host diagnostics.', details: {} } } },
        { id: 4, result: { ok: false, error: expect.objectContaining({ code: 'contract' }) } },
        { id: 5, status: 404 },
      ]),
    )
    expect(
      recorder
        .named(/^batch-board\//u)
        .map(span => span.name)
        .sort(),
    ).toEqual(['batch-board/broken', 'batch-board/fast', 'batch-board/fast', 'batch-board/slow'])
    expect(recorder.span('batch-board/slow').attributes['dshx.api.caller']).toBe('client')
  })

  it('refuses a body that is not a batch', async () => {
    const { fixture } = await mountBoard()
    const route = fixture.routes.get(ApiChannelModel.batchPath)!
    const post = (body: string, type = 'application/json') =>
      route.fetch(new Request('http://localhost/api/dshx-batch', { method: 'POST', headers: { 'content-type': type }, body }))
    expect((await post('{"entries":[{"id":"x"}]}')).status).toBe(400)
    expect((await post('not json')).status).toBe(400)
    expect((await post('{}', 'text/plain')).status).toBe(415)
  })
})

describe('batched reads through createApiClient', () => {
  const BATCHER_KEY = Symbol.for('@dshfiles/dshx.api-batch.v1')
  // SAFETY: the test only reads and resets these two globals it installs itself.
  const holder = globalThis as { [BATCHER_KEY]?: unknown; document?: unknown }

  afterEach(() => {
    delete holder[BATCHER_KEY]
    delete holder.document
    vi.unstubAllGlobals()
  })

  it('sends reads of one tick as one batch to the Host route while writes keep their own route', async () => {
    const { fixture, releaseSlow } = await mountBoard()
    releaseSlow('slow')
    const route = fixture.routes.get(ApiChannelModel.batchPath)!
    const pageFetch = vi.fn((input: string, init: RequestInit) => route.fetch(new Request(`http://localhost/${input}`, init)))
    vi.stubGlobal('fetch', pageFetch)
    holder.document = {}
    const call = vi.fn(async (_channel: string, endpoint: string) => ({ ok: true, value: { version: 1, output: `alone ${endpoint.split('/')[1]}` } }))
    const client = ApiRuntimeModel.createClient({ get: () => ({ rpc: { call } }) }, boardApi, '@acme/viewer')
    const [fast, slow, write] = await Promise.all([client.fast({ name: 'ada' }), client.slow(undefined), client.write({ name: 'x' })])
    expect([fast, slow, write]).toEqual(['hello ada', 'slow', 'alone write'])
    expect(pageFetch).toHaveBeenCalledTimes(1)
    expect(call).toHaveBeenCalledTimes(1)
    expect(call.mock.calls[0]?.[1]).toMatch(/\/write$/u)
    await expect(client.broken(undefined)).rejects.toMatchObject({ message: 'API handler failed. See Host diagnostics.' })
  })

  it('keeps every read on its own route when the page opted out', async () => {
    const pageFetch = vi.fn()
    vi.stubGlobal('fetch', pageFetch)
    vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'dshx:batch' ? 'off' : null) })
    holder.document = {}
    const call = vi.fn(async () => ({ ok: true, value: { version: 1, output: 'alone' } }))
    const client = ApiRuntimeModel.createClient({ get: () => ({ rpc: { call } }) }, boardApi, '@acme/viewer')
    expect(await client.slow(undefined)).toBe('alone')
    expect(pageFetch).not.toHaveBeenCalled()
    expect(call).toHaveBeenCalledTimes(1)
  })
})
