import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import {
  SessionQueryEngine,
  SessionQueryError,
  SessionSearchCursor,
  type SessionRecord,
  type SessionSearchHit,
  type SessionSearchPage,
  type SessionSearchRequest,
} from '@deepseek-ai/dsh-session-query'
import { resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { ApiSessionList } from '../../src/native/list.ts'

const contexts = new Set<Context>()

afterEach(async () => {
  await Promise.all([...contexts].map(ctx => ctx.fiber.dispose()))
  contexts.clear()
})

/** A search index that ingests between every page: each continuation cursor is already stale when it comes back. */
class ChurningIndex extends SessionQueryEngine {
  calls = 0

  override async listSessions(): Promise<SessionRecord[]> {
    const session = this.ctx.sessions.prepare(SessionId('visible'), { meta: { createdAt: 1, cwd: resolve('search-fixture') } })
    return [{ header: session.header, live: false, persisted: true }]
  }

  override async searchSessions(request: SessionSearchRequest): Promise<SessionSearchPage<SessionSearchHit>> {
    this.calls += 1
    if (request.cursor !== undefined) throw new SessionQueryError('the corpus changed since this cursor was issued', 'SESSION_QUERY_STALE_CURSOR')
    return { items: [], nextCursor: SessionSearchCursor(`page-${String(this.calls)}`) }
  }

  override searchEvents(): never {
    throw new Error('this test searches Sessions, never one Session’s events')
  }
}

it('gives up after a few restarts when the index keeps changing under its cursor', async () => {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ChurningIndex, {})
  const index = ctx.get('sessionQuery')
  if (!(index instanceof ChurningIndex)) throw new Error('the churning index is not the mounted sessionQuery')

  await expect(new ApiSessionList(ctx, 8).search('needle', new AbortController().signal)).rejects.toThrow(/kept changing/u)
  expect(index.calls).toBe(8)
})
