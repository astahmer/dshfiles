import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import type { ToolExecutionRow } from './fold.js'
import type { JevUsageRecord } from './jev-usage.js'
import { openUsageStore } from './store.js'

const jevRecord: JevUsageRecord = {
  requestId: '00000000-0000-4000-8000-000000000000',
  source: 'backlog',
  credential: 'Legacy / unknown',
  startedAt: 0,
  durationMs: 10,
  outcome: 'success',
  inputTokens: null,
  outputTokens: null,
}

const emptySlice = { path: '/session/log', sessionId: 'session-a', offset: 1, size: 1, mtimeMs: 1, state: '{}', session: null, rows: [] }

const toolRow = (row: Pick<ToolExecutionRow, 'id' | 'name' | 'startedAt' | 'endedAt'>): ToolExecutionRow => ({
  sessionId: 'session-a',
  seq: 1,
  turn: 1,
  step: 1,
  category: 'plugin',
  owner: null,
  outcome: 'success',
  ...row,
})

describe('usage activity telemetry', () => {
  it('adds the tools table to an existing usage database without touching its Jev requests', () => {
    const directory = mkdtempSync(join(tmpdir(), 'usage-migration-'))
    const path = join(directory, 'usage.db')
    try {
      const now = Date.now()
      const store = openUsageStore(path)
      store.recordJevUsage({ ...jevRecord, requestId: '00000000-0000-4000-8000-000000000010', startedAt: now, durationMs: 12 })
      store.close()
      const previous = new DatabaseSync(path)
      previous.exec(`
        DROP TABLE tools;
        PRAGMA user_version = 4;
        INSERT OR REPLACE INTO meta (key, value) VALUES ('foldVersion', '1');
        INSERT INTO files (path, session_id, offset, size, mtime_ms, state) VALUES ('/session/log', 'session-a', 10, 10, 1, '{}');
      `)
      previous.close()
      const upgraded = openUsageStore(path)
      try {
        expect(upgraded.fileCursor('/session/log')).toBeUndefined()
        upgraded.commitLogSlice({ ...emptySlice, tools: [toolRow({ id: 'session-a#1', name: 'new-tool', startedAt: now + 10, endedAt: now + 20 })] })
        const report = upgraded.activity({ from: now, to: now + 100 })
        expect(report.jev).toMatchObject({ calls: 1, successes: 1 })
        expect(report.tools).toEqual([expect.objectContaining({ name: 'new-tool', calls: 1 })])
      } finally {
        upgraded.close()
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('keeps category totals exact when the per-tool table is capped', () => {
    const store = openUsageStore(':memory:')
    const now = Date.now()
    try {
      store.commitLogSlice({
        path: '/session/log',
        sessionId: 'session-a',
        offset: 1,
        size: 1,
        mtimeMs: 1,
        state: '{}',
        session: null,
        rows: [],
        tools: Array.from({ length: 101 }, (_, index): ToolExecutionRow => ({
          id: `session-a#${String(index)}`,
          sessionId: 'session-a',
          seq: index,
          turn: 1,
          step: index,
          name: `mcp__server__tool_${String(index)}`,
          category: 'mcp',
          owner: null,
          startedAt: now,
          endedAt: now + 1,
          outcome: 'success',
        })),
      })
      const report = store.activity({ from: now, to: now + 2 })
      expect(report.tools).toHaveLength(100)
      expect(report.categories).toEqual([{ category: 'mcp', calls: 101 }])
      expect(report.categoryOutcomes[0]).toMatchObject({ calls: 101, successes: 101, errors: 0, successRate: 1 })
    } finally {
      store.close()
    }
  })

  it('prunes tool executions past retention and leaves Jev requests to their own recorder', () => {
    const store = openUsageStore(':memory:')
    const now = Date.now()
    try {
      const eventAt = now - 364 * 24 * 60 * 60 * 1_000
      store.commitLogSlice({ ...emptySlice, tools: [toolRow({ id: 'session-a#1', name: 'old-tool', startedAt: eventAt, endedAt: eventAt + 1 })] })
      store.recordJevUsage({ ...jevRecord, requestId: '00000000-0000-4000-8000-000000000011', startedAt: eventAt })
      store.pruneTelemetry(now + 2 * 24 * 60 * 60 * 1_000)
      const report = store.activity({ from: eventAt - 1, to: eventAt + 1 })
      expect(report.tools).toEqual([])
      expect(report.jev.calls).toBe(1)
    } finally {
      store.close()
    }
  })

  it('expires stale pending calls while preserving recent ones', () => {
    const store = openUsageStore(':memory:')
    const now = Date.now()
    try {
      store.commitLogSlice({
        path: '/session/log',
        sessionId: 'session-a',
        offset: 1,
        size: 1,
        mtimeMs: 1,
        state: '{}',
        session: null,
        rows: [],
        tools: [
          {
            id: 'session-a#1',
            sessionId: 'session-a',
            seq: 1,
            turn: 1,
            step: 1,
            name: 'pending-tool',
            category: 'tool',
            owner: null,
            startedAt: now - 2 * 24 * 60 * 60 * 1_000,
            endedAt: null,
            outcome: 'pending',
          },
          {
            id: 'session-a#2',
            sessionId: 'session-a',
            seq: 2,
            turn: 1,
            step: 2,
            name: 'live-tool',
            category: 'tool',
            owner: null,
            startedAt: now,
            endedAt: null,
            outcome: 'pending',
          },
        ],
      })
      store.pruneTelemetry(now)
      const report = store.activity({ from: now - 3 * 24 * 60 * 60 * 1_000, to: now + 1 })
      expect(report.tools).toEqual([
        expect.objectContaining({ name: 'live-tool', pending: 1, unknown: 0 }),
        expect.objectContaining({ name: 'pending-tool', pending: 0, unknown: 1 }),
      ])
    } finally {
      store.close()
    }
  })

  it('reports tool executions and Jev outcomes without storing sensitive payloads', () => {
    const store = openUsageStore(':memory:')
    const now = Date.now()
    try {
      store.commitLogSlice({
        path: '/session/log',
        sessionId: 'session-a',
        offset: 1,
        size: 1,
        mtimeMs: 1,
        state: '{}',
        session: null,
        rows: [],
        tools: [
          {
            id: 'session-a#2',
            sessionId: 'session-a',
            seq: 2,
            turn: 1,
            step: 1,
            name: 'shell.run',
            category: 'tool',
            owner: null,
            startedAt: now + 100,
            endedAt: now + 300,
            outcome: 'success',
          },
          {
            id: 'session-a#4',
            sessionId: 'session-a',
            seq: 4,
            turn: 1,
            step: 2,
            name: 'shell.run',
            category: 'plugin',
            owner: '@dshfiles/terminal',
            startedAt: now + 400,
            endedAt: now + 900,
            outcome: 'error',
          },
        ],
      })
      store.recordJevUsage({
        ...jevRecord,
        requestId: '00000000-0000-4000-8000-000000000001',
        source: 'backlog',
        startedAt: now + 150,
        durationMs: 75,
        inputTokens: 40,
        outputTokens: 10,
      })
      const failed = {
        ...jevRecord,
        requestId: '00000000-0000-4000-8000-000000000002',
        source: 'memory',
        startedAt: now + 250,
        durationMs: 125,
        outcome: 'failure',
        inputTokens: null,
        outputTokens: null,
      } as const
      store.recordJevUsage(failed)
      store.recordJevUsage(failed)
      const report = store.activity({ from: now, to: now + 1_000 })
      expect(report.tools).toEqual([
        expect.objectContaining({
          name: 'shell.run',
          category: 'plugin',
          owner: '@dshfiles/terminal',
          calls: 1,
          successes: 0,
          errors: 1,
          interrupted: 0,
          unknown: 0,
          pending: 0,
          averageDurationMs: 500,
          durationMs: { averageMs: 500, p50Ms: 500, p90Ms: 500, maxMs: 500 },
          timestamps: { firstStarted: now + 400, lastStarted: now + 400, firstEnded: now + 900, lastEnded: now + 900 },
        }),
        expect.objectContaining({
          name: 'shell.run',
          category: 'tool',
          owner: null,
          calls: 1,
          successes: 1,
          errors: 0,
          interrupted: 0,
          unknown: 0,
          pending: 0,
          averageDurationMs: 200,
          durationMs: { averageMs: 200, p50Ms: 200, p90Ms: 200, maxMs: 200 },
          timestamps: { firstStarted: now + 100, lastStarted: now + 100, firstEnded: now + 300, lastEnded: now + 300 },
        }),
      ])
      expect(report.categories).toEqual([
        { category: 'plugin', calls: 1 },
        { category: 'tool', calls: 1 },
      ])
      expect(report.categoryOutcomes).toEqual([
        expect.objectContaining({ category: 'plugin', calls: 1, errors: 1, successRate: 0 }),
        expect.objectContaining({ category: 'tool', calls: 1, successes: 1, successRate: 1 }),
      ])
      expect(report.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'jev', source: 'backlog', outcome: 'success', at: now + 150, endedAt: now + 225 }),
          expect.objectContaining({ kind: 'jev', source: 'memory', outcome: 'failure', at: now + 250, endedAt: now + 375 }),
          expect.objectContaining({ kind: 'tool', name: 'shell.run', outcome: 'success', durationMs: 200 }),
        ]),
      )
      expect(report.jev).toMatchObject({
        calls: 2,
        successes: 1,
        failures: 1,
        successRate: 0.5,
        averageDurationMs: 100,
        inputTokens: 40,
        outputTokens: 10,
        byOutcome: [
          { outcome: 'failure', calls: 1 },
          { outcome: 'success', calls: 1 },
        ],
        bySource: [
          expect.objectContaining({ source: 'backlog', calls: 1, successes: 1, successRate: 1, inputTokens: 40, outputTokens: 10 }),
          expect.objectContaining({
            source: 'memory',
            calls: 1,
            failures: 1,
            successRate: 0,
            inputTokens: 0,
            durationMs: { averageMs: 125, p50Ms: 125, p90Ms: 125, maxMs: 125 },
          }),
        ],
      })
      expect(JSON.stringify(report)).not.toContain('Legacy / unknown')
      store.syncToolSources(new Map([['shell.run', { category: 'api', owner: '@dshfiles/terminal' }]]))
      const reclassified = store.activity({ from: now, to: now + 1_000 })
      expect(reclassified.tools).toEqual([
        expect.objectContaining({
          name: 'shell.run',
          category: 'api',
          owner: '@dshfiles/terminal',
          calls: 2,
          successes: 1,
          errors: 1,
          pending: 0,
          averageDurationMs: 350,
        }),
      ])
      expect(reclassified.categories).toEqual([{ category: 'api', calls: 2 }])
      expect(reclassified.categoryOutcomes[0]).toMatchObject({ category: 'api', calls: 2, successes: 1, errors: 1, successRate: 0.5 })
      const limited = store.activity({ from: now, to: now + 1_000, category: 'tool', limit: 1, eventLimit: 1 })
      expect(limited.tools).toHaveLength(0)
      expect(limited.events).toHaveLength(1)
      expect(limited.events[0]?.kind).toBe('tool')
      const bounded = store.activity({ from: now, to: now + 1_000, eventLimit: 2 })
      expect(bounded.events).toHaveLength(2)
      expect(bounded.events.map(event => event.kind)).toEqual(['tool', 'jev'])
    } finally {
      store.close()
    }
  })
})
