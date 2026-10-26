import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { ToolMetaTranslate } from './locales.js'
import { ToolTimingModel, type WaitTimer } from './timing.js'

export interface WaitTimerIndicatorProps {
  readonly timer: WaitTimer
  readonly t: ToolMetaTranslate
}

export const WaitTimerIndicator = ({ timer, t }: WaitTimerIndicatorProps) => {
  const elapsed = ToolTimingModel.formatDuration({ ms: timer.elapsedMs, live: true, t })
  const remaining = timer.remainingMs === undefined ? undefined : ToolTimingModel.formatDuration({ ms: timer.remainingMs, live: true, t })
  const timeout = timer.timeoutMs === undefined ? undefined : ToolTimingModel.formatDuration({ ms: timer.timeoutMs, live: true, t })
  const label = remaining === undefined || timeout === undefined ? t('waitElapsed', { duration: elapsed }) : t('waitProgress', { remaining, timeout })
  const progress = timer.timeoutMs === undefined ? undefined : Math.min(timer.elapsedMs, timer.timeoutMs)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="dshx-root dshx:inline-flex dshx:items-center dshx:gap-2 dshx:pl-2 dshx:text-xs dshx:tabular-nums dshx:text-muted-foreground"
          data-dshfiles-wait-timer
        >
          <span>{remaining === undefined ? t('waitElapsed', { duration: elapsed }) : t('waitRemaining', { duration: remaining })}</span>
          <span
            role="progressbar"
            aria-label={label}
            {...(timer.timeoutMs === undefined
              ? {}
              : {
                  'aria-valuemin': 0,
                  'aria-valuemax': timer.timeoutMs,
                  'aria-valuenow': progress,
                })}
            className="dshx:block dshx:h-1 dshx:w-20 dshx:overflow-hidden dshx:rounded-full dshx:bg-muted"
          >
            <span
              className={cn(
                'dshx:block dshx:h-full dshx:rounded-full dshx:bg-primary',
                timer.timeoutMs === undefined && 'dshx:w-1/3 dshx:motion-safe:animate-pulse',
              )}
              {...(timer.timeoutMs === undefined
                ? {}
                : {
                    style: { width: `${Math.round(((progress ?? 0) / timer.timeoutMs) * 100)}%` },
                  })}
            />
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
