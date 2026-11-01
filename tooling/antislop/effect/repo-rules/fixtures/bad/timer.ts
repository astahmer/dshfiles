import { Effect } from 'effect'

export const start = Effect.sync(() => setInterval(() => {}, 1_000))
