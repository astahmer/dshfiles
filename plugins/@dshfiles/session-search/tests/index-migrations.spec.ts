import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { SqliteStore } from '@dshfiles/sqlite-store'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'
import { expect, it } from 'vitest'
import { indexMigrations, SearchIndex } from '../src/index-db.js'

it('adopts an existing unversioned index without losing its FTS data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-search-migration-'))
  const filename = join(root, 'index.sqlite')
  try {
    const index = new SearchIndex(filename)
    index.commitBatch({
      header: { id: 'existing', version: 4, createdAt: 0, isSeeded: false },
      cursor: { logPath: 'existing', dev: '1', ino: '1', offset: 1, size: 1, mtimeNs: '1' },
      documents: [{ sessionId: 'existing', seq: 1, type: 'user/message', time: 1, surface: 'current', text: 'quartz migration', truncated: false }],
      replace: true,
      now: 1,
    })
    index.close()
    const rows = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql`SELECT session_id FROM session_documents WHERE session_documents MATCH ${'quartz'}`
      }).pipe(
        Effect.provide(SqliteStore.layer({ filename, migrations: indexMigrations })),
        Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
      ),
    )
    expect(rows).toEqual([{ session_id: 'existing' }])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
