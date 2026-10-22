import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { useSyncExternalStore } from 'react'

/** One report about a thread a first send created away from the screen the user was watching. */
export interface ThreadNotice {
  readonly sequence: number
  readonly text: string
  readonly sessionId: SessionId
}

/**
 * A first send whose New thread screen the user left keeps running in the background, and the created thread is offered
 * rather than opened. That answer arrives after the composer that asked for it is gone, so it travels through this
 * module store: the client entry writes it, the shell overlay reads it, and a newer report replaces the one on screen.
 */
let notice: ThreadNotice | null = null
let sequence = 0
const listeners = new Set<() => void>()

const notify = (): void => {
  for (const listener of listeners) listener()
}

const showNotice = (input: { readonly text: string; readonly sessionId: SessionId }): void => {
  sequence += 1
  notice = { sequence, text: input.text, sessionId: input.sessionId }
  notify()
}

const clearNotice = (cleared: number): void => {
  if (notice?.sequence !== cleared) return
  notice = null
  notify()
}

const readNotice = (): ThreadNotice | null => notice

const subscribeNotice = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export class ThreadNotices {
  static readonly show = showNotice
  static readonly clear = clearNotice
  static readonly read = readNotice
  static readonly subscribe = subscribeNotice
}

/** The transient banner for the latest report; the shell overlay renders it wherever the user went. */
export const ThreadNoticeToast = (props: { readonly openThread: (sessionId: SessionId) => void; readonly openLabel: string }): JSX.Element | null => {
  const current = useSyncExternalStore(ThreadNotices.subscribe, ThreadNotices.read, () => null)
  if (current === null) return null
  return (
    <Toast
      key={current.sequence}
      text={current.text}
      holdMs={8_000}
      tone="success"
      actions={[
        {
          label: props.openLabel,
          onClick: () => {
            props.openThread(current.sessionId)
            ThreadNotices.clear(current.sequence)
          },
        },
      ]}
      onDone={() => ThreadNotices.clear(current.sequence)}
    />
  )
}
