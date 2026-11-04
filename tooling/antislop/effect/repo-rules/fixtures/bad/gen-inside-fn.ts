import { Effect } from 'effect'

export const read = Effect.fn('store read')((key: string) =>
  Effect.gen(function* () {
    return yield* Effect.succeed(key)
  }),
)
export const write = Effect.fn('store write')((key: string) => {
  return Effect.gen(function* () {
    return yield* Effect.succeed(key)
  })
})
