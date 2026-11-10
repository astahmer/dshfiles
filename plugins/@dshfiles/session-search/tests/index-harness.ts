import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { SqliteStore } from '@dshfiles/sqlite-store'
import { Context, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'
import { indexMigrations, SearchIndex } from '../src/index-db.js'

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

/** Opens a real store for one test phase and closes it with the scope, like the worker does. */
export const withIndex = <A, E>(filename: string, use: (index: SearchIndex) => Effect.Effect<A, E>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(SqliteStore.layer({ filename, migrations: indexMigrations }).pipe(Layer.provide(platform)))
      return yield* use(new SearchIndex(Context.get(context, SqlClient.SqlClient), filename))
    }),
  )

export const runWithIndex = <A>(filename: string, use: (index: SearchIndex) => Effect.Effect<A, unknown>): Promise<A> =>
  Effect.runPromise(withIndex(filename, use).pipe(Effect.orDie))
