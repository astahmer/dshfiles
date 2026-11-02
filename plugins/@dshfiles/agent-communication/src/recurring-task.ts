import { type Cause, Duration, Effect, Schedule } from 'effect'

/** Run `run` now and every `interval` after; a failing run is reported and the next one still happens. */
export const recurringTask = <E, R>(options: {
  readonly run: Effect.Effect<void, E, R>
  readonly interval: Duration.Input
  readonly onFailure: (cause: Cause.Cause<E>) => Effect.Effect<void>
}) => options.run.pipe(Effect.catchCause(options.onFailure), Effect.repeat(Schedule.spaced(options.interval)))
