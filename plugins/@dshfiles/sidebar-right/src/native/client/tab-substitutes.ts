import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { useEffect, useState, useSyncExternalStore } from 'react'

/** The keyed entry to show instead of a kind's own body for one Session, or undefined to keep it. */
export type TabSubstitute = (sessionId: SessionId) => Promise<string | undefined>

const substitutes = new Map<string, TabSubstitute>()
const listeners = new Set<() => void>()

/**
 * Let another plugin answer for one tab kind, per Session. A body such as a terminal may have nothing to run against on
 * this machine, and only the owner of that fact can say so.
 * @param kind - the tab kind.
 * @param substitute - resolves the entry key to show instead.
 * @returns the disposer.
 */
export const registerTabSubstitute = (kind: string, substitute: TabSubstitute): (() => void) => {
  substitutes.set(kind, substitute)
  for (const listener of listeners) listener()
  return () => {
    if (substitutes.get(kind) === substitute) substitutes.delete(kind)
    for (const listener of listeners) listener()
  }
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Which entry a tab shows. While the answer is pending nothing mounts, so a native body never starts for a Session it
 * cannot serve; a failed answer keeps the native body.
 * @param kind - the tab kind.
 * @param sessionId - the Session the seat draws.
 * @returns whether the answer is known, and the entry key when one replaces the body.
 */
export const useTabSubstitute = (kind: string, sessionId: SessionId): { readonly pending: boolean; readonly entryKey: string | undefined } => {
  const substitute = useSyncExternalStore(subscribe, () => substitutes.get(kind))
  const [answer, setAnswer] = useState<{ readonly sessionId: SessionId; readonly entryKey: string | undefined } | undefined>(undefined)
  useEffect(() => {
    if (substitute === undefined) return
    let live = true
    const settle = (entryKey: string | undefined): void => {
      if (live) setAnswer({ sessionId, entryKey })
    }
    substitute(sessionId).then(settle, () => {
      settle(undefined)
    })
    return () => {
      live = false
    }
  }, [sessionId, substitute])
  if (substitute === undefined) return { pending: false, entryKey: undefined }
  return answer?.sessionId === sessionId ? { pending: false, entryKey: answer.entryKey } : { pending: true, entryKey: undefined }
}
