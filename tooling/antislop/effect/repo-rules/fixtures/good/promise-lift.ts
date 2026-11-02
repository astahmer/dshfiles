import { Effect } from 'effect'

export const program = Effect.tryPromise({
  try: () => fetch('/health'),
  catch: error => error,
})
