import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import { afterEach, expect, it } from 'vitest'
import { runWithIndex } from '../tests/index-harness.js'
import { SessionSearchEngine } from './engine.js'
import { openSearchWorker } from './worker-port-promise.js'

let root = ''

afterEach(() => {
  if (root.length === 0) return
  rmSync(root, { recursive: true, force: true })
  root = ''
})

const indexSession = (indexPath: string, sessionId: string) =>
  runWithIndex(indexPath, index =>
    index.commitBatch({
      header: { id: sessionId, version: 4, createdAt: 1, isSeeded: false },
      cursor: { logPath: join(root, sessionId), dev: '1', ino: '2', offset: 10, size: 10, mtimeNs: '3' },
      documents: [{ sessionId, seq: 1, type: 'user/message', time: 1, surface: 'current', text: 'paging needle', truncated: false }],
      replace: false,
      now: 1,
    }),
  )

it('refuses a cursor once the indexed corpus changed under it', { timeout: 30_000 }, async () => {
  root = mkdtempSync(join(tmpdir(), 'session-search-cursor-'))
  const indexPath = join(root, 'index.sqlite')
  for (const id of ['a', 'b', 'c']) await indexSession(indexPath, `session-${id}`)
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const worker = openSearchWorker({ indexPath })
  try {
    const engine = new SessionSearchEngine(ctx, { client: worker.port })
    const first = await engine.searchSessions({ query: 'needle', limit: 1 })
    expect(first.nextCursor).toBeDefined()
    const second = await engine.searchSessions({ query: 'needle', limit: 1, cursor: first.nextCursor })
    expect(second.items).toHaveLength(1)

    await indexSession(indexPath, 'session-d')
    await expect(engine.searchSessions({ query: 'needle', limit: 1, cursor: second.nextCursor })).rejects.toMatchObject({
      code: 'SESSION_QUERY_STALE_CURSOR',
    })
  } finally {
    await worker.close()
  }
})
