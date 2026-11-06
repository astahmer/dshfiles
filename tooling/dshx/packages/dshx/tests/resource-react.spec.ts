// @vitest-environment jsdom
import { createRequire } from 'node:module'
import * as Schema from 'effect/Schema'
import { createElement, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineApi, event, method } from '../src/api/index.js'
import { ApiClientLifecycle, useResource, type UseResourceResult } from '../src/api/client.js'
import { ApiResourceModel } from '../src/api/api-resource.js'
import { ApiRuntimeModel } from '../src/api/runtime.js'
import { ApiChannelModel } from '../src/api/channel.js'
import { ResourceStoreModel } from '../src/api/resource-store.js'
import type { JsonValue } from '../src/json.js'

interface TestRoot {
  render(node: ReturnType<typeof createElement>): void
  unmount(): void
}

const nodeRequire = createRequire(import.meta.url)
// SAFETY: react-dom/client and react are the jsdom test's own dependencies; only these two members are used.
const { createRoot } = nodeRequire('react-dom/client') as { createRoot(container: Element): TestRoot }
// SAFETY: as above.
const { act } = nodeRequire('react') as { act(callback: () => void | Promise<void>): Promise<void> }

const boardApi = defineApi({
  id: 'board',
  version: 1,
  owner: '@acme/board',
  methods: {
    revision: method({ output: Schema.Number, readOnly: true, tags: ['revision'] }),
    rows: method({ input: Schema.Struct({ scope: Schema.String }), output: Schema.Array(Schema.String), readOnly: true }),
  },
  events: {
    changed: event({ schema: Schema.Struct({ revision: Schema.Number }), invalidates: ['revision'] }),
  },
})

