import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Layer } from 'effect'
import { AlertDb, AlertRepo } from './alerts/alert-repo.js'
import { TraceDb, TraceRepo } from './trace-repo.js'

const NodePlatform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

/** A fresh in-memory span store per provide. */
export const TraceRepoTest = TraceRepo.layer.pipe(Layer.provide(TraceDb.layerAt(':memory:')), Layer.provide(NodePlatform))

/** A fresh in-memory alert store, seeded with the built-in rules, per provide. */
export const AlertRepoTest = AlertRepo.layer.pipe(Layer.provide(AlertDb.layerAt(':memory:')), Layer.provide(NodePlatform))

/** A fresh, migrated in-memory span database per provide, for schema-level checks. */
export const TraceDbTest = TraceDb.layerAt(':memory:').pipe(Layer.provide(NodePlatform))
