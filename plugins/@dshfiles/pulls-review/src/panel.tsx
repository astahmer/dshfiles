import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { useSyncExternalStore, type ReactNode } from 'react'
import { ReviewSurface } from './review-surface.js'
import type { SessionFocus } from './session-focus.js'

export interface PullsReviewPanelProps {
  readonly sessions: ISessions
  readonly focus: SessionFocus
}

const noBody = (): undefined => undefined

/** The main-area review page: the same surface as the Sidebar tab, on the on-screen thread's workspace. */
export const PullsReviewPanel = (props: PullsReviewPanelProps): ReactNode => {
  const sessionId = useSyncExternalStore(
    listener => props.focus.subscribe(listener),
    () => props.focus.getSnapshot(),
    noBody,
  )
  const cwd = useSyncExternalStore(
    listener => props.sessions.list.subscribe(listener),
    () => (sessionId === undefined ? undefined : props.sessions.list.getSnapshot().byId[sessionId]?.cwd),
    noBody,
  )
  return <ReviewSurface workspacePath={cwd} variant="page" sessionId={sessionId === undefined ? undefined : String(sessionId)} />
}
