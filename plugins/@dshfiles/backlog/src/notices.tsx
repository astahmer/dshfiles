import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { useSyncExternalStore } from 'react'

/** What a report is about: work still running, work that finished, or work that could not start. */
export type BacklogNoticeKind = 'progress' | 'success' | 'failure'

/** One report from a start-thread run that outlives the dialog which asked for it. */
export interface BacklogNotice {
  readonly sequence: number
  readonly text: string
  readonly kind: BacklogNoticeKind
  /** The thread the report is about, when opening it is still the user's to do. */
  readonly sessionId: SessionId | null
}

/** A progress banner outlives the workspace it waits for; a finished one only has to be read. */
const HOLD_MS = { progress: 60_000, success: 6_000, failure: 9_000 } satisfies Record<BacklogNoticeKind, number>

/**
 * A thread started from an item is created in the background, so the dialog that asked for it is gone before the answer
 * arrives. The report travels through this module store: the client entry writes it, the shell overlay reads it, and a
 * newer report replaces the one on screen.
 */
let notice: BacklogNotice | null = null
let sequence = 0
const listeners = new Set<() => void>()

const notify = (): void => {
  for (const listener of listeners) listener()
}

const showNotice = (input: { readonly text: string; readonly kind: BacklogNoticeKind; readonly sessionId: SessionId | null }): void => {
  sequence += 1
  notice = { sequence, text: input.text, kind: input.kind, sessionId: input.sessionId }
  notify()
}

const clearNotice = (cleared: number): void => {
  if (notice?.sequence !== cleared) return
  notice = null
  notify()
}

const readNotice = (): BacklogNotice | null => notice

const subscribeNotice = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export class BacklogNotices {
  static readonly show = showNotice
  static readonly clear = clearNotice
  static readonly read = readNotice
  static readonly subscribe = subscribeNotice
}

/** The transient banner for the latest report; the shell overlay renders it wherever the user went. */
export const BacklogNoticeToast = (props: { readonly openThread: (sessionId: SessionId) => void }): JSX.Element | null => {
  const current = useSyncExternalStore(BacklogNotices.subscribe, BacklogNotices.read, () => null)
  if (current === null) return null
  const sessionId = current.sessionId
  return (
    <Toast
      key={current.sequence}
      text={current.text}
      holdMs={HOLD_MS[current.kind]}
      {...(current.kind === 'success' ? { tone: 'success' as const } : {})}
      {...(sessionId === null
        ? {}
        : {
            actions: [
              {
                label: 'Open',
                onClick: () => {
                  props.openThread(sessionId)
                  BacklogNotices.clear(current.sequence)
                },
              },
            ],
          })}
      onDone={() => BacklogNotices.clear(current.sequence)}
    />
  )
}
