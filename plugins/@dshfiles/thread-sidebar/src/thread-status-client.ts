/**
 * The one status per thread (DESIGN.md › Components, "One status per item, on every surface"). The thread list computes
 * it once, with subagents rolled up (a parent whose turn ended while a child works is Working), and publishes it here;
 * the tab, the header and the palette read this value instead of deriving their own. Published as the
 * `@dshfiles/thread-sidebar/thread-status-client` dshx module: thread-sidebar provides the one source through the
 * registry, so a consumer's inlined copy of this file still reads the list's store.
 */
import { defineRegistry, useRegistry } from '@dshfiles/dshx/client'
import type { WorkStatus } from '@dshfiles/plugin-ui/components/work-status'
import { useSyncExternalStore } from 'react'

export interface ThreadWorkStatus {
  readonly status: WorkStatus
  /** The list's detail line, such as "Waiting on 1 subagent"; already in the user's language. */
  readonly detail: string | undefined
  /**
   * An attention row's kind as its line 2 says it (Approval, Question, or a Failed row's reason such as "Turn failed");
   * undefined for every other status. Optional, so an older publisher still type-checks.
   */
  readonly kind?: string | undefined
}

export type ThreadWorkStatusSnapshot = ReadonlyMap<string, ThreadWorkStatus>

export interface ThreadWorkStatusSource {
  /** Null while no thread list projects statuses (not mounted, or arranged without status glyphs). */
  readonly getSnapshot: () => ThreadWorkStatusSnapshot | null
  readonly subscribe: (listener: () => void) => () => void
}

export interface ThreadWorkStatusStore extends ThreadWorkStatusSource {
  /** Replace the projection; an equal one keeps the current snapshot, so readers do not re-render. */
  readonly publish: (next: ThreadWorkStatusSnapshot | null) => void
}

export const ThreadWorkStatusSources = defineRegistry<ThreadWorkStatusSource>('@dshfiles/thread-sidebar.thread-work-status')

const sameSnapshot = (left: ThreadWorkStatusSnapshot | null, right: ThreadWorkStatusSnapshot | null): boolean => {
  if (left === null || right === null) return left === right
  if (left.size !== right.size) return false
  for (const [sessionId, status] of left) {
    const other = right.get(sessionId)
    if (other === undefined || other.status !== status.status || other.detail !== status.detail || other.kind !== status.kind) return false
  }
  return true
}

const createStore = (): ThreadWorkStatusStore => {
  let snapshot: ThreadWorkStatusSnapshot | null = null
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    publish: next => {
      if (sameSnapshot(snapshot, next)) return
      snapshot = next
      for (const listener of listeners) listener()
    },
  }
}

const noSnapshot = (): null => null
const noSubscribe =
  (_listener: () => void): (() => void) =>
  () =>
    undefined

/** Every thread's projected status, or null while no list publishes one (fall back to your own facts then). */
export const useThreadWorkStatuses = (): ThreadWorkStatusSnapshot | null => {
  const source = useRegistry(ThreadWorkStatusSources)[0]
  return useSyncExternalStore(source?.subscribe ?? noSubscribe, source?.getSnapshot ?? noSnapshot, source?.getSnapshot ?? noSnapshot)
}

/** One thread's projected status; undefined while no list publishes, or the list does not show this thread. */
export const useThreadWorkStatus = (sessionId: string): ThreadWorkStatus | undefined => useThreadWorkStatuses()?.get(sessionId)

export const ThreadWorkStatusModel = {
  createStore,
  sameSnapshot,
}
