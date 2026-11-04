import { Effect } from 'effect'

declare const save: () => Promise<void>

export const fire = () => {
  void save().then(() => undefined)
  void save()
    .then(() => undefined)
    .catch(() => undefined)
  return Effect.void
}
