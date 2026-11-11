import { Clock, Context, Effect, Exit, Option, References } from 'effect'
import type { SqlClient } from 'effect/sql'

export const LOCK_WAIT_SPAN = 'sqlite lock wait'

/**
 * Records one span when a top-level transaction waited at least `thresholdMs` before its body started: the wait for
 * this store's single connection (another fiber's statement or transaction) plus `BEGIN IMMEDIATE` busy-waiting on
 * another connection's write lock. `node:sqlite` busy-waits synchronously, so that part also blocks the event loop.
 * A transaction that waited that long and never started (`SQLITE_BUSY` after the busy timeout) records it as failed;
 * an instant failure (a store opened with `busyTimeout: 0` that retries on its own) records nothing.
 */
const recordWait = (input: { readonly database: string; readonly startNanos: bigint; readonly endNanos: bigint; readonly exit: Exit.Exit<unknown, unknown> }) =>
  Effect.gen(function* () {
    if (!(yield* References.TracerEnabled)) return
    const tracer = yield* Effect.tracer
    const parent = yield* Effect.option(Effect.currentParentSpan)
    const span = tracer.span({
      name: LOCK_WAIT_SPAN,
      parent,
      annotations: Context.empty(),
      links: [],
      startTime: input.startNanos,
      kind: 'internal',
      root: Option.isNone(parent),
      sampled: true,
    })
    span.attribute('db.system.name', 'sqlite')
    span.attribute('db.namespace', input.database)
    span.attribute('db.sqlite.lock_wait_ms', Math.round(Number(input.endNanos - input.startNanos) / 1_000_000))
    span.end(input.endNanos, input.exit)
  })

const nestedTransaction = (client: SqlClient.SqlClient) => Effect.map(Effect.context<never>(), context => Context.getOption(context, client.transactionService))

export const withLockWaitSpans = (client: SqlClient.SqlClient, options: { readonly database: string; readonly thresholdMs: number }): SqlClient.SqlClient => {
  if (options.thresholdMs <= 0) return client
  const thresholdNanos = BigInt(options.thresholdMs) * 1_000_000n
  const withTransaction: SqlClient.SqlClient['withTransaction'] = effect =>
    Effect.flatMap(nestedTransaction(client), open => {
      if (Option.isSome(open)) return client.withTransaction(effect)
      return Effect.flatMap(Clock.currentTimeNanos, startNanos => {
        let started = false
        const body = Effect.flatMap(Clock.currentTimeNanos, endNanos => {
          started = true
          const waited = endNanos - startNanos >= thresholdNanos
          return waited ? Effect.andThen(recordWait({ database: options.database, startNanos, endNanos, exit: Exit.void }), effect) : effect
        })
        return client
          .withTransaction(body)
          .pipe(
            Effect.onError(cause =>
              started
                ? Effect.void
                : Effect.flatMap(Clock.currentTimeNanos, endNanos =>
                    endNanos - startNanos >= thresholdNanos
                      ? recordWait({ database: options.database, startNanos, endNanos, exit: Exit.failCause(cause) })
                      : Effect.void,
                  ),
            ),
          )
      })
    })
  const construct = (first: TemplateStringsArray | string, ...args: Array<unknown>) => (typeof first === 'string' ? client(first) : client(first, ...args))
  const observed = Object.assign(construct, client, {
    withTransaction,
    withoutTransforms: () => withLockWaitSpans(client.withoutTransforms(), options),
  })
  return Object.assign(observed, { safe: observed })
}
