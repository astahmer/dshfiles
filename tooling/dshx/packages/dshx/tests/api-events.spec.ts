import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { z } from 'zod'
import { defineApi, event, method } from '../src/api/index.js'
import { ApiClientEventsModel } from '../src/api/client-events.js'
import { ApiProtocolModel } from '../src/api/common.js'
import { HostApiEventsModel } from '../src/api/host-events.js'
import { registerApi } from '../src/api/host-runtime.js'
import { ApiRuntimeModel } from '../src/api/runtime.js'
import type { ApiEventStatus } from '../src/api/types.js'

const jobsApi = defineApi({
  id: 'jobs',
  version: 2,
  owner: '@acme/jobs',
  methods: { board: method<void, { readonly rows: number }>() },
  events: {
    changed: event({ schema: z.object({ running: z.number().int().nonnegative() }).strict(), description: 'The job board changed.' }),
  },
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

const readFrames = (response: Response) => {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  return async (): Promise<unknown> => {
    for (;;) {
      const boundary = buffered.indexOf('\n\n')
      if (boundary !== -1) {
        const chunk = buffered.slice(0, boundary)
        buffered = buffered.slice(boundary + 2)
        if (chunk.startsWith('data: ')) return JSON.parse(chunk.slice('data: '.length))
        continue
      }
      const next = await reader.read()
      if (next.done) return undefined
      buffered += decoder.decode(next.value)
    }
  }
}

describe('Host API events', () => {
  it('streams the event catalog, then each published event, to every connected browser', async () => {
    const fixture = hostFixture()
    await registerApi(fixture.context as never, '@acme/jobs', jobsApi.host({ board: () => ({ rows: 0 }) }))
    await vi.waitFor(() => expect(fixture.routes.has(ApiProtocolModel.eventsPath)).toBe(true))
    const controller = new AbortController()
    const response = await fixture.routes
      .get(ApiProtocolModel.eventsPath)!
      .fetch(new Request('http://localhost/api/dshx-events', { signal: controller.signal }))
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    const next = readFrames(response)
    const key = ApiProtocolModel.eventKey('@acme/jobs', 'jobs', 'changed')
    expect(await next()).toEqual({ type: 'catalog', events: [key] })

    await HostApiEventsModel.publish(fixture.context as never, jobsApi, 'changed', { running: 3 })
    expect(await next()).toEqual({ type: 'event', key, version: 2, data: { running: 3 } })

    controller.abort()
    expect(await next()).toBeUndefined()
  })

  it('rejects a payload its schema refuses, and an event the contract does not declare', async () => {
    const fixture = hostFixture()
    await registerApi(fixture.context as never, '@acme/jobs', jobsApi.host({ board: () => ({ rows: 0 }) }))
    // @ts-expect-error running must be a number
    await expect(HostApiEventsModel.publish(fixture.context as never, jobsApi, 'changed', { running: 'many' })).rejects.toThrow('validation failed')
    // @ts-expect-error the contract declares no such event
    await expect(HostApiEventsModel.publish(fixture.context as never, jobsApi, 'removed', {})).rejects.toThrow('declares no event')
  })

  it('refuses an event declared without a schema', () => {
    expect(() => defineApi({ id: 'broken', version: 1, methods: {}, events: { changed: {} as never } })).toThrow('needs a Standard Schema')
  })
})

class FakeEventSource {
  static readonly instances: FakeEventSource[] = []
  readyState = 0
  onmessage: ((event: { readonly data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  readonly close = vi.fn(() => {
    this.readyState = 2
  })

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  send(value: { readonly type: string; readonly [field: string]: unknown }): void {
    this.onmessage?.({ data: JSON.stringify(value) })
  }

  fail(readyState: number): void {
    this.readyState = readyState
    this.onerror?.()
  }
}

const browserClient = () => ApiRuntimeModel.createClient({ get: () => ({ rpc: { call: vi.fn() } }) }, jobsApi, '@acme/viewer')

const subscribe = () => {
  const statuses: ApiEventStatus[] = []
  const payloads: unknown[] = []
  const unsubscribe = ApiClientEventsModel.subscribe(browserClient(), 'changed', {
    onEvent: payload => {
      expectTypeOf(payload).toEqualTypeOf<{ running: number }>()
      payloads.push(payload)
    },
    onStatus: status => statuses.push(status),
  })
  return { statuses, payloads, unsubscribe, source: FakeEventSource.instances.at(-1)! }
}

describe('browser API events', () => {
  const key = ApiProtocolModel.eventKey('@acme/jobs', 'jobs', 'changed')

  afterEach(() => {
    vi.unstubAllGlobals()
    FakeEventSource.instances.length = 0
  })

  it('delivers schema-valid events of the current contract version once the Host lists the event', async () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const subscription = subscribe()
    expect(subscription.source.url).toBe('api/dshx-events')
    expect(subscription.statuses).toEqual(['connecting'])
    subscription.source.send({ type: 'catalog', events: [key] })
    expect(subscription.statuses).toEqual(['connecting', 'live'])

    subscription.source.send({ type: 'event', key, version: 2, data: { running: 1 } })
    subscription.source.send({ type: 'event', key, version: 1, data: { running: 2 } })
    subscription.source.send({ type: 'event', key, version: 2, data: { running: -1 } })
    subscription.source.send({ type: 'event', key: 'other/changed', version: 2, data: { running: 4 } })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await vi.waitFor(() => expect(subscription.payloads).toEqual([{ running: 1 }]))
    subscription.unsubscribe()
  })

  it('shares one stream per page and closes it with the last subscriber', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const first = subscribe()
    const second = subscribe()
    expect(FakeEventSource.instances).toHaveLength(1)
    first.unsubscribe()
    expect(first.source.close).not.toHaveBeenCalled()
    second.unsubscribe()
    expect(first.source.close).toHaveBeenCalledOnce()
  })

  it('reports unavailable when the Host does not publish the event or serves no event stream', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const subscription = subscribe()
    subscription.source.send({ type: 'catalog', events: [] })
    expect(subscription.statuses.at(-1)).toBe('unavailable')
    subscription.source.send({ type: 'catalog', events: [key] })
    subscription.source.fail(0)
    expect(subscription.statuses.slice(-2)).toEqual(['live', 'connecting'])
    subscription.source.fail(2)
    expect(subscription.statuses.at(-1)).toBe('unavailable')
    subscription.unsubscribe()
  })

  it('reports unavailable where the page has no EventSource', () => {
    vi.stubGlobal('EventSource', undefined)
    const statuses: ApiEventStatus[] = []
    const unsubscribe = ApiClientEventsModel.subscribe(browserClient(), 'changed', { onEvent: () => undefined, onStatus: status => statuses.push(status) })
    expect(statuses).toEqual(['unavailable'])
    unsubscribe()
  })
})
