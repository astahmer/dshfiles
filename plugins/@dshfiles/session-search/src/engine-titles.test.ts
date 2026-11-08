import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionSearchEngine } from './engine.js'
import { openSearchWorker } from './worker-port-promise.js'

afterEach(() => {
  vi.restoreAllMocks()
})

it('folds a Session title once until that Session appends an event', async () => {
  const asked: string[][] = []
  // SAFETY: the engine's memo reads only `status` and `sessionId`; the snapshot body is passed through untouched.
  vi.spyOn(SessionQueryEngine.prototype, 'readTitleSnapshots').mockImplementation(async ids => {
    asked.push([...ids])
    return ids.map(sessionId => ({
      status: 'fulfilled' as const,
      sessionId,
      value: { session: { id: sessionId } as never, title: { title: `title of ${sessionId}`, updatedAt: 1 } as never },
    }))
  })
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const engine = new SessionSearchEngine(ctx, { client: openSearchWorker({ indexPath: ':memory:' }).port })
  const first = SessionId('first')
  const second = SessionId('second')

  await engine.readTitleSnapshots([first, second])
  const again = await engine.readTitleSnapshots([second, first])
  expect(again.map(result => result.sessionId)).toEqual(['second', 'first'])
  // SAFETY: the memo keys its cache on the emitted Session's id; no other part of the event is read.
  ctx.emit('session/event', { id: first, header: { id: first } } as never, { seq: 1, type: 'session/title', time: 1, data: {} } as never)
  await engine.readTitleSnapshots([first, second])
  expect(asked).toEqual([['first', 'second'], ['first']])
})
