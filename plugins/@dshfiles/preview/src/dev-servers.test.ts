import { describe, expect, it } from 'vitest'
import { DevServers, type ProcessRow } from './dev-servers.js'

const HOST = 500
const started = Date.parse('Thu Oct 29 21:00:00 2026')

const rows: ProcessRow[] = [
  { pid: 1, ppid: 0, startedAt: started, command: '/sbin/launchd' },
  { pid: 400, ppid: 1, startedAt: started, command: 'supervisor' },
  { pid: HOST, ppid: 400, startedAt: started, command: 'node dsh web' },
  { pid: 600, ppid: HOST, startedAt: started + 10_000, command: '/bin/bash -c pnpm dev' },
  { pid: 601, ppid: 600, startedAt: started + 10_200, command: 'node /repo/node_modules/.bin/vite' },
  { pid: 700, ppid: 1, startedAt: started + 20_000, command: 'python3 -m http.server 8123' },
  { pid: 800, ppid: 1, startedAt: started, command: '/usr/local/bin/postgres -D /data' },
]

const sessions = [
  { sessionId: 'session-a', cwd: '/repo-threads/a' },
  { sessionId: 'session-b', cwd: '/repo-threads/b' },
  { sessionId: 'session-main-1', cwd: '/repo' },
  { sessionId: 'session-main-2', cwd: '/repo' },
]

describe('listener parsing', () => {
  it('reads lsof -F pn records, including IPv6 and wildcard binds', () => {
    expect(DevServers.parseLsofListeners('p601\nf23\nn*:5173\nf24\nn[::1]:5174\np700\nf3\nn127.0.0.1:8123\n')).toEqual([
      { pid: 601, address: '*', port: 5173 },
      { pid: 601, address: '::1', port: 5174 },
      { pid: 700, address: '127.0.0.1', port: 8123 },
    ])
  })

  it('reads ss -ltnpH lines with every owning pid', () => {
    expect(DevServers.parseSsListeners('LISTEN 0 511 127.0.0.1:5173 0.0.0.0:* users:(("node",pid=601,fd=20),("node",pid=602,fd=20))\n')).toEqual([
      { pid: 601, address: '127.0.0.1', port: 5173 },
      { pid: 602, address: '127.0.0.1', port: 5173 },
    ])
  })

  it('reads ps lstart rows', () => {
    expect(DevServers.parsePs('  601   600 Thu Oct 29 21:00:10 2026 node vite\n')).toEqual([
      { pid: 601, ppid: 600, startedAt: started + 10_000, command: 'node vite' },
    ])
  })
})

describe('attributeDevServers', () => {
  const attribute = (overrides: Partial<Parameters<typeof DevServers.attribute>[0]> = {}) =>
    DevServers.attribute({
      sockets: [
        { pid: 601, address: '*', port: 5173 },
        { pid: 700, address: '127.0.0.1', port: 8123 },
        { pid: 800, address: '127.0.0.1', port: 5432 },
        { pid: HOST, address: '127.0.0.1', port: 3080 },
        { pid: 400, address: '127.0.0.1', port: 3081 },
      ],
      rows,
      cwds: new Map([
        [601, '/repo-threads/a/web'],
        [700, '/repo-threads/b'],
        [800, '/data'],
      ]),
      hostPid: HOST,
      home: '/home/me',
      sessions,
      jobs: [{ id: 'bash-1', label: 'pnpm dev', owner: 'session-a', startedAt: started + 10_050 }],
      ...overrides,
    })

  it('attributes a Host job’s descendant to the job owner and an orphan to the thread whose workspace holds it', () => {
    const servers = attribute()
    expect(servers.map(server => ({ pid: server.pid, sessionIds: server.sessionIds, attribution: server.attribution, jobId: server.jobId }))).toEqual([
      { pid: 601, sessionIds: ['session-a'], attribution: 'job', jobId: 'bash-1' },
      { pid: 700, sessionIds: ['session-b'], attribution: 'workspace', jobId: null },
    ])
    expect(servers[0]?.ports).toEqual([{ address: '*', port: 5173, url: 'http://localhost:5173/' }])
    expect(servers[1]?.name).toBe('python3')
  })

  it('never lists the Host or the supervisor that launched it, nor sockets outside every thread workspace', () => {
    const pids = attribute().map(server => server.pid)
    expect(pids).not.toContain(HOST)
    expect(pids).not.toContain(400)
    expect(pids).not.toContain(800)
  })

  it('lists every thread sharing a checkout when no job names the owner', () => {
    const servers = attribute({ jobs: [], cwds: new Map([[601, '/repo/web']]) })
    expect(servers.find(server => server.pid === 601)?.sessionIds).toEqual(['session-main-1', 'session-main-2'])
  })

  it('falls back to the workspace when the job started too far from the process', () => {
    const servers = attribute({ jobs: [{ id: 'bash-1', label: 'pnpm dev', owner: 'session-b', startedAt: started }] })
    expect(servers.find(server => server.pid === 601)).toMatchObject({ sessionIds: ['session-a'], attribution: 'workspace', jobId: null })
  })
})
