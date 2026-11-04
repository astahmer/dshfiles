import { Duration, Effect, Schedule } from 'effect'

export const later = (run: () => void) => Effect.sleep(Duration.millis(10)).pipe(Effect.andThen(Effect.sync(run)))
export const every = (run: () => void) => Effect.repeat(Effect.sync(run), Schedule.spaced('10 millis'))
