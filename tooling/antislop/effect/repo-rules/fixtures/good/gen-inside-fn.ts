import { Effect } from 'effect'

export const read = Effect.fn('store read')(function* (key: string) {
  return yield* Effect.succeed(key)
})
export const lookup = Effect.fn('store lookup')((key: string) => Effect.succeed(key))
