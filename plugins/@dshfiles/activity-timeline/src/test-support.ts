import { NodeServices } from '@effect/platform-node'
import { Effect, FileSystem, Layer, Path } from 'effect'
import { ActivityStore, type ActivityStoreOptions } from './activity-store.js'
import { ActivityTimeline } from './activity-timeline.js'
import type { ActivityIngest } from './types.js'

export const now = 1_800_000_000_000

/** A state file path inside a temporary directory removed when the test's Scope closes. */
export const temporaryStatePath = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'activity-timeline-' })
  return path.join(directory, 'state.json')
}).pipe(Effect.provide(NodeServices.layer))

/** The real timeline over a real store, on the Node file system unless the test supplies its own. */
export const timelineLayer = (options: ActivityStoreOptions, fileSystem: Layer.Layer<FileSystem.FileSystem> = NodeServices.layer) =>
  ActivityTimeline.layer.pipe(Layer.provideMerge(ActivityStore.layerWith(options)), Layer.provide(Layer.mergeAll(NodeServices.layer, fileSystem)))

export const routine = (index: number, at: number, sessionId = 'session-a', correlationId?: string): ActivityIngest => ({
  id: `routine-${String(index)}`,
  at,
  source: 'communication',
  type: 'communication.activity',
  level: 'routine',
  sessionId,
  ...(correlationId !== undefined && { correlationId }),
  summary: `read ${String(index)}`,
  metadata: {},
  references: [],
  provenance: 'observed',
})
