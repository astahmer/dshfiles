import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Effect, FileSystem, Layer } from 'effect'
import { StateFiles } from './runtime-files.js'

/** The plugin's state files in a fresh temporary DSH home, removed with the test scope. */
export const temporaryStateFiles = Layer.unwrap(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return StateFiles.layerAt(yield* fs.makeTempDirectoryScoped({ prefix: 'thread-sidebar-' }))
  }),
).pipe(Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)))
