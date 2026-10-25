import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { RegistryToolSource } from '@dshfiles/dshx/api'
import { expect, it } from 'vitest'
import type { ToolExecutionRow } from './fold.js'
import { openUsageStore } from './store.js'

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

it('skips unchanged tool-source updates while reclassifying changed non-skill metadata', () => {
  const directory = mkdtempSync(join(tmpdir(), 'usage-tool-source-sync-'))
  const path = join(directory, 'usage.db')
  const now = Date.now()
  const store = openUsageStore(path)
  const observer = new DatabaseSync(path)

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
        createToolRow({ id: 'session-a#1', name: 'task.run', category: 'tool', owner: null, startedAt: now }),
        createToolRow({ id: 'session-a#2', name: 'skill.run', category: 'skill', owner: null, startedAt: now }),
      ],
    })
    observer.exec(`
      CREATE TABLE sync_update_count (count INTEGER NOT NULL);
      INSERT INTO sync_update_count VALUES (0);
      CREATE TRIGGER count_tool_updates AFTER UPDATE OF category, owner ON tools
      BEGIN UPDATE sync_update_count SET count = count + 1; END;
    `)
    const sources = new Map<string, ToolSource>([
      ['task.run', { category: 'api', owner: '@dshfiles/terminal' }],
      ['skill.run', { category: 'plugin', owner: '@dshfiles/terminal' }],
    ])
    const readUpdateCount = (): number => Number(observer.prepare('SELECT count FROM sync_update_count').get()?.count)

    store.syncToolSources(sources)
    expect(store.activity({ from: now, to: now + 1_000 }).tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'task.run', category: 'api', owner: '@dshfiles/terminal' })]),
    )
    expect(readUpdateCount()).toBe(1)
    store.syncToolSources(sources)
    expect(readUpdateCount()).toBe(1)

    const changedCategory = new Map<string, ToolSource>([
      ['task.run', { category: 'mcp', owner: '@dshfiles/terminal' }],
      ['skill.run', { category: 'plugin', owner: '@dshfiles/terminal' }],
    ])
    store.syncToolSources(changedCategory)
    expect(readUpdateCount()).toBe(2)

    const changedOwner = new Map<string, ToolSource>([
      ['task.run', { category: 'mcp', owner: null }],
      ['skill.run', { category: 'plugin', owner: '@dshfiles/terminal' }],
    ])
    store.syncToolSources(changedOwner)
    expect(readUpdateCount()).toBe(3)

    const report = store.activity({ from: now, to: now + 1_000 })
    expect(report.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'skill.run', category: 'skill', owner: null }),
        expect.objectContaining({ name: 'task.run', category: 'mcp', owner: null }),
      ]),
    )
  } finally {
    observer.close()
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
