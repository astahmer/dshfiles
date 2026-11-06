// @vitest-environment jsdom
import { createRequire } from 'node:module'
import * as Schema from 'effect/Schema'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineApi, method } from '../src/api/index.js'
import { ApiClientLifecycle, useApiQuery } from '../src/api/client.js'
import type { ApiQueryResult } from '../src/api/types.js'

interface TestRoot {
  render(node: ReturnType<typeof createElement>): void
  unmount(): void
}

const nodeRequire = createRequire(import.meta.url)
// SAFETY: react-dom/client and react are the jsdom test's own dependencies; only these two members are used.
const { createRoot } = nodeRequire('react-dom/client') as { createRoot(container: Element): TestRoot }
// SAFETY: as above.
const { act } = nodeRequire('react') as { act(callback: () => void | Promise<void>): Promise<void> }

// Writable, so every read is its own Connection call instead of joining the page's in-flight read coalescing.
const queryApi = defineApi({
  id: 'query-lifecycle',
  version: 1,
  owner: '@acme/query',
  methods: { read: method({ output: Schema.Number }) },
})

/** A Connection whose reads settle only when the test says so, with a Host generation the test can replace. */
const connectionFixture = () => {
  const calls: Array<{ readonly resolve: (value: unknown) => void }> = []
  let generation: { readonly id: number } | undefined = { id: 1 }
  const listeners = new Set<() => void>()
  const connection = {
    rpc: {
      call: (_channel: string, _endpoint: string, _request: unknown, _signal?: AbortSignal) =>
        new Promise<unknown>(resolve => {
          calls.push({ resolve })
        }),
    },
    hostDescription: {
      getSnapshot: () => generation,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
  }
  return {
    calls,
    context: { get: (name: string) => (name === 'connection' ? connection : undefined) },
    resolveLast: (output: number) => calls.at(-1)?.resolve({ ok: true, value: { version: 1, output } }),
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

describe('useApiQuery', () => {
  let container: HTMLElement
  let root: TestRoot

  beforeEach(() => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(() => root.unmount())
    vi.unstubAllGlobals()
  })

  const mount = async (fixture: ReturnType<typeof connectionFixture>, element: () => ReturnType<typeof createElement>) => {
    const runtime = ApiClientLifecycle.create(fixture.context, '@acme/viewer')
    const Provided = ApiClientLifecycle.provide(element as never, runtime)
    await act(() => root.render(createElement(Provided, {})))
    await flush()
  }

  it('reads on a manual refetch of a disabled query, then reports idle', async () => {
    const fixture = connectionFixture()
    let latest!: ApiQueryResult<number>
    const Read = () => {
      latest = useApiQuery(queryApi, 'read', { enabled: false })
      return createElement('span', null, latest.status)
    }
    await mount(fixture, Read)
    expect(latest.status).toBe('pending')
    expect(latest.fetchStatus).toBe('idle')
    expect(fixture.calls).toHaveLength(0)

    await act(async () => {
      latest.refetch()
    })
    await flush()
    expect(fixture.calls).toHaveLength(1)
    expect(latest.fetchStatus).toBe('fetching')

    await act(async () => {
      fixture.resolveLast(7)
    })
    await flush()
    expect(latest.status).toBe('success')
    expect(latest.fetchStatus).toBe('idle')
    expect(latest.data).toBe(7)
    expect(container.textContent).toBe('success')
  })

  it('resumes an unanswered manual read on the next Host generation, then stops asking once it settled', async () => {
    const fixture = connectionFixture()
    let latest!: ApiQueryResult<number>
    const Read = () => {
      latest = useApiQuery(queryApi, 'read', { enabled: false })
      return createElement('span', null, String(latest.data))
    }
    await mount(fixture, Read)
    await act(async () => {
      latest.refetch()
    })
    await flush()
    expect(fixture.calls).toHaveLength(1)

    await act(async () => {
      fixture.setGeneration(undefined)
    })
    await flush()
    expect(latest.fetchStatus).toBe('paused')

    await act(async () => {
      fixture.setGeneration({ id: 2 })
    })
    await flush()
    expect(fixture.calls).toHaveLength(2)
    expect(latest.fetchStatus).toBe('fetching')

    await act(async () => {
      fixture.resolveLast(9)
    })
    await flush()
    expect(latest.status).toBe('success')
    expect(latest.data).toBe(9)

    await act(async () => {
      fixture.setGeneration({ id: 3 })
    })
    await flush()
    expect(fixture.calls).toHaveLength(2)
    expect(latest.fetchStatus).toBe('idle')
    expect(container.textContent).toBe('9')
  })

  it('pauses a read when its Host generation goes away and reads it again on the next one', async () => {
    const fixture = connectionFixture()
    let latest!: ApiQueryResult<number>
    const Read = () => {
      latest = useApiQuery(queryApi, 'read')
      return createElement('span', null, `${String(latest.data)}|${latest.fetchStatus}`)
    }
    await mount(fixture, Read)
    expect(fixture.calls).toHaveLength(1)
    await act(async () => {
      fixture.resolveLast(3)
    })
    await flush()
    expect(latest.status).toBe('success')
    expect(latest.data).toBe(3)

    await act(async () => {
      fixture.setGeneration(undefined)
    })
    await flush()
    expect(latest.fetchStatus).toBe('paused')
    expect(latest.data).toBe(3)

    await act(async () => {
      fixture.setGeneration({ id: 2 })
    })
    await flush()
    expect(fixture.calls).toHaveLength(2)
    expect(latest.fetchStatus).toBe('fetching')
    await act(async () => {
      fixture.resolveLast(4)
    })
    await flush()
    expect(latest.data).toBe(4)
    expect(latest.fetchStatus).toBe('idle')
    expect(container.textContent).toBe('4|idle')
  })
})
