import { existsSync } from 'node:fs'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Path } from 'effect'
import { UsageRepo } from './store.js'
import { PlatformTest, usageRepoTest } from './test-layers.js'

describe('usage store activation', () => {
  it.effect('opens the SQLite file on the first read, not when the plugin activates', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'usage-lazy-' })
      const filename = path.join(directory, 'usage.db')

      yield* Effect.gen(function* () {
        // Building the layer above ran the plugin's activation path: the file must not exist until a read needs it.
        expect(existsSync(filename)).toBe(false)
        const repo = yield* UsageRepo
        expect(existsSync(filename)).toBe(false)
        expect(yield* repo.counts()).toEqual({ files: 0, requests: 0 })
        expect(existsSync(filename)).toBe(true)
      }).pipe(Effect.provide(usageRepoTest(filename)))
    }).pipe(Effect.provide(PlatformTest)),
  )

  it.effect('keeps one connection for every later call', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'usage-lazy-' })
      const filename = path.join(directory, 'usage.db')

      yield* Effect.gen(function* () {
        const repo = yield* UsageRepo
        yield* repo.setMeta({ key: 'opened-by', value: 'first read' })
        expect(yield* repo.getMeta('opened-by')).toBe('first read')
        expect(yield* repo.counts()).toEqual({ files: 0, requests: 0 })
      }).pipe(Effect.provide(usageRepoTest(filename)))
    }).pipe(Effect.provide(PlatformTest)),
  )
})
