import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import { SessionQueryEngine, type SessionLogSnapshot } from '@deepseek-ai/dsh-session-query'
import { SessionId, type SessionHeader } from '@deepseek-ai/dsh-session/types'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionSearchEngine } from './engine.js'
import { openSearchWorker } from './worker-port-promise.js'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.restoreAllMocks()
})

const stored = SessionId('stored-one')
// SAFETY: a stored header carries exactly these fields; the brand is the only thing the literal lacks.
const header = { id: stored, createdAt: 1, cwd: '/work', isSeeded: false, delegationDepth: 0, version: 4 } as SessionHeader
const titleEvent = (seq: number, title: string) => ({
  seq,
  time: 1_000 + seq,
  type: 'session/title',
  data: { title, messageSeqs: [], source: { kind: 'fallback' } },
})

const engineWithStore = async () => {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  const list = vi.fn(async () => [{ header, formatStatus: 'current', revision: 'r' }])
  // SAFETY: a read touches only stat, list and one read handle; the handle answers the stored log above.
  ctx.provide('sessionPersistence', {
    list,
    stat: async (id: SessionId) => (id === stored ? { header, formatStatus: 'current', revision: 'r' } : undefined),
    open: async () => ({
      header,
      inheritedEventCount: 0,
      read: async () => ({ eventState: 'detached', events: [titleEvent(0, 'First'), titleEvent(1, 'Renamed')] }),
      close: async () => undefined,
    }),
  } as never)
  const engine = new SessionSearchEngine(ctx, { client: openSearchWorker({ indexPath: ':memory:' }).port })
  return { engine, list }
}

/** Core's own read, through the engine's real corpus that lists every stored Session first. */
const coreReadSession = (engine: SessionSearchEngine, sessionId: SessionId): Promise<SessionLogSnapshot> =>
  SessionQueryEngine.prototype.readSession.call(engine, sessionId)

it('reads one stored Session without listing the corpus, as core reads it', async () => {
  const { engine, list } = await engineWithStore()

  const read = await engine.readSession(stored)

  expect(list).not.toHaveBeenCalled()
  expect(read).toEqual(await coreReadSession(engine, stored))
  expect(list).toHaveBeenCalledTimes(1)
})

it('refuses an unknown Session with core’s not-found error and without listing', async () => {
  const { engine, list } = await engineWithStore()
  const missing = SessionId('missing')

  const refusal = await engine.readSession(missing).catch((error: unknown) => error)

  expect(list).not.toHaveBeenCalled()
  const coreRefusal = await coreReadSession(engine, missing).catch((error: unknown) => error)
  expect(refusal).toMatchObject({ code: 'SESSION_QUERY_SESSION_NOT_FOUND' })
  expect(refusal).toEqual(coreRefusal)
})
