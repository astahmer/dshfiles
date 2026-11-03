import { describe, expect, it } from '@effect/vitest'
import { Deferred, Effect, Exit, Fiber, Option } from 'effect'
import { ModelCatalogs } from './model-catalogs.js'

const route = {
  instanceId: 'go_a',
  kind: 'opencode-go',
  enabled: true,
  apiBaseUrl: 'https://go.test',
  apiKeyEnv: 'GO_KEY',
  authSource: 'cli',
  displayName: 'Go',
} as const

describe('ModelCatalogs', () => {
  it.effect('records a discovered catalog per account and drops it again', () =>
    Effect.gen(function* () {
      const catalogs = yield* ModelCatalogs.make
      expect(catalogs.discovered('go_a')).toBeUndefined()
      yield* catalogs.record({ instanceId: 'go_a', route, modelIds: ['a', 'b'] })
      expect(catalogs.discovered('go_a')).toEqual(['a', 'b'])
      yield* catalogs.forget('go_a')
      expect(catalogs.discovered('go_a')).toBeUndefined()
    }),
  )

  it.effect('keeps one refresh per account and interrupts the one it replaces', () =>
    Effect.gen(function* () {
      const catalogs = yield* ModelCatalogs.make
      const started = yield* Deferred.make<void>()
      const slow = yield* catalogs.start(
        'go_a',
        Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined)
          yield* Effect.never
        }),
      )
      yield* Deferred.await(started)
      expect(yield* catalogs.isRefreshing('go_a')).toBe(true)
      const fast = yield* catalogs.start('go_a', Effect.succeed('fast'))
      expect(Option.getOrNull(yield* Fiber.join(fast))).toBe('fast')
      // The replaced refresh is interrupted rather than left to finish and overwrite the newer catalog.
      expect(Exit.isFailure(yield* Fiber.await(slow))).toBe(true)
      expect(yield* catalogs.isRefreshing('go_a')).toBe(false)
    }),
  )

  it.effect('reports none when a refresh fails, and clears the account afterwards', () =>
    Effect.gen(function* () {
      const catalogs = yield* ModelCatalogs.make
      const failed = yield* catalogs.start('go_a', Effect.fail('nope'))
      expect(Option.isNone(yield* Fiber.join(failed))).toBe(true)
      expect(yield* catalogs.isRefreshing('go_a')).toBe(false)
    }),
  )

  it.effect('retains only the catalogs whose route still matches', () =>
    Effect.gen(function* () {
      const catalogs = yield* ModelCatalogs.make
      yield* catalogs.record({ instanceId: 'go_a', route, modelIds: ['a'] })
      yield* catalogs.record({ instanceId: 'go_b', route, modelIds: ['b'] })
      yield* catalogs.retain(({ instanceId }) => instanceId === 'go_b')
      expect(catalogs.discovered('go_a')).toBeUndefined()
      expect(catalogs.discovered('go_b')).toEqual(['b'])
    }),
  )
})
