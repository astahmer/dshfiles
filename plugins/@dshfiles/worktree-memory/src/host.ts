import { totalmem } from 'node:os'
import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { Clock, Effect, Layer } from 'effect'
import { worktreeMemoryApi } from './api.js'
import { HostDirectory, JobTracker } from './host-edge-promise.js'
import { ProcessProbe, ProcessStopper } from './process-probe.js'
import { SessionMetadata } from './session-metadata-cache.js'
import { worktreeMemorySettings } from './settings.js'

const hostEdge = Layer.mergeAll(
  HostDirectory.layer,
  JobTracker.layer,
  DshChildProcessSpawner.layer,
  nodeFileSystemLayer,
  Settings.layer(worktreeMemorySettings),
)

const worktreeMemoryLayer = ProcessStopper.layer.pipe(
  Layer.provideMerge(ProcessProbe.layer),
  Layer.provide(SessionMetadata.layer),
  Layer.provideMerge(hostEdge),
)

const supported = process.platform === 'darwin' || process.platform === 'linux'

export default DshxPlugin.make({
  name: '@dshfiles/worktree-memory',
  inject: ['subprocess'],
  settings: [worktreeMemorySettings],
  layer: worktreeMemoryLayer,
  apis: [
    Api.bind(worktreeMemoryApi, {
      snapshot: () => ProcessProbe.use(probe => probe.snapshot({ fresh: false })),
      pressure: Effect.fn('worktree-memory pressure read')(function* () {
        const probe = yield* ProcessProbe
        return {
          takenAt: yield* Clock.currentTimeMillis,
          supported,
          pressure: supported ? yield* probe.pressure : 'unknown',
          systemBytes: totalmem(),
        }
      }),
      stop: input => ProcessStopper.use(stopper => stopper.stop(input.targets)),
      scratchHosts: () => ProcessProbe.use(probe => Effect.map(probe.scratchHosts, result => result.summary)),
      stopOrphans: () => ProcessStopper.use(stopper => stopper.stopOrphans()),
    }),
  ],
})
