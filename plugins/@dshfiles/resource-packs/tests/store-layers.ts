import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { layer as nodePathLayer } from '@effect/platform-node/NodePath'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { Effect, FileSystem, Layer, Path } from 'effect'
import { SqlClient } from 'effect/sql'
import { ResourceStore, ResourceStoreFile } from '../src/store.js'

export const platformLayer = Layer.mergeAll(nodeFileSystemLayer, nodePathLayer)

/** A registry file in a fresh private directory removed with the test scope. */
export const scratchStoreFile = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'resource-packs-store-' })
  return { directory, filename: path.join(directory, 'metadata', 'resources.db') }
})

export const storeLayer = (filename: string) => ResourceStore.layer.pipe(Layer.provide(Layer.mergeAll(ResourceStoreFile.layer(filename), platformLayer)))

/** One open of the registry: the handle closes when the effect ends, so a second call is a real reopen. */
export const withStore = <A, E>(filename: string, use: (store: ResourceStore['Service']) => Effect.Effect<A, E>) =>
  ResourceStore.use(use).pipe(Effect.provide(storeLayer(filename)))

/** Direct SQL on the file, bypassing the plugin, to corrupt or inspect it the way another process could. */
export const withRawSql = <A, E>(filename: string, use: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
  Effect.flatMap(SqlClient.SqlClient, use).pipe(Effect.provide(SqliteClient.layer({ filename })))
