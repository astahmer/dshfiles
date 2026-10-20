import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SessionObservation } from '@deepseek-ai/dsh-session-query'
import { resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { SessionHistoryController } from '../../src/native/history.ts'

const contexts = new Set<Context>()

afterEach(async () => {
  await Promise.all([...contexts].map(ctx => ctx.fiber.dispose()))
  contexts.clear()
})

const event = (seq: number, type: string): SessionEvent =>
  // SAFETY: the follow snapshot of turn markers and user messages reads only their type, seq and time.
  ({ seq, time: 1_000 + seq, type, data: {} }) as never

const turn = [event(0, 'turn/start'), event(1, 'user/message'), event(2, 'turn/end')]

const openedWith = async (events: readonly SessionEvent[]): Promise<readonly string[]> => {
  const ctx = new Context()
  contexts.add(ctx)
  const sessionId = SessionId('opened-cold')
  const observation = (): SessionObservation => ({
    source: 'prepared',
    header: { id: sessionId, createdAt: 100, cwd: resolve('open-fixture') } as never,
    inheritedEventCount: 0 as never,
    events,
    cursor: (events.length - 1) as never,
    projections: { asOfSeq: (events.length - 1) as never, values: {} },
    retain: observation,
    [Symbol.dispose]: () => undefined,
  })
  // SAFETY: follow() reads only observeSession from the query service.
  ctx.provide('sessionQuery', { observeSession: async () => observation() } as never)
  const promoted: string[] = []
  const history = new SessionHistoryController(ctx, opened => {
    promoted.push(opened.header.id)
  })
  const controller = new AbortController()
  const frames = history.follow({ address: { kind: 'session', sessionId } } as never, controller.signal)[Symbol.asyncIterator]()
  const snapshot = await frames.next()
  expect(snapshot.value).toMatchObject({ type: 'snapshot' })
  const following = frames.next()
  controller.abort()
  await following.catch(() => undefined)
  return promoted
}

it('opens a settled cold Session without resuming its Agent', async () => {
  await expect(openedWith(turn)).resolves.toEqual([])
})

it('still resumes a Session whose log stops inside a turn, so its crash closers land', async () => {
  await expect(openedWith([...turn, event(3, 'turn/start')])).resolves.toEqual(['opened-cold'])
})
