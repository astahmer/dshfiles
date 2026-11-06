import { Option } from 'effect'
import { describe, expect, it } from 'vitest'
import { orphanAlertVisible } from './orphan-alert.js'
import { ScratchHostDetector, type ScratchProcessRow, type ScratchRecord } from './scratch-hosts.js'
import type { ScratchHosts } from './types.js'

const HOST = 500
const T0 = Date.parse('Fri Nov 06 09:00:00 2026')
const NOW = T0 + 3 * 60 * 60 * 1000
const ALERT = { cpuPercent: 50, memoryBytes: 1024 ** 3 }

const row = (input: Partial<ScratchProcessRow> & Pick<ScratchProcessRow, 'pid' | 'ppid' | 'command'>): ScratchProcessRow => ({
  pgid: input.pid,
  rssKb: 100 * 1024,
  cpuPercent: 0,
  startedAt: T0,
  ...input,
})

const dsh = (pid: number, ppid: number, port: number, extra: Partial<ScratchProcessRow> = {}): ScratchProcessRow =>
  row({ pid, ppid, command: `node /x/node_modules/@deepseek-ai/dsh/lib/bin.js --profile dshx-boot --port ${String(port)} --no-open`, ...extra })

const record = (input: Partial<ScratchRecord> & Pick<ScratchRecord, 'hostPid' | 'ownerPid'>): ScratchRecord => ({
  hostStartedAt: T0 + 400,
  ownerStartedAt: T0 + 300,
  workspace: '/dev/app-threads/oc-ui',
  kind: 'dev',
  command: 'dshx dev up --name oc-ui',
  ...input,
})

const live = row({ pid: HOST, ppid: 1, command: 'node /x/dsh/lib/bin.js --profile web --port 3080' })

describe('ScratchHostDetector.detect', () => {
  it('labels a recorded Host by its live owner and flags one whose owner is dead or recycled', () => {
    const owner = row({ pid: 900, ppid: 1, command: 'node dshx dev up', startedAt: T0 })
    const recycled = row({ pid: 901, ppid: 1, command: 'zsh', startedAt: T0 + 60_000 })
    const rows = [
      live,
      owner,
      recycled,
      dsh(1001, 900, 5001),
      dsh(1002, 1, 5002),
      dsh(1003, 1, 5003),
      row({ pid: 1004, ppid: 1003, command: 'chrome', rssKb: 50 * 1024, cpuPercent: 30 }),
    ]
    const records = [record({ hostPid: 1001, ownerPid: 900 }), record({ hostPid: 1002, ownerPid: 777, kind: 'e2e' }), record({ hostPid: 1003, ownerPid: 901 })]

    const result = ScratchHostDetector.detect({ rows, records, now: NOW, hostPid: HOST, alert: ALERT })

    const byPid = new Map(result.hosts.map(host => [host.pid, host]))
    expect(byPid.get(1001)).toMatchObject({
      orphan: false,
      reason: null,
      port: 5001,
      owner: { pid: 900, alive: true, kind: 'dev', workspace: '/dev/app-threads/oc-ui' },
    })
    expect(byPid.get(1002)).toMatchObject({ orphan: true, reason: 'owner-gone', owner: { pid: 777, alive: false, kind: 'e2e' } })
    expect(byPid.get(1003)).toMatchObject({ orphan: true, reason: 'owner-gone', processCount: 2, bytes: 150 * 1024 * 1024, cpuPercent: 30 })
    expect(result.orphanCount).toBe(2)
    expect(result.orphanBytes).toBe(250 * 1024 * 1024)
    expect(result.hosts.map(host => host.orphan)).toEqual([true, true, false])
  })

  it('flags a legacy Host only when init adopted it more than two hours ago', () => {
    const rows = [
      live,
      dsh(2001, 1, 6001),
      dsh(2002, 1, 6002, { startedAt: NOW - 30 * 60 * 1000 }),
      row({ pid: 2100, ppid: 1, command: 'node playwright worker' }),
      dsh(2003, 2100, 6003),
    ]

    const result = ScratchHostDetector.detect({ rows, records: [], now: NOW, hostPid: HOST, alert: ALERT })

    expect(result.hosts.map(host => [host.pid, host.orphan, host.reason, host.owner])).toEqual([
      [2001, true, 'legacy-detached', null],
      [2002, false, null, null],
      [2003, false, null, null],
    ])
  })

  it('ignores a record whose start time does not match the pid it names', () => {
    const rows = [live, dsh(3001, 1, 7001, { startedAt: NOW - 10 * 60 * 1000 })]
    const result = ScratchHostDetector.detect({ rows, records: [record({ hostPid: 3001, ownerPid: 777 })], now: NOW, hostPid: HOST, alert: ALERT })
    expect(result.hosts[0]).toMatchObject({ owner: null, orphan: false })
  })

  it('never lists the serving Host, its supervisor, a non-scratch profile or the node a wrapper runs', () => {
    const supervisor = row({ pid: 400, ppid: 1, command: 'node supervisor --profile dshx-boot' })
    const rows = [
      supervisor,
      { ...live, ppid: 400 },
      row({ pid: 4001, ppid: 1, command: 'node dsh --profile dshx-boot-other' }),
      row({ pid: 4002, ppid: 1, command: 'pnpm exec dsh --profile dshx-boot --port 8001' }),
      dsh(4003, 4002, 8001, { pgid: 4002 }),
    ]
    const result = ScratchHostDetector.detect({ rows, records: [], now: NOW, hostPid: HOST, alert: ALERT })
    expect(result.hosts.map(host => host.pid)).toEqual([4002])
    expect(result.hosts[0]?.processCount).toBe(2)
  })
})

