import { DshxEffect, HostContext } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
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

/** The Host context a probe reads: one Session whose checkout holds the python server's cwd. */
const testContext = {
  get: (name: string) => (name === 'sessionController' ? { list: async () => ({ items: [{ sessionId: 'session-b', cwd: '/repo-threads/b' }] }) } : undefined),
  inject: () => undefined,
}

const readCwdLink = (path: string) => Effect.succeed(path === '/proc/700/cwd' ? '/repo-threads/b' : '/')

const probeLayer = (exec: ProbeExec) =>
  PreviewDevServers.makeLayer({ exec, readCwdLink }).pipe(
    Layer.provide(HostContext.layer({ ctx: testContext as never, packageId: '@dshfiles/preview' })),
    Layer.provide(nodeFileSystemLayer),
  )

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
    }).pipe(Effect.provide(probeLayer(fakeExec(calls))), Effect.provide(DshxEffect.tracerLayer), Effect.ensuring(Effect.sync(() => recorder.stop())))
  })

  it.effect('reports an unsupported platform instead of an empty list', () =>
    Effect.gen(function* () {
      const servers = yield* PreviewDevServers
      const probe = yield* servers.read(true)
      expect(probe.supported).toBe(process.platform === 'darwin' || process.platform === 'linux')
    }).pipe(Effect.provide(probeLayer(fakeExec([])))),
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
    const quietContext = {
      get: (name: string) =>
        name === 'sessionController'
          ? {
              list: async () => {
                listed += 1
                return { items: [] }
              },
            }
          : undefined,
      inject: () => undefined,
    }
    const layer = PreviewDevServers.makeLayer({ exec }).pipe(
      Layer.provide(HostContext.layer({ ctx: quietContext as never, packageId: '@dshfiles/preview' })),
      Layer.provide(nodeFileSystemLayer),
    )
    return Effect.gen(function* () {
      const servers = yield* PreviewDevServers
      const probe = yield* servers.read(true)
      expect(probe).toEqual({ supported: true, servers: [] })
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatch(new RegExp(`^${socketTool} `))
      expect(listed).toBe(0)
    }).pipe(Effect.provide(layer))
  })
})
