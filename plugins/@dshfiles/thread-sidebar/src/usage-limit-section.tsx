import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { MoreVerticalIcon, RefreshCwIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { ThreadSidebarLocaleKey } from './locales.js'
import { UsageLimitRowsModel, type UsageLimitRow } from './usage-limit-rows.js'

export type UsageLimitSnooze = 'one-hour' | 'four-hours' | 'one-day' | 'unsnooze'

/** What a row needs from its thread; the sidebar's SessionSummary satisfies it. */
export interface UsageLimitThread {
  readonly id: string
  readonly displayTitle: string
}

export interface UsageLimitSectionProps<Thread extends UsageLimitThread> {
  readonly rows: readonly UsageLimitRow<Thread>[]
  readonly now: number
  readonly busyIds: ReadonlySet<string>
  readonly resumeAllBusy: boolean
  readonly translate: (key: ThreadSidebarLocaleKey, params?: Readonly<Record<string, string | number>>) => string
  readonly open: (sessionId: Thread['id']) => void
  readonly onResume: (input: { readonly continuationId: string; readonly sessionId: string }) => void
  readonly onSnooze: (input: { readonly continuationId: string; readonly duration: UsageLimitSnooze }) => void
  readonly onAutoRetry: (input: { readonly continuationId: string; readonly sessionId: string; readonly enabled: boolean }) => void
  readonly onResumeAll: () => void
  /** Wraps a row in the thread's own right-click menu. */
  readonly withThreadMenu: (thread: Thread, row: JSX.Element) => JSX.Element
}

const SNOOZES: readonly { readonly duration: UsageLimitSnooze; readonly labelKey: ThreadSidebarLocaleKey }[] = [
  { duration: 'one-hour', labelKey: 'threadSidebarUsageLimitSnoozeHour' },
  { duration: 'four-hours', labelKey: 'threadSidebarUsageLimitSnoozeFourHours' },
  { duration: 'one-day', labelKey: 'threadSidebarUsageLimitSnoozeDay' },
]

/**
 * Threads whose last turn the provider refused for quota or a rate limit. The
 * recoveries come from `@dshfiles/ai-accounts`, which owns the durable record,
 * the reset clock and the continuation prompt; this section only shows them
 * where the blocked thread already lives.
 */
export const UsageLimitSection = <Thread extends UsageLimitThread>(props: UsageLimitSectionProps<Thread>): JSX.Element | null => {
  const t = props.translate
  const statusText = (timing: ReturnType<typeof UsageLimitRowsModel.timing>): string => {
    switch (timing.kind) {
      case 'snoozed':
        return t('threadSidebarUsageLimitSnoozed', { time: UsageLimitRowsModel.formatRemaining(timing.until, props.now) })
      case 'ready':
        return t('threadSidebarUsageLimitReady')
      case 'waiting':
        return t('threadSidebarUsageLimitResets', { time: UsageLimitRowsModel.formatRemaining(timing.resetAt, props.now) })
      default:
        return t('threadSidebarUsageLimitUnknown')
    }
  }
  if (props.rows.length === 0) return null
  const busyCount = props.rows.filter(row => props.busyIds.has(row.continuation.continuationId)).length
  const allBusy = busyCount === props.rows.length

  return (
    <section aria-label={t('threadSidebarUsageLimit')} className="dshx:mt-1">
      <div className={cn('dshx:sticky dshx:top-0 dshx:z-10 dshx:bg-background dshx:flex dshx:h-8 dshx:items-center dshx:gap-2 dshx:px-2.5 dshx:text-sm')}>
        <span className="dshx:whitespace-nowrap dshx:font-medium dshx:text-warning/80">{t('threadSidebarUsageLimit')}</span>
        <span className="dshx:text-xs dshx:tabular-nums">({props.rows.length})</span>
        <span aria-hidden="true" className="dshx:h-px dshx:flex-1 dshx:bg-border" />
        <Button disabled={props.resumeAllBusy || allBusy} onClick={props.onResumeAll} size="xs" type="button" variant="outline">
          {props.resumeAllBusy ? <Spinner className="dshx:size-3" /> : null}
          {t('threadSidebarUsageLimitResumeAll')}
        </Button>
      </div>
      {props.rows.map(row => {
        const busy = props.busyIds.has(row.continuation.continuationId)
        const timing = UsageLimitRowsModel.timing(row.continuation, props.now)
        const snoozed = timing.kind === 'snoozed'
        const status = statusText(timing)

        return props.withThreadMenu(
          row.session,
          <div
            className="dshx:group/usage dshx:flex dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:px-2.5 dshx:py-1.5 dshx:hover:bg-accent/40"
            key={row.continuation.continuationId}
          >
            <button className="dshx:min-w-0 dshx:flex-1 dshx:text-left" onClick={() => props.open(row.session.id)} type="button">
              <span className={cn('dshx:block dshx:truncate dshx:text-sm', snoozed && 'dshx:text-muted-foreground')}>
                {row.session.displayTitle.length > 0 ? row.session.displayTitle : t('threadSidebarUntitledThread')}
              </span>
              <span className="dshx:mt-0.5 dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-x-2 dshx:gap-y-0.5 dshx:text-xs dshx:text-muted-foreground">
                <Badge variant={timing.kind === 'ready' ? 'success' : snoozed ? 'muted' : 'warning'}>{status}</Badge>
                {row.continuation.autoRetry ? <span>{t('threadSidebarUsageLimitAutoRetryOn')}</span> : null}
                {row.continuation.scheduled ? <span>{t('threadSidebarUsageLimitScheduled')}</span> : null}
              </span>
            </button>
            <Button
              aria-label={t('threadSidebarUsageLimitResume')}
              disabled={busy}
              onClick={() => props.onResume({ continuationId: row.continuation.continuationId, sessionId: row.session.id })}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              {busy ? <Spinner className="dshx:size-3.5" /> : <RefreshCwIcon className="dshx:size-3.5" />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button aria-label={t('threadSidebarUsageLimitOptions')} size="icon-xs" type="button" variant="ghost">
                  <MoreVerticalIcon className="dshx:size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{t('threadSidebarUsageLimitRecovery')}</DropdownMenuLabel>
                {SNOOZES.map(snooze => (
                  <DropdownMenuItem
                    key={snooze.duration}
                    onSelect={() => props.onSnooze({ continuationId: row.continuation.continuationId, duration: snooze.duration })}
                  >
                    {t(snooze.labelKey)}
                  </DropdownMenuItem>
                ))}
                {snoozed ? (
                  <DropdownMenuItem onSelect={() => props.onSnooze({ continuationId: row.continuation.continuationId, duration: 'unsnooze' })}>
                    {t('threadSidebarUsageLimitSnoozeOff')}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={row.continuation.autoRetry}
                  onCheckedChange={enabled => props.onAutoRetry({ continuationId: row.continuation.continuationId, sessionId: row.session.id, enabled })}
                >
                  {t('threadSidebarUsageLimitAutoRetry')}
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>,
        )
      })}
    </section>
  )
}
