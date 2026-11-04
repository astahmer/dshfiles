import { Effect, Ref } from 'effect'

const limit = 10
const cache = new WeakMap<object, number>()

export const counter = Effect.gen(function* () {
  let attempts = 0
  attempts += limit
  cache.set({}, attempts)
  return yield* Ref.make(attempts)
})
