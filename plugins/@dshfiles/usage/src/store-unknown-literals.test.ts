import { expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'
import type { RequestRow } from './fold.js'
import { UsageRepo } from './store.js'
import { usageRepoTestWithSql } from './test-layers.js'

const from = 1_800_000_000_000

const request = (id: string, seq: number): RequestRow => ({
  id,
  sessionId: 'session-a',
  seq,
  messageId: null,
  turn: 1,
  step: seq,
  purpose: 'agent',
  source: 'log',
  provider: 'codex-personal',
  model: 'gpt-example',
  startedAt: from + seq,
  endedAt: from + seq + 50,
  ttftMs: 10,
  usage: { input: 4, cacheRead: 0, cacheWrite: 0, output: 3, reasoning: 0 },
  status: 'ok',
  stopReason: null,
  errorCode: null,
})

it.effect('reads a row with a purpose or status this version does not know instead of failing the whole read', () =>
  Effect.gen(function* () {
    const store = yield* UsageRepo
    const sql = yield* SqlClient.SqlClient
    yield* store.commitLogSlice({
      path: '/session/log',
      sessionId: 'session-a',
      offset: 1,
      size: 1,
      mtimeMs: 1,
      state: '{}',
      session: null,
      rows: [request('known', 1), request('from-the-future', 2)],
      tools: [],
    })
    yield* sql.unsafe(`UPDATE requests SET purpose = 'review', status = 'timeout' WHERE id = 'from-the-future'`)

    const page = yield* store.requests({ from, to: from + 1_000, sort: 'startedAt', direction: 'asc', limit: 10 })
    expect(page.rows.map(row => [row.id, row.purpose, row.status])).toEqual([
      ['known', 'agent', 'ok'],
      ['from-the-future', 'other', 'unknown'],
    ])

    const metrics = yield* store.otelMetrics({ from, to: from + 1_000, temporality: 'delta', serviceName: 'dshfiles' })
    expect(metrics.resourceMetrics[0]?.scopeMetrics[0]?.metrics.some(metric => metric.name === 'dsh.model.request.count')).toBe(true)
  }).pipe(Effect.provide(usageRepoTestWithSql())),
)
