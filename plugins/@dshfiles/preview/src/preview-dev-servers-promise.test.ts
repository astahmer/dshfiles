import { DshxEffect, HostContext } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { PreviewDevServers, type ProbeExec } from './preview-dev-servers-promise.js'

const outputs = {
  ps: ['  500     1 Thu Oct 29 21:00:00 2026 node dsh web', '  700     1 Thu Oct 29 21:05:00 2026 python3 -m http.server 8123'].join('\n'),
}

/** Linux lists listening sockets with `ss`, macOS with `lsof`; the fake answers whichever this platform asks for. */
const socketTool = process.platform === 'linux' ? 'ss' : 'lsof'
const socketOutput =
  socketTool === 'ss'
    ? 'LISTEN 0 511 127.0.0.1:3080 0.0.0.0:* users:(("node",pid=500,fd=20))\nLISTEN 0 511 127.0.0.1:8123 0.0.0.0:* users:(("python3",pid=700,fd=3))\n'
    : 'p500\nf20\nn127.0.0.1:3080\np700\nf3\nn127.0.0.1:8123\n'

const fakeExec =
  (calls: string[]): ProbeExec =>
  async (command, args) => {
    calls.push(`${command} ${args.join(' ')}`)
    if (command === 'lsof' && args.includes('cwd')) return 'p700\nfcwd\nn/repo-threads/b\n'
    if (command === socketTool) return socketOutput
    return command === 'ps' ? outputs.ps : ''
  }

const readCwdLink = (path: string) => Effect.succeed(path === '/proc/700/cwd' ? '/repo-threads/b' : '/')

/** A Host context whose one Session's checkout holds the python server's cwd, counting the corpus folds. */
const contextOf = (input: {
  readonly list: () => Promise<{ items: readonly { readonly sessionId: string; readonly cwd: string }[] }>
  readonly onList: () => void
}) => ({
  get: (name: string) =>
    name === 'sessionController'
      ? {
          list: async () => {
            input.onList()
            return input.list()
          },
        }
      : undefined,
  inject: () => undefined,
})

const layerFor = (input: { readonly exec: ProbeExec; readonly ctx?: unknown }) =>
  PreviewDevServers.makeLayer({ exec: input.exec, readCwdLink }).pipe(
    Layer.provide(
      HostContext.layer({
        ctx: (input.ctx ?? contextOf({ list: async () => ({ items: [] }), onList: () => undefined })) as never,
        packageId: '@dshfiles/preview',
      }),
    ),
    Layer.provide(nodeFileSystemLayer),
  )

const oneSession = async () => ({ items: [{ sessionId: 'session-b', cwd: '/repo-threads/b' }] })

