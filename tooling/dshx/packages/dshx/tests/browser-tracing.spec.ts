// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { defineApi, method } from '../src/api/index.js'
import { ApiRuntimeModel } from '../src/api/runtime.js'
import type { BrowserSpanRecord } from '../src/tracing/browser-protocol.js'
import { BrowserTracerModel, type BrowserTracer, type BrowserTracerOptions } from '../src/tracing/browser.js'
import { BrowserTraceTransportModel } from '../src/tracing/browser-transport.js'
import { BrowserTracingRegistryModel, type BrowserTraceTransport } from '../src/tracing/browser-registry.js'
import { endInteractionAfterPaint, startInteraction } from '../src/tracing/client/index.js'

const probe = defineApi({ id: 'probe', version: 1, owner: '@test/probe', methods: { ping: method<void, string>() } })

let restorers: Array<() => void> = []
afterEach(() => {
  for (const restore of restorers.reverse()) restore()
  restorers = []
})

const installPageTracer = (options: BrowserTracerOptions = {}): BrowserTracer => {
  const registry = BrowserTracingRegistryModel.current()
  const previous = registry.tracer
  const tracer = BrowserTracerModel.create({ scheduleDelayMs: 60_000, ...options })
  registry.tracer = tracer
  restorers.push(() => {
    registry.tracer = previous
  })
  return tracer
}

const hostTransport = (status: unknown) => {
  const exports: Array<{ readonly resource: unknown; readonly spans: readonly BrowserSpanRecord[] }> = []
  let statusReads = 0
  const transport: BrowserTraceTransport = {
    status: async () => {
      statusReads += 1
      return status
    },
    export: async input => {
      exports.push(input)
      return { accepted: input.spans.length, dropped: 0 }
    },
  }
  return { transport, exports, statusReads: () => statusReads }
}

const ENABLED = { enabled: true, sampleRatio: 1, maxRootSpansPerMinute: 60 }

const rpcRecorder = () => {
  const payloads: unknown[] = []
  const rpc = {
    call: async (_channel: string, _endpoint: string, payload: unknown) => {
      payloads.push(payload)
      await Promise.resolve()
      return { ok: true as const, value: { version: 1, output: 'pong' } }
    },
  }
  return { payloads, rpc, context: { get: (name: string) => (name === 'connection' ? { rpc } : undefined) } }
}

const traceparentOf = (payload: unknown): unknown =>
  typeof payload === 'object' && payload !== null && 'traceparent' in payload ? payload.traceparent : undefined

