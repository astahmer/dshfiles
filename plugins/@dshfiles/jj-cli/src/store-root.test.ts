import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Layer, Path } from 'effect'
import { storeRootOf } from './store-root.ts'

const layer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const checkouts = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* fileSystem.makeTempDirectoryScoped()
  const owner = path.join(root, 'repo')
  const store = path.join(owner, '.jj', 'repo')
  yield* fileSystem.makeDirectory(store, { recursive: true })
  const secondary = path.join(root, 'repo-threads', 'thread-abcdef')
  yield* fileSystem.makeDirectory(path.join(secondary, '.jj'), { recursive: true })
  yield* fileSystem.writeFileString(path.join(secondary, '.jj', 'repo'), `${path.relative(path.join(secondary, '.jj'), store)}\n`)
  return { root, owner, store, secondary }
})

describe('storeRootOf', () => {
  it.effect('finds the store of the owning checkout and of a workspace that points at it', () =>
    Effect.gen(function* () {
      const { owner, store, secondary } = yield* checkouts
      expect(yield* storeRootOf(owner)).toBe(store)
      expect(yield* storeRootOf(secondary)).toBe(store)
    }).pipe(Effect.scoped, Effect.provide(layer)),
  )

  it.effect('answers undefined for a folder without a store or with a pointer that leads nowhere', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const { root } = yield* checkouts
      expect(yield* storeRootOf(root)).toBeUndefined()
      const dangling = path.join(root, 'dangling')
      yield* fileSystem.makeDirectory(path.join(dangling, '.jj'), { recursive: true })
      yield* fileSystem.writeFileString(path.join(dangling, '.jj', 'repo'), '../../elsewhere/not-a-store\n')
      expect(yield* storeRootOf(dangling)).toBeUndefined()
    }).pipe(Effect.scoped, Effect.provide(layer)),
  )
})
