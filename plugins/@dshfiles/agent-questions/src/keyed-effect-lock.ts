import { Effect, Semaphore } from 'effect'

interface LockEntry {
  readonly semaphore: Semaphore.Semaphore
  users: number
}

export const createKeyedEffectLock = () => {
  const entries = new Map<string, LockEntry>()

  return {
    run: <Value>(input: { readonly key: string; readonly operation: () => Promise<Value> }): Promise<Value> => {
      const existing = entries.get(input.key)
      const entry = existing ?? { semaphore: Semaphore.makeUnsafe(1), users: 0 }
      if (existing === undefined) entries.set(input.key, entry)
      entry.users += 1

      return Effect.runPromise(
        entry.semaphore.withPermit(Effect.tryPromise({ try: input.operation, catch: error => error })).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              entry.users -= 1
              if (entry.users === 0 && entries.get(input.key) === entry) entries.delete(input.key)
            }),
          ),
        ),
      )
    },
    clear: () => entries.clear(),
  }
}
