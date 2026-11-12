import { useSyncExternalStore } from 'react'

/**
 * Whether a destination page (Inbox, Backlog, Settings…) or the phone's full-screen list covers the stage, so the
 * selected thread is not on screen: a turn that finishes meanwhile was not watched and stays in the Inbox until the
 * thread is opened again. The shell writes it; the thread list reads it. A page-wide store rather than sidebar context
 * state, so a change re-renders only the readers, never the preferences provider (a context update there raced
 * preference writes in flight).
 */
let covered = false
const listeners = new Set<() => void>()

export const StageCover = {
  set(next: boolean): void {
    if (next === covered) return
    covered = next
    for (const listener of listeners) listener()
  },
  get: (): boolean => covered,
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
} as const

export const useStageCovered = (): boolean => useSyncExternalStore(StageCover.subscribe, StageCover.get, () => false)