describe('ScratchHostDetector.decodeRecord', () => {
  it('decodes a record file and rejects malformed or foreign JSON', () => {
    const valid = JSON.stringify({ hostPid: 10, hostStartedAt: T0, ownerPid: 11, ownerStartedAt: T0, workspace: '/w', kind: 'e2e', command: 'pnpm check:e2e' })
    expect(Option.getOrNull(ScratchHostDetector.decodeRecord(valid))).toMatchObject({ hostPid: 10, kind: 'e2e' })
    expect(Option.isNone(ScratchHostDetector.decodeRecord('{not json'))).toBe(true)
    expect(Option.isNone(ScratchHostDetector.decodeRecord(JSON.stringify({ hostPid: 10, kind: 'prod' })))).toBe(true)
  })
})

describe('ScratchHostDetector.parsePs', () => {
  it('reads pid, ppid, pgid, rss, cpu, start time and arguments', () => {
    const rows = ScratchHostDetector.parsePs(
      ['  83004     1 83004 204800  12.5 Fri Nov  6 09:00:00 2026     node dsh/lib/bin.js --profile dshx-boot --port 57717', 'garbage'].join('\n'),
    )
    expect(rows).toEqual([
      {
        pid: 83004,
        ppid: 1,
        pgid: 83004,
        rssKb: 204800,
        cpuPercent: 12.5,
        startedAt: Date.parse('Fri Nov 6 09:00:00 2026'),
        command: 'node dsh/lib/bin.js --profile dshx-boot --port 57717',
      },
    ])
  })
})

describe('ScratchHostDetector.guardStop', () => {
  const rows = [
    row({ pid: 400, ppid: 1, command: 'supervisor' }),
    { ...live, ppid: 400 },
    dsh(5001, 1, 9001),
    dsh(5002, 1, 9002, { pgid: 77 }),
    row({ pid: 5003, ppid: 1, command: 'node unrelated --port 9003' }),
  ]

  it('signals a group leader as a group and a member of another group as a tree', () => {
    expect(ScratchHostDetector.guardStop({ target: { pid: 5001, startedAt: T0 }, rows, hostPid: HOST })).toBe('signal-group')
    expect(ScratchHostDetector.guardStop({ target: { pid: 5002, startedAt: T0 }, rows, hostPid: HOST })).toBe('signal-tree')
  })

  it('refuses a gone, recycled or non-scratch pid and never the live Host or its supervisor', () => {
    expect(ScratchHostDetector.guardStop({ target: { pid: 6000, startedAt: T0 }, rows, hostPid: HOST })).toBe('gone')
    expect(ScratchHostDetector.guardStop({ target: { pid: 5001, startedAt: T0 + 1000 }, rows, hostPid: HOST })).toBe('recycled')
    expect(ScratchHostDetector.guardStop({ target: { pid: 5003, startedAt: T0 }, rows, hostPid: HOST })).toBe('not-scratch')
    expect(ScratchHostDetector.guardStop({ target: { pid: HOST, startedAt: T0 }, rows, hostPid: HOST })).toBe('protected')
    expect(ScratchHostDetector.guardStop({ target: { pid: 400, startedAt: T0 }, rows, hostPid: HOST })).toBe('protected')
  })
})

describe('orphanAlertVisible', () => {
  const summary = (input: Partial<ScratchHosts>): ScratchHosts => ({ hosts: [], orphanCount: 1, orphanBytes: 0, orphanCpuPercent: 0, alert: ALERT, ...input })

  it('shows only while orphans reach the CPU or memory threshold', () => {
    expect(orphanAlertVisible(undefined)).toBe(false)
    expect(orphanAlertVisible(summary({ orphanCount: 0, orphanCpuPercent: 400, orphanBytes: 8 * 1024 ** 3 }))).toBe(false)
    expect(orphanAlertVisible(summary({ orphanCpuPercent: 49.9, orphanBytes: 1024 ** 3 - 1 }))).toBe(false)
    expect(orphanAlertVisible(summary({ orphanCpuPercent: 50 }))).toBe(true)
    expect(orphanAlertVisible(summary({ orphanBytes: 1024 ** 3 }))).toBe(true)
  })
})
