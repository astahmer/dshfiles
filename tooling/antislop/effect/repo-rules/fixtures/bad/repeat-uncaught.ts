import { Effect, Schedule } from 'effect'

declare const refresh: () => Promise<void>

const poll = Effect.tryPromise({ try: refresh, catch: cause => cause })
const pass = () => Effect.tryPromise({ try: refresh, catch: cause => cause })

export const direct = Effect.repeat(Effect.tryPromise({ try: refresh, catch: cause => cause }), Schedule.spaced('1 second'))
export const bound = Effect.forever(poll)
export const piped = pass().pipe(Effect.repeat(Schedule.spaced('1 second')))
export const pipedForever = poll.pipe(Effect.forever)
