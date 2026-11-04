import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { NavigationCounter } from './navigation-counter.js'
import { temporaryStateFiles } from './state-files.test-support.js'

const counterLayer = NavigationCounter.layer.pipe(Layer.provideMerge(temporaryStateFiles))

describe('navigation counter', () => {
  it('counts destination and section opens by surface, ids only', () => {
    const empty = { version: 1 as const, since: 0, destinations: {}, sections: {}, surfaces: {} }
    const once = NavigationCounter.applyRecord(empty, { destination: 'observe', surface: 'rail' }, 10)
    const twice = NavigationCounter.applyRecord(once, { destination: 'observe', section: 'traces', surface: 'index' }, 20)
    const counts = NavigationCounter.present(twice)
    expect(counts.destinations.find(entry => entry.destination === 'observe')).toEqual({ destination: 'observe', opens: 2, lastOpenedAt: 20 })
    expect(counts.destinations.find(entry => entry.destination === 'land')).toEqual({ destination: 'land', opens: 0, lastOpenedAt: null })
    expect(counts.sections).toEqual([{ destination: 'observe', section: 'traces', opens: 1, lastOpenedAt: 20 }])
    expect(counts.surfaces.filter(entry => entry.opens > 0)).toEqual([
      { surface: 'rail', opens: 1 },
      { surface: 'index', opens: 1 },
    ])
  })

  it.effect('persists across reads and starts over on reset', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_000)
      const counter = yield* NavigationCounter
      yield* counter.record({ destination: 'land', section: 'jj-integration', surface: 'palette' })
      yield* counter.record({ destination: 'land', section: 'jj-integration', surface: 'moved-to' })
      const counts = yield* counter.counts
      expect(counts.sections).toEqual([{ destination: 'land', section: 'jj-integration', opens: 2, lastOpenedAt: 1_000 }])
      yield* TestClock.setTime(2_000)
      const reset = yield* counter.reset
      expect(reset.since).toBe(2_000)
      expect(reset.sections).toEqual([])
      expect((yield* counter.counts).destinations.every(entry => entry.opens === 0)).toBe(true)
    }).pipe(Effect.provide(counterLayer)),
  )
})
