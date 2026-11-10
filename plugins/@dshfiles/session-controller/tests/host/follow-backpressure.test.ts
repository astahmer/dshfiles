import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SessionObservation } from '@deepseek-ai/dsh-session-query'
import { afterEach, expect, it } from 'vitest'
import { SessionHistoryController } from '../../src/native/history.ts'

const contexts = new Set<Context>()

afterEach(async () => {
  await Promise.all([...contexts].map(ctx => ctx.fiber.dispose()))
  contexts.clear()
})

const event = (seq: number): SessionEvent =>
  // SAFETY: the follow path reads only type, seq and time from a durable event.
  ({ seq, time: 1_000 + seq, type: 'user/message', data: {} }) as never

it('ends a follower that stops reading instead of buffering every frame', async () => {
  const ctx = new Context()
  contexts.add(ctx)
  const sessionId = SessionId('slow-follower')
  const seeded = [event(0), event(1), event(2)]
  const observation = (): SessionObservation => ({
    source: 'prepared',
    header: { id: sessionId, createdAt: 100, cwd: '/fixture' } as never,
    inheritedEventCount: 0 as never,
    events: seeded,
    cursor: (seeded.length - 1) as never,
    projections: { asOfSeq: (seeded.length - 1) as never, values: {} },
    retain: observation,
    [Symbol.dispose]: () => undefined,
  })
  // SAFETY: follow() asks the registry only whether the Session is attached.
  ctx.provide('sessions', { get: () => undefined } as never)
  // SAFETY: follow() reads only observeSession from the query service.
  ctx.provide('sessionQuery', { observeSession: async () => observation() } as never)
  const history = new SessionHistoryController(ctx, () => undefined)
  const controller = new AbortController()
  const frames = history.follow({ address: { kind: 'session', sessionId } } as never, controller.signal)[Symbol.asyncIterator]()
  expect((await frames.next()).value).toMatchObject({ type: 'snapshot' })

  // A client that never reads again: the Session keeps writing, past any reasonable buffer.
  const session = { id: sessionId } as never
  const written = 9_000
  for (let seq = 3; seq < written; seq += 1) ctx.emit('session/event', session, event(seq))

  let received = 0
  for (let next = await frames.next(); next.done !== true; next = await frames.next()) received += 1
  controller.abort()
  // The follower ends instead of parking every frame the client never read; it resyncs from a fresh snapshot.
  expect(received).toBeLessThan(written - 3)
})

it('still delivers a client that keeps up', async () => {
  const ctx = new Context()
  contexts.add(ctx)
  const sessionId = SessionId('fast-follower')
  const seeded = [event(0), event(1), event(2)]
  const observation = (): SessionObservation => ({
    source: 'prepared',
    header: { id: sessionId, createdAt: 100, cwd: '/fixture' } as never,
    inheritedEventCount: 0 as never,
    events: seeded,
    cursor: (seeded.length - 1) as never,
    projections: { asOfSeq: (seeded.length - 1) as never, values: {} },
    retain: observation,
    [Symbol.dispose]: () => undefined,
  })
  ctx.provide('sessions', { get: () => undefined } as never)
  ctx.provide('sessionQuery', { observeSession: async () => observation() } as never)
  const history = new SessionHistoryController(ctx, () => undefined)
  const controller = new AbortController()
  const frames = history.follow({ address: { kind: 'session', sessionId } } as never, controller.signal)[Symbol.asyncIterator]()
  expect((await frames.next()).value).toMatchObject({ type: 'snapshot' })

  const session = { id: sessionId } as never
  const written = 50
  for (let seq = 3; seq < written; seq += 1) ctx.emit('session/event', session, event(seq))
  const collected: number[] = []
  while (collected.length < written - 3) {
    const next = await frames.next()
    if (next.done === true) break
    const frame = next.value
    if (frame.type === 'event') collected.push(frame.event.seq)
  }
  controller.abort()
  expect(collected).toEqual(Array.from({ length: written - 3 }, (_, index) => index + 3))
})
