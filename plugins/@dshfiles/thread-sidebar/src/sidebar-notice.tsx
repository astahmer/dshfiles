import { AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'

export interface SidebarNotice {
  readonly tone: 'danger' | 'warning' | 'success'
  readonly message: string
  readonly actionLabel?: string
  readonly onAction?: () => void
  readonly durationMs?: number
}

export const SUCCESS_NOTICE_DURATION_MS = 3_000
export const UNDO_NOTICE_DURATION_MS = 5_000

export const SidebarNoticeMessage = (props: { readonly message: string }): JSX.Element => (
  <AlertDescription className="dshx:text-xs dshx:whitespace-nowrap">{props.message}</AlertDescription>
)

export const scheduleSuccessNoticeDismissal = (
  notice: SidebarNotice,
  setNotice: (update: (current: SidebarNotice | null) => SidebarNotice | null) => void,
): (() => void) | undefined => {
  if (notice.tone !== 'success') return

  const timer = setTimeout(() => {
    setNotice(current => (current === notice ? null : current))
  }, notice.durationMs ?? SUCCESS_NOTICE_DURATION_MS)

  return () => clearTimeout(timer)
}
