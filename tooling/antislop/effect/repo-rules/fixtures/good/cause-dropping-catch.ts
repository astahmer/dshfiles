import { Effect, Schema } from 'effect'

class ReadError extends Schema.TaggedError<ReadError>()('ReadError', { path: Schema.String, cause: Schema.optional(Schema.Defect()) }) {}

export const mapped = Effect.tryPromise({ try: () => fetch('https://example.test'), catch: cause => new ReadError({ path: 'a', cause }) })
export const named = Effect.try({ try: () => JSON.parse('{}'), catch: error => new ReadError({ path: 'b', cause: error }) })
