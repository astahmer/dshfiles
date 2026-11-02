import { Effect, Schema } from 'effect'

class Failure extends Schema.TaggedError<Failure>()('Failure', { message: Schema.String }) {}
export const program = Effect.fail(new Failure({ message: 'failed' }))
export const captured = Effect.try({
  try: () => {
    throw new Error('failed')
  },
  catch: () => new Failure({ message: 'failed' }),
})
