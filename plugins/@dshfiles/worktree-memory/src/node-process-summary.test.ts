import { describe, expect, it } from 'vitest'
import type { ProcessRow } from './process-table.js'
import { nodeProcessCwdPids, summarizeNodeProcesses } from './node-process-summary.js'

const startedAt = Date.parse('Mon Oct 19 14:00:00 2026')
const row = (pid: number, ppid: number, rssKb: number, command: string): ProcessRow => ({ pid, ppid, rssKb, startedAt, command })

describe('Node process summary', () => {
  it('groups Node processes by known script, nearest app, and working directory without returning argv', () => {
    const rows = [
      row(500, 1, 1_000, '/Users/me/Applications/Zed.app/Contents/MacOS/zed'),
      row(501, 500, 1_000, '/opt/node/bin/node /Users/me/.cache/vtsls/bin/vtsls.js --stdio'),
      row(502, 501, 512, '/opt/node/bin/node --max-old-space-size=8192 /Users/me/dev/app/node_modules/typescript/lib/tsserver.js --token private-token'),
      row(503, 501, 256, '/opt/node/bin/node --max-old-space-size=8192 /Users/me/dev/app/node_modules/typescript/lib/tsserver.js --token private-token'),
      row(504, 500, 128, '/opt/node/bin/node /Users/me/.bin/tailwindcss-language-server --stdio'),
      row(505, 500, 64, "/opt/node/bin/node -e 'private-token'"),
      row(506, 500, 4_096, '/usr/bin/python3 --credential private-token'),
    ]
    const summary = summarizeNodeProcesses({
      rows,
      cwds: new Map([
        [502, '/Users/me/dev/app'],
        [503, '/Users/me/dev/app'],
        [504, '/Users/me/dev/app'],
        [505, '/Users/me/dev/app'],
      ]),
      home: '/Users/me',
    })

    expect(summary).toMatchObject({
      processCount: 5,
      rssBytes: 2_007_040,
      truncated: false,
      origins: [
        { name: 'vtsls language server', source: 'Zed', cwd: null, processCount: 1, rssBytes: 1_024_000 },
        { name: 'TypeScript server', source: 'Zed', cwd: '~/dev/app', processCount: 2, rssBytes: 786_432 },
        { name: 'Tailwind CSS server', source: 'Zed', cwd: '~/dev/app', processCount: 1, rssBytes: 131_072 },
        { name: 'Node process', source: 'Zed', cwd: '~/dev/app', processCount: 1, rssBytes: 65_536 },
      ],
    })
    expect(nodeProcessCwdPids({ rows, limit: 2 })).toEqual([501, 502])
    expect(JSON.stringify(summary)).not.toContain('private-token')
  })

  it('uses the immediate parent executable when no application ancestor exists', () => {
    const summary = summarizeNodeProcesses({
      rows: [row(600, 1, 1, '/bin/zsh --secret private-token'), row(601, 600, 8, '/opt/node/bin/node --watch src/main.ts')],
      cwds: new Map([[601, '/Users/me/dev/app']]),
      home: '/Users/me',
    })

    expect(summary.origins).toMatchObject([{ name: 'Node process', source: 'zsh', cwd: '~/dev/app', processCount: 1 }])
    expect(JSON.stringify(summary)).not.toContain('private-token')
  })

  it('caps origin details while retaining the totals for every Node process', () => {
    const rows = Array.from({ length: 101 }, (_, index) => row(index + 700, 1, index + 1, '/opt/node/bin/node --watch src/main.ts'))
    const summary = summarizeNodeProcesses({
      rows,
      cwds: new Map(rows.map(processRow => [processRow.pid, `/tmp/project-${String(processRow.pid)}`])),
      home: '/Users/me',
    })

    expect(summary).toMatchObject({ processCount: 101, rssBytes: 5_274_624, truncated: true })
    expect(summary.origins).toHaveLength(100)
  })
})
