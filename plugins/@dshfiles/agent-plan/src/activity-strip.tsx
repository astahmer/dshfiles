import { AgentRunSteps, type AgentRunStep } from '@dshfiles/plugin-ui/components/motion/agent-run-steps'
import { StepGlyph } from '@dshfiles/plugin-ui/components/motion/step-glyph'
import { ShimmerText } from '@dshfiles/plugin-ui/components/motion/text'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { formatElapsed } from '@dshfiles/plugin-ui/lib/format-duration'
import type { ReactNode } from 'react'
import { LiveActivity, type LiveActivity as LiveActivityView } from './live-activity.js'
import { useNow } from './use-now.js'

/** The open tool calls, each ticking from its own start. */
const runSteps = (activity: LiveActivityView): AgentRunStep[] =>
  activity.tools.map((tool): AgentRunStep => ({ id: tool.callId, kind: 'tool', label: tool.name, status: 'running', startedAt: tool.startedAt }))

/**
 * What the turn runs now, beside the native composer activity: the oldest open tool call with a live timer, opening
 * the full list. It says only what the dock does not (unslop r3 item 26): background jobs and subagents have their own
 * rows above the composer, so with only those running the strip renders nothing.
 */
export const ActivityStrip = (props: { readonly activity: LiveActivityView | undefined }): ReactNode => {
  const activity = props.activity
  const busy = activity !== undefined && activity.tools.length > 0
  const now = useNow(busy)
  if (!busy) return null
  const oldest = activity.tools.reduce((min, row) => Math.min(min, row.startedAt), now)
  const summary = LiveActivity.summary(activity)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label={`Running now: ${summary}. Show details`}
          className="dshx-root dshx:flex dshx:h-7 dshx:max-w-56 dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:px-2 dshx:text-xs dshx:text-muted-foreground dshx:hover:bg-accent dshx:hover:text-accent-foreground"
          data-dshfiles-agent-activity=""
          type="button"
        >
          <StepGlyph aria-hidden size="sm" status="running" />
          <ShimmerText active className="dshx:min-w-0 dshx:truncate dshx:@max-pane-narrow:sr-only">
            {summary}
          </ShimmerText>
          <span className="dshx:shrink-0 dshx:tabular-nums">{formatElapsed(now - oldest)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="dshx-root dshx:w-80 dshx:p-0 dshx:pt-3 dshx:pb-1" side="top">
        <AgentRunSteps heading="Running now" status="working" startedAt={oldest} steps={runSteps(activity)} />
      </PopoverContent>
    </Popover>
  )
}