class FakeEventSource {
  static readonly instances: FakeEventSource[] = []
  readyState = 0
  onmessage: ((event: { readonly data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  close(): void {
    this.readyState = 2
  }
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }
  send(value: { readonly type: string; readonly [field: string]: JsonValue }): void {
    this.onmessage?.({ data: JSON.stringify(value) })
  }
}

/** A Connection whose reads answer from a counter per endpoint, with a Host generation the test can replace. */
const connectionFixture = () => {
  const counts = new Map<string, number>()
  const call = vi.fn(async (_channel: string, endpoint: string, request: { readonly input?: unknown }) => {
    const next = (counts.get(endpoint) ?? 0) + 1
    counts.set(endpoint, next)
    const output = endpoint.endsWith('/rows') ? [`${JSON.stringify(request.input)}#${next}`] : next
    return { ok: true, value: { version: 1, output } }
  })
  let generation: { readonly id: number } | undefined = { id: 1 }
  const listeners = new Set<() => void>()
  const connection = {
    rpc: { call },
    hostDescription: {
      getSnapshot: () => generation,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
  }
  return {
    call,
    context: { get: (name: string) => (name === 'connection' ? connection : undefined) },
    setGeneration: (next: { readonly id: number } | undefined) => {
      generation = next
      for (const listener of [...listeners]) listener()
    },
  }
}

const flush = async (): Promise<void> => {
  await act(async () => {
    for (let index = 0; index < 10; index += 1) await Promise.resolve()
  })
}

const callsTo = (call: ReturnType<typeof connectionFixture>['call'], method: string): number =>
  call.mock.calls.filter(([, endpoint]) => endpoint.endsWith(`/${method}`)).length

describe('useResource', () => {
  let container: HTMLElement
  let root: TestRoot

  beforeEach(() => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
    // The fixture counts per-call reads on its own Connection; the page batcher (jsdom has document and fetch) would
    // send them to a batch route this fixture does not serve.
    localStorage.setItem('dshx:batch', 'off')
    ResourceStoreModel.page().clear()
    FakeEventSource.instances.length = 0
    container = document.createElement('div')
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(() => root.unmount())
    vi.unstubAllGlobals()
    localStorage.removeItem('dshx:batch')
    ResourceStoreModel.page().clear()
  })

  const mount = async (fixture: ReturnType<typeof connectionFixture>, element: () => ReturnType<typeof createElement>) => {
    const runtime = ApiClientLifecycle.create(fixture.context, '@acme/viewer')
    const Provided = ApiClientLifecycle.provide(element as never, runtime)
    await act(() => root.render(createElement(Provided, {})))
    await flush()
  }

  it('shares one read between two mounted callers of the same key, in different bundles', async () => {
    const fixture = connectionFixture()
    const seen: Array<UseResourceResult<readonly string[]>> = []
    const Rows = (props: { readonly label: string }) => {
      const rows = useResource(boardApi, 'rows', { scope: 'open' }, { staleTime: 60_000 })
      seen.push(rows)
      return createElement('span', { 'data-label': props.label }, rows.data?.join(',') ?? rows.status)
    }
    await mount(fixture, () => createElement('div', null, createElement(Rows, { label: 'a' }), createElement(Rows, { label: 'b' })))
    expect(callsTo(fixture.call, 'rows')).toBe(1)
    expect(container.textContent).toBe('{"scope":"open"}#1{"scope":"open"}#1')
    expect(seen.at(-1)?.status).toBe('success')
  })

  it('pauses its poll while the caller says it is hidden and reads once on reveal', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      const fixture = connectionFixture()
      const controls = { setVisible: (_visible: boolean): void => undefined }
      const Revision = () => {
        const [visible, update] = useState(true)
        controls.setVisible = update
        const revision = useResource(boardApi, 'revision', undefined, { pollInterval: 1_000, visible })
        return createElement('span', null, String(revision.data))
      }
      await mount(fixture, Revision)
      expect(callsTo(fixture.call, 'revision')).toBe(1)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000)
      })
      expect(callsTo(fixture.call, 'revision')).toBe(2)
      await act(() => controls.setVisible(false))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000)
      })
      expect(callsTo(fixture.call, 'revision')).toBe(2)
      await act(() => controls.setVisible(true))
      await flush()
      expect(callsTo(fixture.call, 'revision')).toBe(3)
      expect(container.textContent).toBe('3')
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-reads a tagged key when its API event names the tag, and stops polling while the event is live', async () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      const fixture = connectionFixture()
      const Revision = () => {
        const revision = useResource(boardApi, 'revision', undefined, { pollInterval: 1_000 })
        const rows = useResource(boardApi, 'rows', { scope: 'open' }, { staleTime: 60_000 })
        return createElement('span', null, `${revision.data}|${rows.data?.length}`)
      }
      await mount(fixture, Revision)
      const source = FakeEventSource.instances.at(-1)
      expect(source?.url).toBe(ApiChannelModel.eventsPath.slice(1))
      const key = ApiChannelModel.eventKey('@acme/board', 'board', 'changed')
      await act(() => source?.send({ type: 'catalog', events: [key] }))
      await flush()
      // Turning live re-reads once, because pushes sent before it are not replayed.
      expect(callsTo(fixture.call, 'revision')).toBe(2)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      expect(callsTo(fixture.call, 'revision')).toBe(2)
      await act(() => source?.send({ type: 'event', key, version: 1, data: { revision: 9 } }))
      await flush()
      expect(callsTo(fixture.call, 'revision')).toBe(3)
      expect(callsTo(fixture.call, 'rows')).toBe(1)
      expect(container.textContent).toBe('3|1')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the shown data and re-reads it on a new Host generation', async () => {
    const fixture = connectionFixture()
    const Revision = () => createElement('span', null, String(useResource(boardApi, 'revision', undefined, { staleTime: 60_000 }).data))
    await mount(fixture, Revision)
    expect(container.textContent).toBe('1')
    await act(() => fixture.setGeneration(undefined))
    expect(container.textContent).toBe('1')
    await act(() => fixture.setGeneration({ id: 2 }))
    await flush()
    expect(callsTo(fixture.call, 'revision')).toBe(2)
    expect(container.textContent).toBe('2')
  })

  it('scopes keys by owner, API, method and input, and tags by API', () => {
    const fixture = connectionFixture()
    const client = ApiRuntimeModel.createClient(fixture.context, boardApi, '@acme/viewer')
    const open = ApiResourceModel.register({ client, method: 'rows', input: { scope: 'open' } })
    const closed = ApiResourceModel.register({ client, method: 'rows', input: { scope: 'closed' } })
    const again = ApiResourceModel.register({
      client: ApiRuntimeModel.createClient(fixture.context, boardApi, '@acme/other'),
      method: 'rows',
      input: { scope: 'open' },
    })
    expect(open).not.toBe(closed)
    expect(again).toBe(open)
    const otherConnection = connectionFixture()
    const elsewhere = ApiResourceModel.register({
      client: ApiRuntimeModel.createClient(otherConnection.context, boardApi),
      method: 'rows',
      input: { scope: 'open' },
    })
    expect(elsewhere).not.toBe(open)
  })
})
