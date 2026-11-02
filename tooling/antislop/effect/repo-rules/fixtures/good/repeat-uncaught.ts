import { Effect, Schedule } from 'effect'

declare const refresh: () => Promise<void>

const poll = Effect.tryPromise({ try: refresh, catch: cause => cause }).pipe(Effect.ignore)
const pass = () => Effect.tryPromise({ try: refresh, catch: cause => cause })

export const caught = Effect.forever(poll)
export const recovered = pass().pipe(
  Effect.catchCause(() => Effect.void),
  Effect.repeat(Schedule.spaced('1 second')),
)
export const infallible = Effect.repeat(
  Effect.sync(() => 1),
  Schedule.spaced('1 second'),
)
