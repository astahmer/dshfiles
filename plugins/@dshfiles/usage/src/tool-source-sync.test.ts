import type { RegistryToolSource } from '@dshfiles/dshx/api'
import { expect, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql'
import type { ToolExecutionRow } from './fold.js'
import { UsageRepo } from './store.js'
import { usageRepoTestWithSql } from './test-layers.js'

const decodeCount = Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({ count: Schema.Number })]))

type ToolSource = { readonly category: RegistryToolSource; readonly owner: string | null }

const createToolRow = (input: {
  readonly id: string
  readonly name: string
  readonly category: ToolExecutionRow['category']
  readonly owner: string | null
  readonly startedAt: number
}): ToolExecutionRow => ({
  id: input.id,
  sessionId: 'session-a',
  seq: 1,
  turn: 1,
  step: 1,
  name: input.name,
  startedAt: input.startedAt,
  endedAt: input.startedAt + 1,
  outcome: 'success',
  category: input.category,
  owner: input.owner,
  normalizedCommand: null,
  testRunner: null,
  resultChars: null,
})

it.effect('skips unchanged tool-source updates while reclassifying changed non-skill metadata', () =>
  Effect.gen(function* () {
    const now = Date.now()
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
      rows: [],
      tools: [
        createToolRow({ id: 'session-a#1', name: 'task.run', category: 'tool', owner: null, startedAt: now }),
        createToolRow({ id: 'session-a#2', name: 'skill.run', category: 'skill', owner: null, startedAt: now }),
      ],
    })
    yield* sql.unsafe('CREATE TABLE sync_update_count (count INTEGER NOT NULL)')
    yield* sql.unsafe('INSERT INTO sync_update_count VALUES (0)')
    yield* sql.unsafe('CREATE TRIGGER count_tool_updates AFTER UPDATE OF category, owner ON tools BEGIN UPDATE sync_update_count SET count = count + 1; END')
    const sources = new Map<string, ToolSource>([
      ['task.run', { category: 'api', owner: '@dshfiles/terminal' }],
      ['skill.run', { category: 'plugin', owner: '@dshfiles/terminal' }],
    ])
    const readUpdateCount = sql.unsafe('SELECT count FROM sync_update_count').pipe(
      Effect.flatMap(decodeCount),
      Effect.map(([row]) => row.count),
    )

    yield* store.syncToolSources(sources)
    expect((yield* store.activity({ from: now, to: now + 1_000 })).tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'task.run', category: 'api', owner: '@dshfiles/terminal' })]),
    )
    expect(yield* readUpdateCount).toBe(1)
    yield* store.syncToolSources(sources)
    expect(yield* readUpdateCount).toBe(1)

    const changedCategory = new Map<string, ToolSource>([
      ['task.run', { category: 'mcp', owner: '@dshfiles/terminal' }],
      ['skill.run', { category: 'plugin', owner: '@dshfiles/terminal' }],
    ])
    yield* store.syncToolSources(changedCategory)
    expect(yield* readUpdateCount).toBe(2)

    const changedOwner = new Map<string, ToolSource>([
      ['task.run', { category: 'mcp', owner: null }],
      ['skill.run', { category: 'plugin', owner: '@dshfiles/terminal' }],
    ])
    yield* store.syncToolSources(changedOwner)
    expect(yield* readUpdateCount).toBe(3)

    const report = yield* store.activity({ from: now, to: now + 1_000 })
    expect(report.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'skill.run', category: 'skill', owner: null }),
        expect.objectContaining({ name: 'task.run', category: 'mcp', owner: null }),
      ]),
    )
  }).pipe(Effect.provide(usageRepoTestWithSql())),
)
