import { Effect } from 'effect'
import { ThreadHostCallFailed } from './sidebar-errors.js'

/** The Promise edge under a subscription notice: one adapter, so the Effect side owns no promise lifting. */
export const hostCall = <A>(run: (signal: AbortSignal) => Promise<A>): Effect.Effect<A, ThreadHostCallFailed> =>
  Effect.tryPromise({ try: run, catch: cause => new ThreadHostCallFailed({ cause }) })
