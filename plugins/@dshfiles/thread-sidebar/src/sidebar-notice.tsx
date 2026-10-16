import { AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'

export interface SidebarNotice {
  readonly tone: 'danger' | 'warning' | 'success'
  readonly message: string
  readonly actionLabel?: string
  readonly onAction?: () => void
  readonly durationMs?: number
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

export const SidebarNoticeMessage = (props: { readonly message: string }): JSX.Element => (
  <AlertDescription className="dshx:text-xs dshx:whitespace-nowrap">{props.message}</AlertDescription>
)

export const scheduleSuccessNoticeDismissal = (
  notice: SidebarNotice,
  setNotice: (update: (current: SidebarNotice | null) => SidebarNotice | null) => void,
): (() => void) | undefined => {
  if (notice.tone !== 'success' && notice.durationMs === undefined) return

  const timer = setTimeout(() => {
    setNotice(current => (current === notice ? null : current))
  }, notice.durationMs ?? SUCCESS_NOTICE_DURATION_MS)

  return () => clearTimeout(timer)
}
