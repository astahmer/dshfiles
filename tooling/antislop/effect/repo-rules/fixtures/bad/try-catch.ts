import { Effect } from 'effect'

export const run = async () => {
  try {
    return await Effect.runPromise(Effect.succeed('done'))
  } catch (error) {
    return String(error)
  }
}
