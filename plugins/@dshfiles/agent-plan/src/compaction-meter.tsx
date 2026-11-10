import { compactionApi } from '@dshfiles/context-compaction/compaction-api'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { useApi } from '@dshfiles/dshx/client'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { FoldVerticalIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { Option, Schema } from 'effect'
import type { ReactNode } from 'react'
import { CompactionReading, ContextPressure } from './compaction-reading.js'

/**
 * How far the thread is from automatic compaction, beside the native context ring in the composer's meter line.
 * The trigger comes from the running compaction engine (context-compaction), refetched when the route's window
 * changes; the live prompt size is the same `contextPressure` projection the ring reads.
 */
export const CompactionMeter = (props: { readonly sessionId: string; readonly useProjection: (key: string) => unknown }): ReactNode => {
  const api = useApi(compactionApi)
  const pressure = Option.getOrUndefined(Schema.decodeUnknownOption(ContextPressure)(props.useProjection('contextPressure')))
  const window = pressure?.contextWindow
  const threshold = useQuery({
    queryKey: ['agent-plan', 'compaction-threshold', props.sessionId, window],
    queryFn: ({ signal }) => api.threshold({ sessionId: props.sessionId }, { signal }),
    enabled: window !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
    retry: (count, error) => !isApiOwnerMissing(error) && count < 2,
  })
  const value = threshold.data
  if (value === undefined || value === null) return null
  const reading = CompactionReading.of({
    usedTokens: CompactionReading.usedTokens(pressure),
    thresholdTokens: value.thresholdTokens,
    contextWindow: value.contextWindow,
    auto: value.auto,
  })
  if (reading === null) return null
  const label = CompactionReading.label(reading)
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            aria-label={`${label}. ${CompactionReading.detail(reading)}`}
            className={cn(
              'dshx-root dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:rounded-full dshx:px-2 dshx:py-px dshx:text-xs dshx:whitespace-nowrap dshx:tabular-nums',
              reading.due ? 'dshx:text-warning' : 'dshx:text-muted-foreground',
            )}
            data-dshfiles-compaction-meter=""
            tabIndex={0}
          >
            <FoldVerticalIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0" />
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{CompactionReading.detail(reading)}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
