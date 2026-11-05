import { AgentRunSteps, type AgentRunStep } from '@dshfiles/plugin-ui/components/motion/agent-run-steps'
import { StepGlyph } from '@dshfiles/plugin-ui/components/motion/step-glyph'
import { ShimmerText } from '@dshfiles/plugin-ui/components/motion/text'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import type { ReactNode } from 'react'
import { LiveActivity, type LiveActivity as LiveActivityView } from './live-activity.js'
import { PlanProgress } from './plan-progress.js'
import { useNow } from './use-now.js'

/** Tool calls, then background jobs, then subagents, each ticking from its own start. */
const runSteps = (activity: LiveActivityView): AgentRunStep[] => [
  ...activity.tools.map((tool): AgentRunStep => ({ id: tool.callId, kind: 'tool', label: tool.name, status: 'running', startedAt: tool.startedAt })),
  ...activity.jobs.map((job): AgentRunStep => ({
    id: job.jobId,
    kind: 'run',
    label: job.kind,
    target: job.label,
    status: 'running',
    startedAt: job.startedAt,
  })),
  ...activity.subagents.map((job): AgentRunStep => ({
    id: job.jobId,
    kind: 'agent',
    label: 'Subagent',
    target: job.label,
    status: 'running',
    startedAt: job.startedAt,
  })),
]

/**
 * What runs now, beside the native composer activity: the oldest running tool call with a live timer and counts of
 * background jobs and subagents, opening the full list. Renders nothing while the Session is idle.
 */
export const ActivityStrip = (props: { readonly activity: LiveActivityView | undefined }): ReactNode => {
  const activity = props.activity
  const busy = activity !== undefined && !LiveActivity.isIdle(activity)
  const now = useNow(busy)
  if (!busy) return null
  const oldest = [...activity.tools, ...activity.jobs, ...activity.subagents].reduce((min, row) => Math.min(min, row.startedAt), now)
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
          <span className="dshx:shrink-0 dshx:tabular-nums">{PlanProgress.formatDuration(now - oldest)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="dshx-root dshx:w-80 dshx:p-0 dshx:pt-3 dshx:pb-1" side="top">
        <AgentRunSteps heading="Running now" status="working" startedAt={oldest} steps={runSteps(activity)} />
      </PopoverContent>
    </Popover>
  )
}
