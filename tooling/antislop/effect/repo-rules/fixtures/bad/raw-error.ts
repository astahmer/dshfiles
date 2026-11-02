import { Effect } from 'effect'

export const program = Effect.sync(() => {
  throw new Error('failed')
})
export const failed = Effect.fail(new Error('failed'))
