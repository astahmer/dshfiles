import { Progress } from '@dshfiles/plugin-ui/components/ui/progress'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { ExtraUsage } from './extra-usage-schema.js'
import { ExtraUsageModel } from './extra-usage-model.js'
import { QUOTA_TONE_PROGRESS, QUOTA_TONE_TEXT, quotaTone } from './quota-tone.js'
import { UsageOverviewModel } from './usage-overview-model.js'

/** Claude's pay-as-you-go spend against its monthly cap, under the plan windows of a usage card. */
export const ExtraUsageMeter = (props: {
  readonly extra: ExtraUsage
  readonly now: number
  readonly muted?: boolean
  readonly className?: string
}): JSX.Element => {
  const summary = ExtraUsageModel.summarize(props.extra, resetsAt => UsageOverviewModel.formatResetIn(resetsAt, props.now).toLowerCase())
  const tone = summary.percentUsed === null ? 'ok' : quotaTone(100 - summary.percentUsed)
  const muted = props.muted === true || !props.extra.enabled
  return (
    <div className={cn('dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1', props.className)} data-testid="extra-usage">
      <div className="dshx:flex dshx:items-baseline dshx:justify-between dshx:gap-2 dshx:text-xs">
        <span
          className={cn('dshx:min-w-0 dshx:truncate', summary.capReached && !muted ? 'dshx:font-medium dshx:text-destructive' : 'dshx:text-muted-foreground')}
        >
          {summary.label}
        </span>
        {summary.amount === null ? null : (
          <strong className={cn('dshx:shrink-0 dshx:font-semibold dshx:tabular-nums', muted ? 'dshx:text-muted-foreground' : QUOTA_TONE_TEXT[tone])}>
            {summary.amount}
          </strong>
        )}
      </div>
      {summary.percentUsed === null || !props.extra.enabled ? null : (
        <Progress
          aria-label={`${summary.label} spent of monthly cap`}
          className={cn('dshx:h-1.5 dshx:bg-muted', muted ? 'dshx:*:data-[slot=progress-indicator]:bg-muted-foreground' : QUOTA_TONE_PROGRESS[tone])}
          value={summary.percentUsed}
        />
      )}
      <span className="dshx:text-[11px] dshx:text-muted-foreground">{summary.detail}</span>
    </div>
  )
}
