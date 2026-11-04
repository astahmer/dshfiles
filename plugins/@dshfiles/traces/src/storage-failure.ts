import { Cause, Effect, Schema } from 'effect'
import { SqlError } from 'effect/sql'

type StorageFailure = SqlError.SqlError | Schema.SchemaError | Cause.NoSuchElementError

const isStorageFailure = <E>(error: E): error is Extract<E, StorageFailure> =>
  SqlError.isSqlError(error) || error instanceof Schema.SchemaError || Cause.isNoSuchElementError(error)

/** Both stores are this plugin's own files: a failing statement or an undecodable row is a defect the Host log explains, not a caller error. */
export const orDieOnStorage = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.catchIf(effect, isStorageFailure, Effect.die, Effect.fail)
