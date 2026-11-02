import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { describe, expect, it } from '@effect/vitest'
import { Deferred, Effect, Fiber, Layer } from 'effect'
import { QuestionFacts, QuestionScan, type SessionQuestionFacts, type SessionQuestionLoad, type SessionQuestionTarget } from './question-scan.js'

const target = (sessionId: string, sessionLive = false): SessionQuestionTarget => ({
  sessionId,
  sessionLive,
  sessionPersisted: true,
  targetIsLiveRoot: sessionLive,
})

const factsFor = (sessionId: string): SessionQuestionFacts => ({
  pending: [{ callId: ToolCallId(`call-${sessionId}`), state: 'open', questions: [{ id: 'decision', question: 'Which approach?' }] }],
  waits: [],
})

/** The session projection stands in as a loader the test controls; the scan, cache and sharing are the real ones. */
const scanWith = (input: {
  readonly load: (target: SessionQuestionTarget) => Effect.Effect<SessionQuestionLoad>
  readonly capacity?: number
  readonly concurrency?: number
}) =>
  QuestionScan.layerWith({ concurrency: input.concurrency ?? 4, cacheCapacity: input.capacity ?? 8, cacheTtlMs: 30_000 }).pipe(
    Layer.provide(Layer.succeed(QuestionFacts, QuestionFacts.of({ load: input.load }))),
  )

const recordingLoad = (loaded: string[]) => (sessionTarget: SessionQuestionTarget) =>
  Effect.sync((): SessionQuestionLoad => {
    loaded.push(sessionTarget.sessionId)
    return { facts: factsFor(sessionTarget.sessionId), projectionUnavailable: false }
  })

const scan = (targets: ReadonlyArray<SessionQuestionTarget>, now = 0) => QuestionScan.use(questionScan => questionScan.scan({ targets, now }))

describe('session question scans', () => {
  it.effect('reuses a non-live Session instead of reading its projection again', () =>
    Effect.gen(function* () {
      const loaded: string[] = []
      yield* Effect.gen(function* () {
        const first = yield* scan([target('paused-session')], 1_000)
        const second = yield* scan([target('paused-session')], 2_000)
        expect(loaded).toEqual(['paused-session'])
        expect(first.reused).toBe(0)
        expect(second.reused).toBe(1)
        expect(second.reads[0]?.facts).toEqual(factsFor('paused-session'))
      }).pipe(Effect.provide(scanWith({ load: recordingLoad(loaded) })))
    }),
  )

  it.effect('re-reads a live Session every scan because it can still change', () =>
    Effect.gen(function* () {
      const loaded: string[] = []
      yield* Effect.gen(function* () {
        yield* scan([target('live-session', true)], 1_000)
        const second = yield* scan([target('live-session', true)], 2_000)
        expect(loaded).toEqual(['live-session', 'live-session'])
        expect(second.reused).toBe(0)
      }).pipe(Effect.provide(scanWith({ load: recordingLoad(loaded) })))
    }),
  )

  it.effect('reads a Session freshly again once its cached facts expire', () =>
    Effect.gen(function* () {
      const loaded: string[] = []
      yield* Effect.gen(function* () {
        yield* scan([target('paused-session')], 1_000)
        const expired = yield* scan([target('paused-session')], 1_000 + 30_001)
        expect(loaded).toEqual(['paused-session', 'paused-session'])
        expect(expired.reused).toBe(0)
      }).pipe(Effect.provide(scanWith({ load: recordingLoad(loaded) })))
    }),
  )

  it.effect('stops reusing the least recently read Session past the cache capacity', () =>
    Effect.gen(function* () {
      const loaded: string[] = []
      yield* Effect.gen(function* () {
        yield* scan([target('first')], 1)
        yield* scan([target('second')], 2)
        yield* scan([target('third')], 3)
        const revisited = yield* scan([target('first')], 4)
        expect(loaded).toEqual(['first', 'second', 'third', 'first'])
        expect(revisited.reused).toBe(0)
      }).pipe(Effect.provide(scanWith({ load: recordingLoad(loaded), capacity: 2 })))
    }),
  )

  it.effect('retries a Session whose projection could not be read instead of caching the gap', () =>
    Effect.gen(function* () {
      let attempts = 0
      const load = (sessionTarget: SessionQuestionTarget) =>
        Effect.sync((): SessionQuestionLoad => {
          attempts += 1
          return attempts === 1 ? { projectionUnavailable: true } : { facts: factsFor(sessionTarget.sessionId), projectionUnavailable: false }
        })
      yield* Effect.gen(function* () {
        const first = yield* scan([target('flaky-session')], 1)
        const second = yield* scan([target('flaky-session')], 2)
        expect(first.projectionUnavailable).toBe(1)
        expect(first.reads[0]?.facts).toBeUndefined()
        expect(second.projectionUnavailable).toBe(0)
        expect(second.reused).toBe(0)
        expect(attempts).toBe(2)
      }).pipe(Effect.provide(scanWith({ load })))
    }),
  )

  it.effect('keeps cached facts attributable to their own Session', () =>
    Effect.gen(function* () {
      const loaded: string[] = []
      yield* Effect.gen(function* () {
        yield* scan([target('alpha'), target('beta')], 1)
        const second = yield* scan([target('beta'), target('alpha')], 2)
        expect(second.reads.map(read => [read.target.sessionId, read.facts?.pending[0]?.callId])).toEqual([
          ['beta', 'call-beta'],
          ['alpha', 'call-alpha'],
        ])
      }).pipe(Effect.provide(scanWith({ load: recordingLoad(loaded) })))
    }),
  )

  it.effect('never runs more Session reads at once than the configured concurrency', () =>
    Effect.gen(function* () {
      let active = 0
      let peak = 0
      const load = () =>
        Effect.gen(function* () {
          active += 1
          peak = Math.max(peak, active)
          yield* Effect.yieldNow
          active -= 1
          return { projectionUnavailable: false }
        })
      yield* Effect.gen(function* () {
        const result = yield* scan(Array.from({ length: 9 }, (_value, index) => target(`session-${String(index)}`, true)))
        expect(result.scanned).toBe(9)
        expect(peak).toBe(3)
      }).pipe(Effect.provide(scanWith({ load, concurrency: 3 })))
    }),
  )
})

