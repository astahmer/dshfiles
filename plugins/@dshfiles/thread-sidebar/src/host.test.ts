import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadAttentionView } from './attention-api.js'
import { InflightTurns } from './inflight-turns.js'
import { createRestartRecoveryStore } from './restart-recovery.js'

/**
 * Wiring check for the Host half: the built bundle turns committed `turn/end`
 * events into durable attention rows, tracks the turns a crash could leave
 * open, and promotes a previous process's in-flight turns at boot. The unit
 * tests cover the stores and the reason mapping; this proves the plugin
 * actually subscribes and writes.
 */

interface BuiltPlugin {
  /** The harness only cares that activation ran; the returned disposable is ignored. */
  readonly apply: (ctx: unknown, config?: unknown) => void
}

const builtEntry = new URL('../dist/index.js', import.meta.url).href

type SessionEventListener = (session: { readonly id: string }, event: unknown) => void

interface Harness {
  readonly home: string
  readonly rows: Map<string, ThreadAttentionView>
  readonly dispatch: (event: unknown) => void
}

const temporaryHomes: string[] = []
const previousDshHome = process.env.DSH_HOME

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

/**
 * A fresh scratch home and module instance, so each test's stores are its own.
 * `seed` runs before the module loads, which is what a previous Host process
 * would have left behind on disk.
 */
const startHarness = async (seed?: (home: string) => Promise<void>): Promise<Harness> => {
  const home = await mkdtemp(join(tmpdir(), 'thread-sidebar-host-'))
  temporaryHomes.push(home)
  if (seed !== undefined) await seed(home)
  process.env.DSH_HOME = home
  vi.resetModules()
  // SAFETY: the built Host bundle default-exports the plugin whose `apply` this harness drives.
  const plugin = (await import(builtEntry)) as BuiltPlugin
  const rows = new Map<string, ThreadAttentionView>()
  const listeners = new Map<string, SessionEventListener[]>()
  const disposers: (() => void)[] = []
  const on = (event: string, handler: SessionEventListener): void => {
    listeners.set(event, [...(listeners.get(event) ?? []), handler])
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
      // SAFETY: Cordis effects return a disposer function; the typeof check above established it.
      if (typeof disposer === 'function') disposers.push(disposer as () => void)
    },
    get: (name: string) => (name === 'storageDomain' ? { open: async () => ({ table: () => table(rows), close: async () => undefined }) } : undefined),
    inject: () => undefined,
    commands: { register: () => () => undefined },
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
    home,
    rows,
    dispatch: event => {
      const handlers = listeners.get('session/event')
      if (handlers === undefined) throw new Error('thread-sidebar registered no session/event listener')
      for (const handler of handlers) handler({ id: 'session-1' }, event)
    },
  }
}

const turnEnd = (kind: string): unknown => ({ type: 'turn/end', seq: 16, time: 1_700_000_000_000, data: { turn: 1, reason: { kind } } })

const inflightSessionIds = async (home: string): Promise<string[]> => (await InflightTurns.open({ home }).list()).map(entry => entry.sessionId)

afterEach(async () => {
  vi.restoreAllMocks()
  if (previousDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousDshHome
  await Promise.all(temporaryHomes.splice(0).map(home => rm(home, { recursive: true, force: true })))
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

  it('records an open turn and clears it when the turn ends', async () => {
    const harness = await startHarness()

    harness.dispatch({ type: 'turn/start', seq: 4, time: 1, data: { turn: 1 } })
    await vi.waitFor(async () => expect(await inflightSessionIds(harness.home)).toEqual(['session-1']))

    harness.dispatch(turnEnd('completed'))
    await vi.waitFor(async () => expect(await inflightSessionIds(harness.home)).toEqual([]))
    expect(await createRestartRecoveryStore({ home: harness.home }).list()).toEqual([])
  })

  it('keeps a resume row when crash recovery closes the turn before the boot promotion reads it', async () => {
    const harness = await startHarness()

    harness.dispatch({ type: 'turn/start', seq: 4, time: 1, data: { turn: 1 } })
    await vi.waitFor(async () => expect(await inflightSessionIds(harness.home)).toEqual(['session-1']))

    harness.dispatch(turnEnd('interrupted'))
    await vi.waitFor(async () => {
      const entries = await createRestartRecoveryStore({ home: harness.home }).list()
      expect(entries).toEqual([expect.objectContaining({ sessionId: 'session-1', reason: 'interrupted' })])
    })
    expect(await inflightSessionIds(harness.home)).toEqual([])
  })

  it('keeps the marker of a turn its own shutdown cut off, so the next process can resume it', async () => {
    const harness = await startHarness()
    harness.dispatch({ type: 'turn/start', seq: 4, time: 1, data: { turn: 1 } })
    await vi.waitFor(async () => expect(await inflightSessionIds(harness.home)).toEqual(['session-1']))

    harness.dispatch({ type: 'turn/end', seq: 5, time: 2, data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'disposed' } } } })
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(await inflightSessionIds(harness.home)).toEqual(['session-1'])
    expect(await createRestartRecoveryStore({ home: harness.home }).list()).toEqual([])

    harness.dispatch({ type: 'turn/start', seq: 6, time: 3, data: { turn: 2 } })
    harness.dispatch({ type: 'turn/end', seq: 7, time: 4, data: { turn: 2, reason: { kind: 'aborted', reason: { kind: 'user' } } } })
    await vi.waitFor(async () => expect(await inflightSessionIds(harness.home)).toEqual([]))
  })

  it('promotes the turns a previous process left open as interrupted recoveries', async () => {
    const harness = await startHarness(async home => {
      await mkdir(join(home, 'runtime'), { recursive: true })
      await writeFile(InflightTurns.filePath(home), `${JSON.stringify({ version: 1, entries: [{ sessionId: 'crashed-thread', startedAt: 1 }] })}\n`)
    })

    await vi.waitFor(async () => {
      const entries = await createRestartRecoveryStore({ home: harness.home }).list()
      expect(entries).toEqual([expect.objectContaining({ sessionId: 'crashed-thread', reason: 'interrupted' })])
    })
    expect(await inflightSessionIds(harness.home)).toEqual([])
  })
})