describe('PreviewDevServers', () => {
  it.effect('runs each probe command under a preview port-probe span and caches one probe for every caller', () => {
    const calls: string[] = []
    const recorder = recordSpans()
    return Effect.gen(function* () {
      const servers = yield* PreviewDevServers
      const [first, second] = yield* Effect.all([servers.read(false), servers.read(false)], { concurrency: 'unbounded' })

      expect(first).toBe(second)
      expect(first.servers.map(server => ({ pid: server.pid, ports: server.ports.map(port => port.port), sessionIds: server.sessionIds }))).toEqual([
        { pid: 700, ports: [8123], sessionIds: ['session-b'] },
      ])
      // Linux reads /proc/<pid>/cwd instead of a second lsof pass.
      expect(calls).toHaveLength(process.platform === 'linux' ? 2 : 3)
      expect(recorder.named('preview port-probe').map(span => span.attributes['process.executable.name'])).toEqual(expect.arrayContaining([socketTool, 'ps']))
      expect(recorder.named('preview session-list')).toHaveLength(1)
    }).pipe(
      Effect.provide(layerFor({ exec: fakeExec(calls), ctx: contextOf({ list: oneSession, onList: () => undefined }) })),
      Effect.provide(DshxEffect.tracerLayer),
      Effect.ensuring(Effect.sync(() => recorder.stop())),
    )
  })

  it.effect('reports an unsupported platform instead of an empty list', () =>
    Effect.gen(function* () {
      const servers = yield* PreviewDevServers
      const probe = yield* servers.read(true)
      expect(probe.supported).toBe(process.platform === 'darwin' || process.platform === 'linux')
    }).pipe(Effect.provide(layerFor({ exec: fakeExec([]) }))),
  )

  it.effect('skips the process table, cwd probes and Session fold when nothing is listening', () => {
    const calls: string[] = []
    const exec: ProbeExec = async (command, args) => {
      calls.push(`${command} ${args.join(' ')}`)
      if (command === 'lsof' && args.includes('cwd')) throw new Error('the cwd probe must not run for an empty socket list')
      if (command === 'ps') throw new Error('the process table must not run for an empty socket list')
      return ''
    }
    let listed = 0
    const quietContext = contextOf({
      list: async () => ({ items: [] }),
      onList: () => {
        listed += 1
      },
    })
    return Effect.gen(function* () {
      const servers = yield* PreviewDevServers
      const probe = yield* servers.read(true)
      expect(probe).toEqual({ supported: true, servers: [] })
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatch(new RegExp(`^${socketTool} `))
      expect(listed).toBe(0)
    }).pipe(Effect.provide(layerFor({ exec, ctx: quietContext })))
  })

  it.effect('shares one round across the polls of a window and folds the Session list only after its own TTL', () => {
    const calls: string[] = []
    let listed = 0
    const context = contextOf({
      list: oneSession,
      onList: () => {
        listed += 1
      },
    })
    const rounds = () => calls.filter(call => call.startsWith(`${socketTool} `) && !call.includes('-d cwd')).length
    return Effect.gen(function* () {
      const servers = yield* PreviewDevServers
      yield* servers.read(false)
      yield* servers.read(false)
      yield* servers.read(false)
      // Three thread polls inside the round TTL are one `lsof`/`ps` round and one Session fold.
      expect(rounds()).toBe(1)
      expect(listed).toBe(1)

      yield* TestClock.adjust('9 seconds')
      yield* servers.read(false)
      expect(rounds()).toBe(2)
      // Session directories change when a thread moves, not every poll: the fold outlives several rounds.
      expect(listed).toBe(1)

      yield* TestClock.adjust('5 minutes')
      yield* servers.read(false)
      expect(listed).toBe(2)
    }).pipe(Effect.provide(layerFor({ exec: fakeExec(calls), ctx: context })))
  })

  it.effect('costs one probe round per window and a handful of Session folds for four open threads over 30 idle minutes', () => {
    const calls: string[] = []
    let listed = 0
    const context = contextOf({
      list: oneSession,
      onList: () => {
        listed += 1
      },
    })
    const rounds = () => calls.filter(call => call.startsWith(`${socketTool} `) && !call.includes('-d cwd')).length
    const offsets = [0, 2_500, 5_000, 7_500]
    return Effect.gen(function* () {
      const servers = yield* PreviewDevServers
      // Four open threads poll every 10 s, a quarter window apart; each thread's poll is a read of the same round.
      for (let elapsed = 0; elapsed < 1_800_000; elapsed += 2_500) {
        if (elapsed > 0) yield* TestClock.adjust(Duration.millis(2_500))
        for (const offset of offsets) {
          if (elapsed >= offset && (elapsed - offset) % 10_000 === 0) yield* servers.read(false)
        }
      }
      // 720 thread polls in 30 minutes; a 9 s round is one per 10 s poll window, not one per thread.
      expect(rounds()).toBe(180)
      expect(listed).toBe(6)
    }).pipe(Effect.provide(layerFor({ exec: fakeExec(calls), ctx: context })))
  })

  it.effect('keeps the listener list when the Session fold fails, then attributes again with the next one', () => {
    const calls: string[] = []
    let failing = true
    const context = contextOf({
      list: async () => {
        if (failing) throw new Error('session controller timed out')
        return oneSession()
      },
      onList: () => undefined,
    })
    return Effect.gen(function* () {
      const servers = yield* PreviewDevServers
      const unattributed = yield* servers.read(false)
      expect(unattributed.supported).toBe(true)
      expect(unattributed.servers).toEqual([])

      failing = false
      yield* TestClock.adjust('9 seconds')
      const attributed = yield* servers.read(false)
      expect(attributed.servers.map(server => server.sessionIds)).toEqual([['session-b']])
      expect(calls.length).toBeGreaterThan(0)
    }).pipe(Effect.provide(layerFor({ exec: fakeExec(calls), ctx: context })))
  })
})
