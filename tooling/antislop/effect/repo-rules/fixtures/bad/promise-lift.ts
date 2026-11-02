import { Duration as D, Effect as E } from 'effect'

export const program = E.tryPromise({
  try: () => E.sleep(D.seconds(1)),
  catch: error => error,
})
