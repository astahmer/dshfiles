import { Effect, Effectable } from 'effect'
import { Statement } from 'effect/sql'
import type { SqlClient, SqlError } from 'effect/sql'

const withoutTracer = Effect.withTracerEnabled(false)

/**
 * `effect/sql` opens a client span per statement from the calling fiber's tracer and has no client option to turn it
 * off, so the statement itself runs with the tracer disabled. Transaction spans and the caller's own spans stay.
 */
class UntracedStatement<A> extends Effectable.Class<ReadonlyArray<A>, SqlError.SqlError> implements Statement.Statement<A> {
  readonly '~effect/sql/Statement/Fragment' = '~effect/sql/Statement/Fragment'
  // Effect 4.1.2 requires the fragment brand on a Statement; the wrapped statement carries it already.
  readonly [Statement.FragmentTypeId]: Statement.FragmentTypeId = Statement.FragmentTypeId
  readonly #statement: Statement.Statement<A>

  constructor(statement: Statement.Statement<A>) {
    super()
    this.#statement = statement
  }

  get segments(): ReadonlyArray<Statement.Segment> {
    return this.#statement.segments
  }

  get raw(): Effect.Effect<unknown, SqlError.SqlError> {
    return withoutTracer(this.#statement.raw)
  }

  get withoutTransform(): Effect.Effect<ReadonlyArray<A>, SqlError.SqlError> {
    return withoutTracer(this.#statement.withoutTransform)
  }

  get stream(): Statement.Statement<A>['stream'] {
    return this.#statement.stream
  }

  get values(): Effect.Effect<ReadonlyArray<ReadonlyArray<unknown>>, SqlError.SqlError> {
    return withoutTracer(this.#statement.values)
  }

  get valuesUnprepared(): Effect.Effect<ReadonlyArray<ReadonlyArray<unknown>>, SqlError.SqlError> {
    return withoutTracer(this.#statement.valuesUnprepared)
  }

  get unprepared(): Effect.Effect<ReadonlyArray<A>, SqlError.SqlError> {
    return withoutTracer(this.#statement.unprepared)
  }

  compile(withoutTransform?: boolean | undefined): readonly [sql: string, params: ReadonlyArray<unknown>] {
    return this.#statement.compile(withoutTransform)
  }

  asEffect(): Effect.Effect<ReadonlyArray<A>, SqlError.SqlError> {
    return withoutTracer(this.#statement)
  }
}

export const untracedSqlClient = (client: SqlClient.SqlClient): SqlClient.SqlClient => {
  const construct = (first: TemplateStringsArray | string, ...args: Array<unknown>): Statement.Statement<object> | Statement.Identifier =>
    typeof first === 'string' ? client(first) : new UntracedStatement(client(first, ...args))
  const untraced = Object.assign(construct, client, {
    unsafe: <A extends object>(sql: string, params?: ReadonlyArray<unknown> | undefined) => new UntracedStatement(client.unsafe<A>(sql, params)),
    withoutTransforms: () => untracedSqlClient(client.withoutTransforms()),
  })
  return Object.assign(untraced, { safe: untraced })
}
