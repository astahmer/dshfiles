import { Effect } from 'effect'

const handlers = { read: () => Effect.runPromise(Effect.succeed('value')) }
export const host = DshxEffect.host(api, handlers)
