import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from 'vitest'
import { DevServerProbes, type Exec } from './dev-server-probe.js'

const HOST = 500

const outputs = {
  lsof: '',
  ps: [`  ${String(HOST)}     1 Thu Oct 29 21:00:00 2026 node dsh web`, '  700     1 Thu Oct 29 21:05:00 2026 python3 -m http.server 8123'].join('\n'),
} satisfies Record<string, string>

const fakeExec =
  (calls: string[]): Exec =>
  async (command, args) => {
    calls.push(`${command} ${args.join(' ')}`)
    if (command === 'lsof' && args.includes('cwd')) return 'p700\nfcwd\nn/repo-threads/b\n'
    if (command === 'lsof') return `p${String(HOST)}\nf20\nn127.0.0.1:3080\np700\nf3\nn127.0.0.1:8123\n`
    return command === 'ps' ? outputs.ps : outputs.lsof
  }

describe('createDevServerProbe', () => {
  it('runs each probe command under a preview port-probe span and caches one probe for every caller', async () => {
    using recorder = recordSpans()
    const calls: string[] = []
    const probe = DevServerProbes.create({
      exec: fakeExec(calls),
      platform: 'darwin',
      hostPid: HOST,
      sessions: async () => [{ sessionId: 'session-b', cwd: '/repo-threads/b' }],
      jobs: () => [],
    })
    const [first, second] = await Promise.all([probe.read(false), probe.read(false)])
    expect(first).toBe(second)
    expect(first.servers.map(server => ({ pid: server.pid, ports: server.ports.map(port => port.port), sessionIds: server.sessionIds }))).toEqual([
      { pid: 700, ports: [8123], sessionIds: ['session-b'] },
    ])
    expect(calls).toHaveLength(3)
    expect(recorder.named('preview port-probe').map(span => span.attributes['process.executable.name'])).toEqual(expect.arrayContaining(['lsof', 'ps']))
  })

  it('reports an unsupported platform instead of an empty list', async () => {
    const probe = DevServerProbes.create({ exec: fakeExec([]), platform: 'win32', hostPid: HOST, sessions: async () => [], jobs: () => [] })
    expect(await probe.read(true)).toEqual({ supported: false, servers: [] })
  })
})
