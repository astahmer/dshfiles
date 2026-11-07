import { Alert, AlertDescription, AlertTitle } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { RefreshCwIcon } from '@dshfiles/plugin-ui/icons'
import type { UsageCard } from './api.js'
import { useQuotaClock } from './quota-clock.js'
import { UsageOverviewModel } from './usage-overview-model.js'

/** Reading usage failed as a whole: why, what is on screen instead, and the retry. */
export const UsageRefreshNotice = (props: {
  readonly failure: string | null
  readonly hasReading: boolean
  readonly refreshing: boolean
  readonly onRetry: () => void
}): JSX.Element | null => {
  if (props.failure === null) return null
  return (
    <Alert variant="warning">
      <AlertTitle>Usage could not be refreshed</AlertTitle>
      <AlertDescription className="dshx:text-xs">
        <p>
          {props.failure}
          {props.hasReading ? ' The figures shown are from the last successful read.' : ''}
        </p>
        <Button disabled={props.refreshing} onClick={props.onRetry} size="xs" type="button" variant="outline">
          <RefreshCwIcon aria-hidden className={props.refreshing ? 'dshx:animate-spin' : undefined} />
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  )
}

/** The age of a reading with no per-card status beside it. */
export const UsageUpdatedAt = (props: { readonly readAt: number }): JSX.Element => {
  const now = useQuotaClock({ resetsAt: [] })
  return (
    <p className="dshx:text-[11px] dshx:text-muted-foreground dshx:tabular-nums">
      <time dateTime={new Date(props.readAt).toISOString()}>Updated {UsageOverviewModel.formatReadAge(props.readAt, now)}</time>
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
  const age = UsageOverviewModel.formatReadAge(UsageOverviewModel.cardReadAt(usage, props.sweepReadAt), now)
  const reason = UsageOverviewModel.readFailureReason(usage)
  const nextReading = UsageOverviewModel.nextReading(usage, now)
  const failed = unreadable || reason !== null
  return (
    <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-x-2 dshx:gap-y-1 dshx:text-[11px] dshx:text-muted-foreground dshx:tabular-nums">
      {reason === null ? null : <span className="dshx:min-w-0 dshx:basis-full dshx:break-words dshx:text-warning">{reason}</span>}
      <span>{unreadable ? `Last tried ${age}` : reason === null ? `Updated ${age}` : `Last good reading ${age}`}</span>
      {nextReading === null ? null : <span>{nextReading}</span>}
      {failed && nextReading === null ? (
        <Button className="dshx:h-5 dshx:px-1.5 dshx:text-[11px]" disabled={props.refreshing} onClick={props.onRetry} size="xs" type="button" variant="outline">
          Retry
        </Button>
      ) : null}
    </div>
  )
}
