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

/** A follow on a cold Session read in full, counting the leases the read hands out and the ones still held. */
const followed = async (events: readonly SessionEvent[]) => {
  const ctx = new Context()
  contexts.add(ctx)
  const sessionId = SessionId('followed-cold')
  const leases = { open: 0 }
  const observation = (): SessionObservation => {
    leases.open += 1
    let disposed = false
    return {
      source: 'prepared',
      header: { id: sessionId, createdAt: 100, cwd: resolve('follow-fixture') } as never,
      inheritedEventCount: 0 as never,
      events,
      cursor: (events.length - 1) as never,
      projections: { asOfSeq: (events.length - 1) as never, values: {} },
      retain: observation,
      [Symbol.dispose]: () => {
        if (disposed) return
        disposed = true
        leases.open -= 1
      },
    }
  }
  // SAFETY: follow() asks the registry only whether the Session is attached; no persistence is mounted, so it takes the full read.
  ctx.provide('sessions', { get: () => undefined } as never)
  // SAFETY: follow() reads only observeSession from the query service.
  ctx.provide('sessionQuery', { observeSession: async () => observation() } as never)
  const promoted: SessionObservation[] = []
  const history = new SessionHistoryController(ctx, opened => {
    promoted.push(opened)
  })
  const controller = new AbortController()
  const frames = history.follow({ address: { kind: 'session', sessionId } } as never, controller.signal)[Symbol.asyncIterator]()
  const snapshot = await frames.next()
  const deliveredRecords = snapshot.value?.type === 'snapshot' ? snapshot.value.records.length : undefined
  const following = frames.next()
  await Promise.resolve()
  return {
    snapshot: snapshot.value,
    deliveredRecords,
    leases,
    promoted,
    followed: history.isFollowed(sessionId),
    close: async () => {
      controller.abort()
      await following.catch(() => undefined)
    },
  }
}

it('releases the full read once the opening snapshot is delivered, while the follow stays open', async () => {
  const follow = await followed([event(0, 'turn/start'), event(1, 'user/message'), event(2, 'turn/end')])
  expect(follow.snapshot).toMatchObject({ type: 'snapshot', cursor: 2 })
  expect(follow.followed).toBe(true)
  expect(follow.leases.open).toBe(0)
  await follow.close()
})

it('empties the delivered opening records once the carrier asks for the next frame', async () => {
  const follow = await followed([event(0, 'turn/start'), event(1, 'user/message'), event(2, 'turn/end')])
  expect(follow.deliveredRecords).toBe(3)
  expect(follow.snapshot).toMatchObject({ type: 'snapshot', records: [] })
  await follow.close()
})

it('keeps only the promotion lease for a log that stops inside a turn', async () => {
  const follow = await followed([event(0, 'turn/start'), event(1, 'user/message')])
  expect(follow.promoted).toHaveLength(1)
  expect(follow.leases.open).toBe(1)
  follow.promoted[0]?.[Symbol.dispose]()
  expect(follow.leases.open).toBe(0)
  await follow.close()
})
