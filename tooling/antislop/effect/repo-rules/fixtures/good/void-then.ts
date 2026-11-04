import { Effect } from 'effect'

declare const save: () => Promise<void>

export const fire = () => {
  void save()
  return Effect.promise(() => save().then(() => undefined))
}
