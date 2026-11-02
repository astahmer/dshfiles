import { Cause, Effect, Schedule } from 'effect'

export const recurringTask = (options: {
  readonly run: () => Promise<void>
  readonly intervalMs: number
  readonly onFailure: (cause: Cause.Cause<unknown>) => void
}) =>
  Effect.tryPromise(options.run).pipe(
    Effect.catchCause(cause => Effect.sync(() => options.onFailure(cause))),
    Effect.repeat(Schedule.spaced(`${options.intervalMs} millis`)),
  )
