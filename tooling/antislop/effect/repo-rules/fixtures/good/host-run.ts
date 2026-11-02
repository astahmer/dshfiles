import { Effect } from 'effect'

export const host = DshxEffect.host(api, {
  read: () => Effect.succeed('value'),
})
