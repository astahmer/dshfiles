import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { InflightTurns, turnBoundaryFromEvent } from './inflight-turns.js'
import { RecoveryStore } from './restart-recovery.js'
import { temporaryStateFiles } from './state-files.test-support.js'

const inflightLayer = InflightTurns.layer.pipe(Layer.provideMerge(RecoveryStore.layer), Layer.provideMerge(temporaryStateFiles))

describe('in-flight turns', () => {
  it('turn boundaries are the only events that open or close an in-flight turn', () => {
    expect(turnBoundaryFromEvent({ type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } })).toBe('start')
    expect(turnBoundaryFromEvent({ type: 'turn/end', seq: 2, time: 2, data: { turn: 1, reason: { kind: 'completed' } } })).toBe('end')
    expect(turnBoundaryFromEvent({ type: 'turn/end', seq: 2, time: 2, data: { turn: 1, reason: { kind: 'interrupted' } } })).toBe('interrupted')
    expect(turnBoundaryFromEvent({ type: 'turn/end', seq: 2, time: 2, data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'disposed' } } } })).toBe(
      'shutdown',
    )
    expect(turnBoundaryFromEvent({ type: 'step/start', seq: 3, time: 3, data: { turn: 1, step: 1 } })).toBe(null)
    expect(turnBoundaryFromEvent(null)).toBe(null)
  })

  it.effect('a turn left in flight by an ungraceful exit is promoted as interrupted, once', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(500)
      const inflight = yield* InflightTurns
      yield* inflight.start('crashed-mid-turn')
      yield* inflight.start('finished-cleanly')
      expect(yield* inflight.end('finished-cleanly')).toBe(true)
      expect(yield* inflight.end('never-started')).toBe(false)
      expect(yield* inflight.list).toEqual([{ sessionId: 'crashed-mid-turn', startedAt: 500 }])

      expect(yield* inflight.promote).toEqual(['crashed-mid-turn'])
      const entries = yield* RecoveryStore.use(store => store.list)
      expect(entries.map(entry => [entry.sessionId, entry.reason])).toEqual([['crashed-mid-turn', 'interrupted']])
      // The in-flight file is empty, so a second boot promotes nothing.
      expect(yield* inflight.promote).toEqual([])
    }).pipe(Effect.provide(inflightLayer)),
  )

  it.effect('a managed restart keeps its own reason when the same thread was also in flight', () =>
    Effect.gen(function* () {
      const recovery = yield* RecoveryStore
      const inflight = yield* InflightTurns
      yield* recovery.record({ sessionIds: ['both'], reason: 'restart' })
      yield* inflight.start('both')
      yield* inflight.start('crash-only')
      yield* inflight.promote
      const reasons = new Map((yield* recovery.list).map(entry => [entry.sessionId, entry.reason]))
      expect(reasons.get('both')).toBe('restart')
      expect(reasons.get('crash-only')).toBe('interrupted')
    }).pipe(Effect.provide(inflightLayer)),
  )
})
