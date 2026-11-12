import { compactionApi } from '@dshfiles/context-compaction/compaction-api'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { useApi } from '@dshfiles/dshx/client'
import { FoldVerticalIcon } from '@dshfiles/plugin-ui/icons'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { Option, Schema } from 'effect'
import type { ReactNode } from 'react'
import { CompactionReading, ContextPressure } from './compaction-reading.js'

/**
 * How far the thread is from automatic compaction, as a row in the context meter's panel (under the occupancy breakdown).
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
  // A row of the context meter's panel (rich-composer's `conversation.composer.context` seat, b:ysaj): the meter line
  // keeps one context item, and this reading sits under the occupancy breakdown it continues.
  return (
    <div className="dshx-root dshx:flex dshx:flex-col dshx:gap-0.5 dshx:text-xs" data-dshfiles-compaction-reading={reading.due ? 'due' : 'pending'}>
      <span className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-foreground dshx:tabular-nums" data-dshfiles-compaction-meter="">
        <FoldVerticalIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground" />
        {label.charAt(0).toUpperCase() + label.slice(1)}
      </span>
      <span className="dshx:text-muted-foreground">{CompactionReading.detail(reading)}</span>
    </div>
  )
}
