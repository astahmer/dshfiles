import { Effect, Schema } from 'effect'

class ReadError extends Schema.TaggedError<ReadError>()('ReadError', { path: Schema.String }) {}

export const ignored = Effect.tryPromise({ try: () => fetch('https://example.test'), catch: () => new ReadError({ path: 'a' }) })
export const leaked = Effect.tryPromise({ try: () => fetch('https://example.test'), catch: error => error })
export const unused = Effect.try({ try: () => JSON.parse('{}'), catch: _error => new ReadError({ path: 'b' }) })
