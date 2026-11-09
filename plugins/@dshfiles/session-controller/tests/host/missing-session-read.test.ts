import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, expect, it } from 'vitest'
import { SessionHistoryController } from '../../src/native/history.ts'

const contexts = new Set<Context>()

afterEach(async () => {
  await Promise.all([...contexts].map(ctx => ctx.fiber.dispose()))
  contexts.clear()
})

/**
 * A Session with no stored log anywhere (a local draft the browser never created on this Host). Each persistence
 * lookup of a missing id walks every project directory, so the read must answer from the tail's one lookup.
 */
const missingSession = () => {
  const ctx = new Context()
  contexts.add(ctx)
  const lookups: string[] = []
  // SAFETY: the history reads only `get` from the registry; nothing is attached.
  ctx.provide('sessions', { get: () => undefined } as never)
  // SAFETY: the tail read calls only `stat` and, for a stored log, `resolveCurrentLog`.
  ctx.provide('sessionPersistence', {
    stat: async (id: string) => {
      lookups.push(`stat ${id}`)
      return undefined
    },
    resolveCurrentLog: async (id: string) => {
      lookups.push(`resolve ${id}`)
      return undefined
    },
  } as never)
  // SAFETY: the full read calls only observeSession, which looks the Session up again before answering not-found.
  ctx.provide('sessionQuery', {
    observeSession: async (id: string) => {
      lookups.push(`observe ${id}`)
      throw new Error(`session ${id} not found`)
    },
  } as never)
  return { history: new SessionHistoryController(ctx, () => undefined), lookups }
}

const sessionId = SessionId('session-draft-never-created')
const address = { kind: 'session', sessionId } as const

it('answers a page of a Session with no stored log from one lookup', async () => {
  const { history, lookups } = missingSession()
  await expect(history.page({ address, throughSeq: -1, maxMessages: 50 } as never, new AbortController().signal)).rejects.toMatchObject({
    code: 'session/not-found',
  })
  expect(lookups).toEqual([`stat ${sessionId}`])
})

it('answers a follow of a Session with no stored log from one lookup', async () => {
  const { history, lookups } = missingSession()
  const frames = history.follow({ address, maxMessages: 50 } as never, new AbortController().signal)[Symbol.asyncIterator]()
  await expect(frames.next()).rejects.toMatchObject({ code: 'session/not-found' })
  expect(lookups).toEqual([`stat ${sessionId}`])
})
