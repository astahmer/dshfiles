import { DshxEffect, HostContext } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { PreviewDevServers, type ProbeExec } from './preview-dev-servers-promise.js'

const outputs = {
  ps: ['  500     1 Thu Oct 29 21:00:00 2026 node dsh web', '  700     1 Thu Oct 29 21:05:00 2026 python3 -m http.server 8123'].join('\n'),
}

const fakeExec =
  (calls: string[]): ProbeExec =>
  async (command, args) => {
    calls.push(`${command} ${args.join(' ')}`)
    if (command === 'lsof' && args.includes('cwd')) return 'p700\nfcwd\nn/repo-threads/b\n'
    if (command === 'lsof') return 'p500\nf20\nn127.0.0.1:3080\np700\nf3\nn127.0.0.1:8123\n'
    return command === 'ps' ? outputs.ps : ''
  }

/** The Host context a probe reads: one Session whose checkout holds the python server's cwd. */
const testContext = {
  get: (name: string) => (name === 'sessionController' ? { list: async () => ({ items: [{ sessionId: 'session-b', cwd: '/repo-threads/b' }] }) } : undefined),
  inject: () => undefined,
}

const probeLayer = (exec: ProbeExec) =>
  PreviewDevServers.makeLayer({ exec }).pipe(
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
      expect(calls).toHaveLength(3)
      expect(recorder.named('preview port-probe').map(span => span.attributes['process.executable.name'])).toEqual(expect.arrayContaining(['lsof', 'ps']))
    }).pipe(Effect.provide(probeLayer(fakeExec(calls))), Effect.provide(DshxEffect.tracerLayer), Effect.ensuring(Effect.sync(() => recorder.stop())))
  })

  it.effect('reports an unsupported platform instead of an empty list', () =>
    Effect.gen(function* () {
      const servers = yield* PreviewDevServers
      const probe = yield* servers.read(true)
      expect(probe.supported).toBe(process.platform === 'darwin' || process.platform === 'linux')
    }).pipe(Effect.provide(probeLayer(fakeExec([])))),
  )
})
