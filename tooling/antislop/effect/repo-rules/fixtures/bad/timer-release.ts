import { Effect } from 'effect'

export const program = Effect.acquireRelease(Effect.succeed(undefined), () => Effect.sync(() => setTimeout(() => {}, 1_000)))
