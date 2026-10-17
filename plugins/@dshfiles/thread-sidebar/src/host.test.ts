import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadAttentionView } from './attention-api.js'

/**
 * Wiring check for the Host half: the built bundle turns committed `turn/end`
 * events into durable attention rows, and the surrounding turn ends stay out of
 * the store. The unit tests cover the store and the reason mapping; this proves
 * the plugin actually subscribes and writes.
 */

interface BuiltPlugin {
  /** The harness only cares that activation ran; the returned disposable is ignored. */
  readonly apply: (ctx: unknown, config?: unknown) => void
}

const builtEntry = new URL('../dist/index.js', import.meta.url).href

type SessionEventListener = (session: { readonly id: string }, event: unknown) => void

interface Harness {
  readonly rows: Map<string, ThreadAttentionView>
  readonly dispatch: (event: unknown) => void
}

const table = (rows: Map<string, ThreadAttentionView>) => ({
  get: (key: string) => rows.get(key),
  entries: () => rows.entries(),
  keys: () => rows.keys(),
  get size() {
    return rows.size
  },
  put: async (key: string, value: ThreadAttentionView) => {
    rows.set(key, value)
  },
  delete: async (key: string) => rows.delete(key),
  update: async (key: string, change: (current: ThreadAttentionView) => ThreadAttentionView) => {
    const current = rows.get(key)
    if (current === undefined) throw new Error('missing row')
    const next = change(current)
    rows.set(key, next)
    return next
  },
})

const startHarness = async (): Promise<Harness> => {
  const plugin = (await import(builtEntry)) as BuiltPlugin
  const rows = new Map<string, ThreadAttentionView>()
  const listeners = new Map<string, SessionEventListener>()
  const disposers: (() => void)[] = []
  const on = (event: string, handler: SessionEventListener): void => {
    listeners.set(event, handler)
  }
  const ctx = {
    on,
    once: on,
    emit: on,
    parallel: on,
    serial: on,
    bail: on,
    waterfall: on,
    effect: (callback: () => unknown) => {
      const disposer = callback()
      if (typeof disposer === 'function') disposers.push(disposer as () => void)
    },
    get: (name: string) => (name === 'storageDomain' ? { open: async () => ({ table: () => table(rows), close: async () => undefined }) } : undefined),
    inject: () => undefined,
    sessionProjections: { register: () => () => undefined },
    settings: {
      configure: () => () => undefined,
      describe: () => [{ ns: 'thread-sidebar', value: {} }],
      update: async () => undefined,
      replace: async () => undefined,
    },
  }
  await plugin.apply(ctx)
  return {
    rows,
    dispatch: event => {
      const handler = listeners.get('session/event')
      if (handler === undefined) throw new Error('thread-sidebar registered no session/event listener')
      handler({ id: 'session-1' }, event)
    },
  }
}

const turnEnd = (kind: string): unknown => ({ type: 'turn/end', seq: 16, time: 1_700_000_000_000, data: { turn: 1, reason: { kind } } })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('thread-sidebar attention wiring', () => {
  it('stores a finished turn and ignores turn ends that ask for nothing', async () => {
    const harness = await startHarness()

    harness.dispatch({ type: 'turn/start', seq: 4, time: 1, data: { turn: 1 } })
    harness.dispatch(turnEnd('forked'))
    harness.dispatch(turnEnd('interrupted'))
    await Promise.resolve()
    expect(harness.rows.size).toBe(0)

    harness.dispatch(turnEnd('error'))
    await vi.waitFor(() => expect(harness.rows.size).toBe(1))
    const record = harness.rows.get('session-1')
    expect(record).toMatchObject({ finishedReason: 'error', finishedSeq: 16, finishedAt: 1_700_000_000_000, manuallyUnread: false })
  })
})
