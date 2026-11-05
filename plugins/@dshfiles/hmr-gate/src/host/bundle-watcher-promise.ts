import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { Effect, Exit, Scope } from 'effect'
import { BundleWatchProgram, type BundleWatcher, type BundleWatcherOptions } from './bundle-watcher.js'

/** The watcher handle the Cordis Host half holds: the program's controls plus the release of its scope. */
export interface BundleWatcherHandle extends BundleWatcher {
  dispose(): void
}

/**
 * The one edge where hmr-gate's callback-style Host (`defineHost` with `ctx.effect`) starts and stops the Effect
 * bundle watcher. Everything the watcher runs is a fiber of `scope`; `dispose` closes it, interrupting every watch,
 * poll and pending read.
 */
const create = (options: BundleWatcherOptions): BundleWatcherHandle => {
  const scope = Effect.runSync(Scope.make())
  const watcher = Effect.runSync(BundleWatchProgram.make(options).pipe(Scope.provide(scope), Effect.provide(nodeFileSystemLayer)))
  return {
    sync: rows => watcher.sync(rows),
    retry: ids => watcher.retry(ids),
    dispose: () => {
      Effect.runFork(Scope.close(scope, Exit.void))
    },
  }
}

export class BundleWatch {
  static readonly create = create
}
