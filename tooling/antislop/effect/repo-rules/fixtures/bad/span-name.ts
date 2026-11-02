import { Effect } from 'effect'

export const dotted = Effect.fn('Store.read')(function* () {
  return yield* Effect.succeed(1)
})
export const single = Effect.fn('read')(function* () {
  return yield* Effect.succeed(1)
})
export const prefixed = Effect.succeed(1).pipe(Effect.withSpan('dshx-effect store/read'))
