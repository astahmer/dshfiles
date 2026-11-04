import { describe, expect, it } from '@effect/vitest'
import { Context, Duration, Effect, Layer, Ref } from 'effect'
import { TestClock } from 'effect/testing'
import { HostCallFailed } from './errors.js'
import { SessionReads, type SessionActivityMap } from './host-edges-promise.js'
import { SessionActivity } from './session-activity.js'

interface StoredSession {
  readonly running: boolean
  readonly questions: number
  /** Projections cannot be read; the Session list still knows it unless `listed` is false. */
  readonly unreadable?: boolean
  readonly listed?: boolean
}

/** The Host's Session controller as plain records: what the activity service reads, and how often it listed. */
const sessionsLayer = (sessions: Ref.Ref<ReadonlyMap<string, StoredSession>>, lists: Ref.Ref<number>) =>
  Layer.succeed(
    SessionReads,
    SessionReads.of({
      listActivity: sessionIds =>
        Effect.gen(function* () {
          yield* Ref.update(lists, count => count + 1)
          const stored = yield* Ref.get(sessions)
          return new Map(
            [...stored]
              .filter(([sessionId, session]) => session.listed !== false && (sessionIds === undefined || sessionIds.includes(sessionId)))
              .map(([sessionId, session]) => [sessionId, { running: session.running, pendingUserQuestion: session.questions > 0 }]),
          ) satisfies SessionActivityMap
        }),
      projections: sessionId =>
        Effect.gen(function* () {
          const session = (yield* Ref.get(sessions)).get(sessionId)
          if (session === undefined) return null
          if (session.unreadable === true) return yield* new HostCallFailed({ service: 'Session controller', operation: 'read Session projections' })
          return { values: { userQuestions: { active: Array.from({ length: session.questions }, () => ({})) } } }
        }),
      isRunning: sessionId => Effect.map(Ref.get(sessions), stored => stored.get(sessionId)?.running === true),
      forkCutAt: () => Effect.succeed(undefined),
      records: Effect.succeed([]),
    }),
  )

const setup = Effect.gen(function* () {
  const sessions = yield* Ref.make<ReadonlyMap<string, StoredSession>>(new Map([['busy', { running: true, questions: 0 }]]))
  const lists = yield* Ref.make(0)
  const context = yield* Layer.build(SessionActivity.layer.pipe(Layer.provide(sessionsLayer(sessions, lists))))
  const activity = Context.get(context, SessionActivity)
  return { sessions, lists, activity }
})

describe('SessionActivity', () => {
  it.effect('serves the display read within its TTL, then the last value while one refresh runs', () =>
    Effect.gen(function* () {
      const { sessions, lists, activity } = yield* setup
      expect((yield* activity.display)?.get('busy')?.running).toBe(true)
      yield* Ref.set(sessions, new Map([['busy', { running: false, questions: 0 }]]))
      yield* TestClock.adjust(Duration.seconds(10))
      expect((yield* activity.display)?.get('busy')?.running).toBe(true)
      expect(yield* Ref.get(lists)).toBe(1)
      yield* TestClock.adjust(Duration.seconds(25))
      expect((yield* activity.display)?.get('busy')?.running).toBe(true)
      yield* TestClock.adjust(Duration.millis(1))
      expect((yield* activity.display)?.get('busy')?.running).toBe(false)
      expect(yield* Ref.get(lists)).toBe(2)
    }).pipe(Effect.scoped),
  )

  it.effect('guards on the workspace Sessions, falling back to the list for an unreadable one', () =>
    Effect.gen(function* () {
      const { sessions, activity } = yield* setup
      yield* Ref.set(
        sessions,
        new Map<string, StoredSession>([
          ['asking', { running: false, questions: 1 }],
          ['unreadable', { running: true, questions: 0, unreadable: true }],
          ['unknown', { running: false, questions: 0, unreadable: true, listed: false }],
        ]),
      )
      const guarded = yield* activity.guard(['asking', 'unreadable', 'unknown', 'gone'])
      expect(guarded?.get('asking')).toMatchObject({ running: false, pendingUserQuestion: true })
      expect(guarded?.get('unreadable')).toMatchObject({ running: true, pendingUserQuestion: false })
      expect(guarded?.get('unknown')).toEqual({ running: undefined, pendingUserQuestion: undefined })
      expect(guarded?.get('gone')).toEqual({ running: false, pendingUserQuestion: false })
    }).pipe(Effect.scoped),
  )
})
