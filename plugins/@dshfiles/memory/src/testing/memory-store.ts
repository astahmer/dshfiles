import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Layer } from 'effect'

import { MemoryDb } from '../memory-db.ts'
import { MemoryRepo } from '../memory-repo.ts'

export const platformLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

/** The real repo over a SQLite file (or `:memory:`), migrated the way the Host opens it. */
export const repoLayer = (filename: string) => MemoryRepo.layer.pipe(Layer.provideMerge(MemoryDb.layer(filename)), Layer.provide(platformLayer))
