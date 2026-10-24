import { describe, expect, it } from 'vitest'
import { ProcessTable, type ProcessRow, type SnapshotInput } from './process-table.js'

const HOST = 500
const T0 = Date.parse('Mon Oct 19 14:00:00 2026')

const row = (pid: number, ppid: number, rssKb: number, command: string, startedAt = T0): ProcessRow => ({ pid, ppid, rssKb, startedAt, command })

const baseInput = (overrides: Partial<SnapshotInput>): SnapshotInput => ({
  rows: [],
  cwds: new Map(),
  hostPid: HOST,
  home: '/home/me',
  now: T0 + 60_000,
  workspaces: [
    { path: '/dev/app', title: 'app' },
    { path: '/dev/app-threads/thread-a', title: 'Fix login' },
  ],
  sessions: [],
  jobs: [],
  pressure: 'normal',
  systemBytes: 32 * 1024 ** 3,
  ...overrides,
})

describe('ProcessTable', () => {
  it('parses ps rows with their start time and full arguments', () => {
    const rows = ProcessTable.parsePs(
      [
        '  501     1  10240 Mon Oct 19 14:02:03 2026     node /x/node_modules/vite/bin/vite.js --port 5173',
        'garbage line',
        '  502   501   2048 Mon Oct  5 09:00:00 2026     bash -c set -o pipefail\\012pnpm test',
      ].join('\n'),
    )
    expect(rows).toEqual([
      { pid: 501, ppid: 1, rssKb: 10240, startedAt: Date.parse('Mon Oct 19 14:02:03 2026'), command: 'node /x/node_modules/vite/bin/vite.js --port 5173' },
      { pid: 502, ppid: 501, rssKb: 2048, startedAt: Date.parse('Mon Oct 5 09:00:00 2026'), command: 'bash -c set -o pipefail\\012pnpm test' },
    ])
  })

  it('accounts a job tree to its thread workspace and names the heaviest process', () => {
    const snapshot = ProcessTable.snapshot(
      baseInput({
        rows: [
          row(HOST, 1, 300_000, 'node /g/node_modules/@deepseek-ai/dsh/lib/bin.js web'),
          row(600, HOST, 4_000, 'bash -c set -o pipefail\\012pnpm vitest run src/a.test.ts'),
          row(601, 600, 400_000, 'node /dev/app/node_modules/vitest/vitest.mjs run src/a.test.ts'),
          row(602, 601, 100_000, 'node /dev/app/node_modules/vitest/dist/worker.js'),
        ],
        cwds: new Map([[600, '/dev/app-threads/thread-a/packages/web']]),
        jobs: [{ id: 'bash-1', label: 'pnpm vitest run src/a.test.ts', owner: 'session-a', startedAt: T0 + 400 }],
        sessions: [{ sessionId: 'session-a', cwd: '/dev/app-threads/thread-a', running: true, updatedAt: T0, title: 'Fix login' }],
      }),
    )
    expect(snapshot.hostBytes).toBe(300_000 * 1024)
    expect(snapshot.groups).toHaveLength(1)
    const group = snapshot.groups[0]
    expect(group).toMatchObject({ key: '/dev/app-threads/thread-a', kind: 'workspace', project: 'app', bytes: 504_000 * 1024, threadCount: 1 })
    expect(group?.trees[0]).toMatchObject({
      pid: 600,
      origin: 'job',
      jobId: 'bash-1',
      sessionId: 'session-a',
      ownerRunning: true,
      name: 'vitest run',
      category: 'tests',
      processCount: 3,
      command: 'pnpm vitest run src/a.test.ts',
      cwd: '/dev/app-threads/thread-a/packages/web',
    })
    expect(snapshot.categoryBytes.tests).toBe(504_000 * 1024)
  })

  it('marks a job tree whose thread finished its turn as safe for a bulk stop', () => {
    const snapshot = ProcessTable.snapshot(
      baseInput({
        rows: [row(HOST, 1, 1, 'dsh'), row(650, HOST, 2_000, 'bash -c pnpm lint')],
        cwds: new Map([[650, '/dev/app']]),
        jobs: [{ id: 'bash-idle', label: 'pnpm lint', owner: 'session-idle', startedAt: T0 + 500 }],
        sessions: [{ sessionId: 'session-idle', cwd: '/dev/app', running: false, updatedAt: T0, title: 'Lint pass' }],
      }),
    )
    expect(snapshot.groups[0]?.trees[0]).toMatchObject({ pid: 650, origin: 'job', jobId: 'bash-idle', ownerRunning: false })
  })

  it('counts orphans inside a jj sibling checkout as detached and ignores orphans outside every workspace', () => {
    const snapshot = ProcessTable.snapshot(
      baseInput({
        rows: [
          row(HOST, 1, 1, 'dsh'),
          row(700, 1, 70_000, 'node /g/node_modules/@deepseek-ai/dsh/lib/bin.js --profile dshx-boot --port 5000'),
          row(701, 1, 90_000, 'node /home/me/scratch/server.js'),
          row(702, 1, 50_000, '/Applications/Slack.app/Contents/MacOS/Slack'),
        ],
        cwds: new Map([
          [700, '/dev/app-guardrails'],
          [701, '/home/me/scratch'],
        ]),
      }),
    )
    expect(snapshot.groups.map(group => group.key)).toEqual(['/dev/app-guardrails'])
    expect(snapshot.groups[0]).toMatchObject({ kind: 'workspace', project: 'app', detachedCount: 1, detachedBytes: 70_000 * 1024 })
    expect(snapshot.groups[0]?.trees[0]).toMatchObject({ origin: 'detached', category: 'dsh', name: 'dsh dshx-boot' })
    expect(snapshot.detachedCount).toBe(1)
  })

  it('treats a systemd --user subreaper as the adopter of a detached tree', () => {
    const snapshot = ProcessTable.snapshot(
      baseInput({
        rows: [
          row(HOST, 1, 1, 'dsh'),
          row(300, 1, 8_000, '/usr/lib/systemd/systemd --user'),
          row(301, 300, 50_000, 'node /dev/app/node_modules/vite/bin/vite.js'),
        ],
        cwds: new Map([[301, '/dev/app']]),
      }),
    )
    expect(snapshot.groups[0]?.trees[0]).toMatchObject({ pid: 301, origin: 'detached', category: 'dev-server' })
  })

  it('never offers the supervisor that launched this Host as a detached tree', () => {
    const snapshot = ProcessTable.snapshot(
      baseInput({
        rows: [row(400, 1, 9_000, 'node /dev/app/scripts/supervise-web.mjs'), row(HOST, 400, 1, 'dsh'), row(401, HOST, 1, 'bash -c pnpm dev')],
        cwds: new Map([
          [400, '/dev/app'],
          [401, '/dev/app'],
        ]),
      }),
    )
    expect(snapshot.detachedCount).toBe(0)
    expect(snapshot.groups[0]?.trees.map(tree => tree.pid)).toEqual([401])
  })

  it('keeps Host children outside every workspace in a trailing elsewhere group', () => {
    const snapshot = ProcessTable.snapshot(
      baseInput({
        rows: [row(HOST, 1, 1, 'dsh'), row(800, HOST, 10_000, '/bin/zsh -l'), row(801, HOST, 5_000, 'node /dev/app/scripts/dev.mjs')],
        cwds: new Map([
          [800, '/home/me/notes'],
          [801, '/dev/app'],
        ]),
      }),
    )
    expect(snapshot.groups.map(group => [group.key, group.kind])).toEqual([
      ['/dev/app', 'project'],
      ['__elsewhere__', 'elsewhere'],
    ])
    expect(snapshot.groups[1]?.trees[0]).toMatchObject({ origin: 'host', name: 'zsh', cwd: '~/notes' })
  })

  it('does not hand one job to two process trees started in the same second', () => {
    const snapshot = ProcessTable.snapshot(
      baseInput({
        rows: [row(HOST, 1, 1, 'dsh'), row(900, HOST, 1, 'bash -c pnpm lint'), row(901, HOST, 1, 'bash -c pnpm typecheck')],
        cwds: new Map([
          [900, '/dev/app'],
          [901, '/dev/app'],
        ]),
        jobs: [{ id: 'bash-tc', label: 'pnpm typecheck', owner: 'session-b', startedAt: T0 }],
      }),
    )
    const byPid = new Map(snapshot.groups[0]?.trees.map(tree => [tree.pid, tree]))
    expect(byPid.get(901)).toMatchObject({ origin: 'job', jobId: 'bash-tc' })
    expect(byPid.get(900)).toMatchObject({ origin: 'host', jobId: null })
  })

  it('orders a tree children first so a stop never leaves a parent to respawn a child', () => {
    const rows = [row(1000, 1, 1, 'a'), row(1001, 1000, 1, 'b'), row(1002, 1001, 1, 'c'), row(1003, 1000, 1, 'd')]
    expect(ProcessTable.treePids(rows, 1000)).toEqual([1002, 1001, 1003, 1000])
  })

  it('names node scripts after their package', () => {
    expect(ProcessTable.shortName('node /g/node_modules/@deepseek-ai/dsh/lib/bin.js web --port 3080')).toBe('dsh web')
    expect(ProcessTable.shortName('/usr/local/bin/node --max-old-space-size=4096 /r/node_modules/typescript/lib/tsc.js -p .')).toBe('typescript')
    expect(ProcessTable.shortName('fnm exec --using=22 node tooling/dshx/packages/dshx/dist/cli/bin.js dev open x')).toBe('dshx dev')
    expect(ProcessTable.shortName('/opt/homebrew/opt/postgresql@16/bin/postgres -D /data')).toBe('postgres')
  })
})
