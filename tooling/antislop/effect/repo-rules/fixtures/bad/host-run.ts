import { Effect } from 'effect'

const read = () => Effect.runPromise(Effect.succeed('value'))
export const host = DshxEffect.host(api, { read })
