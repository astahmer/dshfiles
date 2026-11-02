import { Effect } from 'effect'

export const start = Effect.acquireRelease(
  Effect.sync(() => setInterval(() => {}, 1_000)),
  timer => Effect.sync(() => clearInterval(timer)),
)
