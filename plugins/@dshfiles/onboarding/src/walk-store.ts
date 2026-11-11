import { useSyncExternalStore } from 'react'

/** The feature Show me where walks, in memory only: one walk at a time, nothing survives a reload. */
let current: string | null = null
const listeners = new Set<() => void>()
const publish = (next: string | null): void => {
  current = next
  for (const listener of listeners) listener()
}
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export class WalkStore {
  static readonly useCurrent = (): string | null =>
    useSyncExternalStore(
      subscribe,
      () => current,
      () => current,
    )
  /** Starting a walk replaces the one in progress. */
  static readonly start = (key: string): void => publish(key)
  static readonly end = (): void => publish(null)
}