describe('browser tracer', () => {
  it('records nothing without a connected Host or a recorder', () => {
    const tracer = installPageTracer()
    expect(tracer.enabled).toBe(false)
    expect(tracer.startInteraction('thread switch').recording).toBe(false)
    expect(tracer.startSpan('anything')).toBe(BrowserTracerModel.noopSpan)
    expect(tracer.traceparent()).toBeUndefined()
  })

  it('keeps an open interaction the ambient parent across awaits, so API calls carry its child traceparent', async () => {
    const tracer = installPageTracer()
    const host = hostTransport(ENABLED)
    restorers.push(tracer.attachTransport(host.transport))
    using recorder = tracer.record()
    const rpc = rpcRecorder()
    const client = ApiRuntimeModel.createClient(rpc.context, probe)

    const interaction = startInteraction('thread switch', { attributes: { 'dshx.thread_sidebar.source': 'row' } })
    await new Promise(resolve => setTimeout(resolve, 1))
    await expect(client.ping()).resolves.toBe('pong')
    interaction.end()
    await client.ping()

    const root = recorder.span('thread switch')
    const call = recorder.span('probe/ping')
    expect(root.parentSpanId).toBeUndefined()
    expect(root.attributes).toMatchObject({ 'dshx.interaction': true, 'dshx.interaction.outcome': 'completed', 'dshx.thread_sidebar.source': 'row' })
    expect(call).toMatchObject({ traceId: root.traceId, parentSpanId: root.spanId, kind: 'client' })
    expect(call.attributes).toMatchObject({ 'rpc.system': 'dshx', 'rpc.method': 'ping', 'dshx.plugin.package': '@test/probe', 'dshx.api.outcome': 'ok' })
    expect(traceparentOf(rpc.payloads[0])).toBe(`00-${call.traceId}-${call.spanId}-01`)
    expect(rpc.payloads[1]).toEqual({ version: 1, input: undefined })
    expect(recorder.named('probe/ping')).toHaveLength(1)
  })

  it('records a call its caller cancelled as aborted, not failed', async () => {
    const tracer = installPageTracer()
    using recorder = tracer.record()
    const rpc = {
      call: (_channel: string, _endpoint: string, _payload: unknown, signal?: AbortSignal) =>
        new Promise<never>((_resolve, reject) => signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    }
    const client = ApiRuntimeModel.createClient({ get: (name: string) => (name === 'connection' ? { rpc } : undefined) }, probe)
    const controller = new AbortController()
    const interaction = tracer.startInteraction('thread switch')
    const pending = client.ping(undefined, { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' })
    interaction.end()
    const call = recorder.span('probe/ping')
    expect(call.status).toEqual({ code: 'unset' })
    expect(call.attributes['dshx.api.outcome']).toBe('aborted')
    expect(call.attributes['error.type']).toBeUndefined()
  })

  it('makes withSpan the active parent only during its synchronous part', async () => {
    const tracer = installPageTracer()
    using recorder = tracer.record()
    await tracer.withSpan('outer', {}, async () => {
      tracer.startSpan('inner').end()
      await Promise.resolve()
      tracer.startSpan('late').end()
    })
    const outer = recorder.span('outer')
    expect(recorder.span('inner').parentSpanId).toBe(outer.spanId)
    expect(recorder.span('late').parentSpanId).toBeUndefined()
  })

  it('marks a thrown callback failed with its class and code only', async () => {
    const tracer = installPageTracer()
    using recorder = tracer.record()
    const failure = Object.assign(new TypeError('secret message'), { code: 'denied' })
    await expect(
      tracer.withSpan('fails', {}, () => {
        throw failure
      }),
    ).rejects.toBe(failure)
    expect(recorder.span('fails')).toMatchObject({ status: { code: 'error', message: 'TypeError:denied' }, attributes: { 'error.type': 'TypeError:denied' } })
    expect(JSON.stringify(recorder.spans)).not.toContain('secret message')
  })

  it('ends an interaction after the next paint from the plugin that renders it', async () => {
    const tracer = installPageTracer()
    using recorder = tracer.record()
    startInteraction('thread switch')
    endInteractionAfterPaint('thread switch', { 'dshx.chat.entries': 12 })
    expect(recorder.named('thread switch')).toHaveLength(0)
    expect(tracer.interaction('thread switch')).toBeDefined()
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(recorder.span('thread switch').attributes).toMatchObject({ 'dshx.chat.entries': 12, 'dshx.interaction.outcome': 'completed' })
    expect(tracer.interaction('thread switch')).toBeUndefined()
    expect(() => endInteractionAfterPaint('thread switch')).not.toThrow()
  })

  it('closes an unended interaction as timeout and supersedes one reopened under the same name', async () => {
    const tracer = installPageTracer()
    using recorder = tracer.record()
    tracer.startInteraction('panel open', { timeoutMs: 5 })
    tracer.startInteraction('panel open', { timeoutMs: 5 })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(recorder.named('panel open').map(span => span.attributes['dshx.interaction.outcome'])).toEqual(['superseded', 'timeout'])
  })

  it('exports through the transport with the engine class only, and drops everything once the Host says off', async () => {
    const enabled = installPageTracer()
    const host = hostTransport(ENABLED)
    restorers.push(enabled.attachTransport(host.transport))
    enabled.startInteraction('composer send').end()
    await enabled.flush()
    expect(host.exports).toHaveLength(1)
    expect(host.exports[0]?.resource).toEqual({ engine: expect.stringMatching(/^(chromium|firefox|webkit|other)$/u), mobile: false })
    expect(host.exports[0]?.spans.map(span => span.name)).toEqual(['composer send'])
    expect(JSON.stringify(host.exports)).not.toContain(navigator.userAgent)

    const disabled = installPageTracer()
    const off = hostTransport({ enabled: false, sampleRatio: 1, maxRootSpansPerMinute: 60 })
    restorers.push(disabled.attachTransport(off.transport))
    disabled.startInteraction('composer send').end()
    await disabled.flush()
    expect(off.exports).toHaveLength(0)
    expect(disabled.enabled).toBe(false)
    expect(disabled.startInteraction('composer send').recording).toBe(false)
    await disabled.flush()
    expect(off.statusReads()).toBe(1)
  })

  it('applies the Host sampling ratio and per-minute root budget', async () => {
    const unsampled = installPageTracer()
    restorers.push(unsampled.attachTransport(hostTransport({ ...ENABLED, sampleRatio: 0 }).transport))
    await unsampled.flush()
    expect(unsampled.startInteraction('new thread').recording).toBe(false)

    const budgeted = installPageTracer()
    restorers.push(budgeted.attachTransport(hostTransport({ ...ENABLED, maxRootSpansPerMinute: 2 }).transport))
    await budgeted.flush()
    const kept = ['a', 'b', 'c'].map(name => budgeted.startInteraction(name))
    expect(kept.map(interaction => interaction.recording)).toEqual([true, true, false])
    expect(budgeted.startSpan('child', { parent: kept[0]?.context ?? null }).recording).toBe(true)
  })

  it('adds long tasks over the threshold as events of the open interaction', () => {
    let deliver: ((list: { getEntries(): Array<{ startTime: number; duration: number }> }) => void) | undefined
    let pending: Array<{ startTime: number; duration: number }> = []
    class LongTaskObserver {
      static readonly supportedEntryTypes = ['longtask']
      constructor(callback: typeof deliver) {
        deliver = callback
      }
      observe(): void {}
      disconnect(): void {
        deliver = undefined
      }
      takeRecords(): Array<{ startTime: number; duration: number }> {
        const taken = [...pending]
        pending = []
        return taken
      }
    }
    const previous = globalThis.PerformanceObserver
    Object.assign(globalThis, { PerformanceObserver: LongTaskObserver })
    restorers.push(() => Object.assign(globalThis, { PerformanceObserver: previous }))
    const tracer = installPageTracer()
    using recorder = tracer.record()
    const interaction = tracer.startInteraction('thread switch')
    deliver?.({ getEntries: () => [{ startTime: performance.now(), duration: 250 }] })
    deliver?.({ getEntries: () => [{ startTime: performance.now(), duration: 40 }] })
    pending = [{ startTime: performance.now(), duration: 310 }]
    interaction.end()
    const span = recorder.span('thread switch')
    expect(span.events.map(event => event.attributes['browser.longtask.duration_ms'])).toEqual([250, 310])
    expect(span.attributes).toMatchObject({ 'dshx.interaction.long_tasks': 2, 'dshx.interaction.long_task_ms': 560 })
    expect(deliver).toBeUndefined()
  })

  it('sends its own exports without a span or a traceparent, so exporting never traces itself', async () => {
    const tracer = installPageTracer()
    using recorder = tracer.record()
    const rpc = rpcRecorder()
    const transport = BrowserTraceTransportModel.fromRpc(rpc.rpc)
    const interaction = tracer.startInteraction('thread switch')
    await transport.export({ resource: { engine: 'other', mobile: false }, spans: [] })
    interaction.end()
    expect(traceparentOf(rpc.payloads[0])).toBeUndefined()
    expect(recorder.spans.map(span => span.name)).toEqual(['thread switch'])
  })
})