describe('shared session question reads', () => {
  it.effect('shares one in-flight read among concurrent scans and keeps nothing afterwards', () =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>()
      let loads = 0
      const load = (sessionTarget: SessionQuestionTarget) =>
        Effect.gen(function* () {
          loads += 1
          yield* Deferred.await(release)
          return { facts: factsFor(sessionTarget.sessionId), projectionUnavailable: false }
        })
      yield* Effect.gen(function* () {
        const callers = yield* Effect.forEach(Array.from({ length: 20 }), () => Effect.forkChild(scan([target('s1', true)])))
        yield* Effect.yieldNow
        expect(loads).toBe(1)
        yield* Deferred.succeed(release, undefined)
        const results = yield* Effect.forEach(callers, Fiber.join)
        expect(results.filter(result => result.reads[0]?.facts !== undefined)).toHaveLength(20)
        yield* scan([target('s1', true)])
        expect(loads).toBe(2)
      }).pipe(Effect.provide(scanWith({ load })))
    }),
  )

  it.effect('keeps a shared read alive for the scans that remain and interrupts it with the last one', () =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>()
      const interrupted: string[] = []
      const load = (sessionTarget: SessionQuestionTarget) =>
        (sessionTarget.sessionId === 's2' ? Effect.never : Deferred.await(release)).pipe(
          Effect.as<SessionQuestionLoad>({ facts: factsFor(sessionTarget.sessionId), projectionUnavailable: false }),
          Effect.onInterrupt(() => Effect.sync(() => interrupted.push(sessionTarget.sessionId))),
        )
      yield* Effect.gen(function* () {
        const first = yield* Effect.forkChild(scan([target('s1', true)]))
        const second = yield* Effect.forkChild(scan([target('s1', true)]))
        yield* Effect.yieldNow
        yield* Fiber.interrupt(first)
        expect(interrupted).toEqual([])
        yield* Deferred.succeed(release, undefined)
        expect((yield* Fiber.join(second)).reads[0]?.facts).toEqual(factsFor('s1'))

        const solo = yield* Effect.forkChild(scan([target('s2', true)]))
        yield* Effect.yieldNow
        yield* Fiber.interrupt(solo)
        expect(interrupted).toEqual(['s2'])
      }).pipe(Effect.provide(scanWith({ load })))
    }),
  )

  it.effect('reads a different availability scope separately', () =>
    Effect.gen(function* () {
      const loaded: string[] = []
      yield* Effect.gen(function* () {
        yield* Effect.all([scan([target('s1', false)], 1), scan([target('s1', true)], 1)], { concurrency: 'unbounded' })
        expect(loaded).toEqual(['s1', 's1'])
      }).pipe(Effect.provide(scanWith({ load: recordingLoad(loaded) })))
    }),
  )
})
