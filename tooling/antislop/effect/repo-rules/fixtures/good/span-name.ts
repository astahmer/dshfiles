import { Effect } from 'effect'

declare const api: string

export const read = Effect.fn('store read')(function* () {
  return yield* Effect.succeed(1)
})
export const list = Effect.succeed(1).pipe(Effect.withSpan('memory notes list'))
export const dynamic = Effect.succeed(1).pipe(Effect.withSpan(`${api} call`))
export const untraced = Effect.fn(function* () {
  return yield* Effect.succeed(1)
})
