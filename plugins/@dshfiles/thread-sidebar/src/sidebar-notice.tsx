import { AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { XIcon } from '@dshfiles/plugin-ui/icons'

export interface SidebarNotice {
  readonly tone: 'danger' | 'warning' | 'success'
  readonly message: string
  readonly actionLabel?: string
  readonly onAction?: () => void
  readonly durationMs?: number
}

export interface SidebarNoticeQueueState {
  readonly current: SidebarNotice | null
  readonly currentIsNotification: boolean
  readonly pending: readonly SidebarNotice[]
}

export type SidebarNoticeQueueAction =
  | { readonly type: 'enqueue-notification'; readonly notice: SidebarNotice }
  | { readonly type: 'set'; readonly notice: SidebarNotice | null }
  | { readonly type: 'update'; readonly update: (current: SidebarNotice | null) => SidebarNotice | null }

export const MAX_PENDING_SIDEBAR_NOTICES = 5_000

export const INITIAL_SIDEBAR_NOTICE_QUEUE_STATE: SidebarNoticeQueueState = {
  current: null,
  currentIsNotification: false,
  pending: [],
}

const enqueueSidebarNotice = (pending: readonly SidebarNotice[], notice: SidebarNotice): readonly SidebarNotice[] =>
  [...pending, notice].slice(-MAX_PENDING_SIDEBAR_NOTICES)

const takeNextSidebarNotice = (pending: readonly SidebarNotice[]) => ({
  notice: pending[0] ?? null,
  pending: pending.slice(1),
})

export const sidebarNoticeQueueReducer = (state: SidebarNoticeQueueState, action: SidebarNoticeQueueAction): SidebarNoticeQueueState => {
  if (action.type === 'enqueue-notification') {
    if (state.current === null) return { current: action.notice, currentIsNotification: true, pending: state.pending }
    return { ...state, pending: enqueueSidebarNotice(state.pending, action.notice) }
  }

  const nextNotice = action.type === 'update' ? action.update(state.current) : action.notice
  if (nextNotice === null) {
    const next = takeNextSidebarNotice(state.pending)
    if (state.current === null && next.notice === null) return state
    return { current: next.notice, currentIsNotification: next.notice !== null, pending: next.pending }
  }
  if (nextNotice === state.current) return state

  const pending =
    state.currentIsNotification && state.current !== null ? [state.current, ...state.pending].slice(0, MAX_PENDING_SIDEBAR_NOTICES) : state.pending
  return { current: nextNotice, currentIsNotification: false, pending }
}

export const SUCCESS_NOTICE_DURATION_MS = 3_000

/** The archived-open notice offers a recovery action, so it lasts longer than a confirmation but still clears itself. */
export const ARCHIVED_OPEN_NOTICE_DURATION_MS = 10_000

export const archivedOpenFailureNotice = (options: {
  readonly message: string
  readonly actionLabel: string
  readonly onAction: () => void
}): SidebarNotice => ({
  tone: 'danger',
  message: options.message,
  actionLabel: options.actionLabel,
  onAction: options.onAction,
  durationMs: ARCHIVED_OPEN_NOTICE_DURATION_MS,
})

export const failedResumeNotice = <SessionId extends string>(options: {
  readonly message: string
  readonly actionLabel: string
  readonly failedSessionIds: readonly SessionId[]
  readonly openThread: (sessionId: SessionId) => void
}): SidebarNotice => {
  const firstFailedSessionId = options.failedSessionIds[0]
  if (firstFailedSessionId === undefined) return { tone: 'warning', message: options.message }

  return {
    tone: 'warning',
    message: options.message,
    actionLabel: options.actionLabel,
    onAction: () => options.openThread(firstFailedSessionId),
  }
}

export const SidebarNoticeMessage = (props: { readonly message: string }): JSX.Element => (
  <AlertDescription className="dshx:text-xs dshx:whitespace-nowrap">{props.message}</AlertDescription>
)

export const SidebarNotificationDismissButton = (props: { readonly label: string; readonly onDismiss: () => void }): JSX.Element => (
  <Button size="icon-xs" type="button" variant="ghost" aria-label={props.label} onClick={props.onDismiss}>
    <XIcon />
  </Button>
)

export const scheduleSuccessNoticeDismissal = (
  notice: SidebarNotice,
  setNotice: (update: (current: SidebarNotice | null) => SidebarNotice | null) => void,
): (() => void) | undefined => {
  if (notice.durationMs === 0 || (notice.tone !== 'success' && notice.durationMs === undefined)) return

  const timer = setTimeout(() => {
    setNotice(current => (current === notice ? null : current))
  }, notice.durationMs ?? SUCCESS_NOTICE_DURATION_MS)

  return () => clearTimeout(timer)
}
