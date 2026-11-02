import * as E from 'effect'

export const program = E.tryPromise({
  try: () => E.sleep(E.Duration.seconds(1)),
  catch: error => error,
})
