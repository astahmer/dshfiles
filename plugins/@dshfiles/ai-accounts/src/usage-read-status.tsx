import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { RefreshCwIcon, TriangleAlertIcon } from '@dshfiles/plugin-ui/icons'
import type { UsageCard } from './api.js'
import { useQuotaClock } from './quota-clock.js'
import { UsageOverviewModel } from './usage-overview-model.js'

const readingTime = (readAt: number): string => new Date(readAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' })

/** A failed read as one compact line: what failed, why, and the retry. */
export const UsageRefreshNotice = (props: {
  readonly failure: string | null
  readonly refreshing: boolean
  readonly onRetry: () => void
}): JSX.Element | null => {
  if (props.failure === null) return null
  return (
    <div
      className="dshx:flex dshx:items-center dshx:gap-2 dshx:rounded-md dshx:border dshx:border-warning/40 dshx:bg-warning/10 dshx:px-2 dshx:py-1 dshx:text-xs"
      role="alert"
    >
      <TriangleAlertIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0 dshx:text-warning" />
      <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">
        <span className="dshx:font-medium">Refresh failed</span>
        <span aria-hidden className="dshx:text-muted-foreground">
          {' '}
          · {props.failure}
        </span>
      </span>
      <span className="dshx:sr-only">{props.failure}</span>
      <Button
        className="dshx:h-5 dshx:shrink-0 dshx:px-1.5 dshx:text-[11px]"
        disabled={props.refreshing}
        onClick={props.onRetry}
        size="xs"
        type="button"
        variant="outline"
      >
        <RefreshCwIcon aria-hidden className={props.refreshing ? 'dshx:animate-spin' : undefined} />
        Retry
      </Button>
    </div>
  )
}

/** The age of a reading with no per-card status beside it. */
export const UsageUpdatedAt = (props: { readonly readAt: number }): JSX.Element => {
  const now = useQuotaClock({ resetsAt: [] })
  return (
    <p className="dshx:text-[11px] dshx:text-muted-foreground dshx:tabular-nums">
      Updated {UsageOverviewModel.formatReadAge(props.readAt, now)} · <time dateTime={new Date(props.readAt).toISOString()}>{readingTime(props.readAt)}</time>
    </p>
  )
}

/**
 * How current one card is: when it was read, why a newer reading is missing, and what the user can do about it.
 * A retry is offered only when one can reach the provider; while reads are held back it says when one can.
 */
export const UsageReadStatus = (props: {
  readonly usage: UsageCard
  readonly sweepReadAt: number
  readonly refreshing: boolean
  readonly onRetry: () => void
}): JSX.Element | null => {
  const { usage } = props
  const now = useQuotaClock({ resetsAt: [usage.nextReadAt ?? null] })
  const unreadable = usage.status === 'error' || usage.status === 'rate-limited'
  if (usage.status !== 'ok' && !unreadable) return null
  const readAt = UsageOverviewModel.cardReadAt(usage, props.sweepReadAt)
  const age = UsageOverviewModel.formatReadAge(readAt, now)
  const reason = UsageOverviewModel.readFailureReason(usage)
  const nextReading = UsageOverviewModel.nextReading(usage, now)
  const failed = unreadable || reason !== null
  return (
    <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-x-2 dshx:gap-y-1 dshx:text-[11px] dshx:text-muted-foreground dshx:tabular-nums">
      {reason === null ? null : <span className="dshx:min-w-0 dshx:basis-full dshx:break-words dshx:text-warning">{reason}</span>}
      <span>
        {unreadable ? `Last tried ${age}` : reason === null ? `Updated ${age}` : `Last good reading ${age}`} ·{' '}
        <time dateTime={new Date(readAt).toISOString()}>{readingTime(readAt)}</time>
      </span>
      {nextReading === null ? null : <span>{nextReading}</span>}
      {failed && nextReading === null ? (
        <Button className="dshx:h-5 dshx:px-1.5 dshx:text-[11px]" disabled={props.refreshing} onClick={props.onRetry} size="xs" type="button" variant="outline">
          Retry
        </Button>
      ) : null}
    </div>
  )
}
