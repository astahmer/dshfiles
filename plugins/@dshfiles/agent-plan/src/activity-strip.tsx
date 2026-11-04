import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { BotIcon, LoaderCircleIcon, TerminalIcon, WrenchIcon } from '@dshfiles/plugin-ui/icons'
import type { ReactNode } from 'react'
import { LiveActivity, type LiveActivity as LiveActivityView } from './live-activity.js'
import { PlanProgress } from './plan-progress.js'
import { useNow } from './use-now.js'

const Row = (props: { readonly icon: ReactNode; readonly label: string; readonly detail?: string; readonly since: number; readonly now: number }): JSX.Element => (
  <li className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
    {props.icon}
    <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:font-mono">{props.label}</span>
    {props.detail !== undefined && <span className="dshx:shrink-0 dshx:text-muted-foreground">{props.detail}</span>}
    <span className="dshx:shrink-0 dshx:tabular-nums dshx:text-muted-foreground">{PlanProgress.formatDuration(props.now - props.since)}</span>
  </li>
)

const Section = (props: { readonly title: string; readonly children: ReactNode }): JSX.Element => (
  <section className="dshx:flex dshx:flex-col dshx:gap-1">
    <h3 className="dshx:text-xs dshx:font-medium dshx:text-muted-foreground">{props.title}</h3>
    <ul className="dshx:flex dshx:flex-col dshx:gap-1 dshx:text-xs">{props.children}</ul>
  </section>
)

const ICON = 'dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground'

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
          <LoaderCircleIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0 dshx:animate-spin" />
          <span className="dshx:min-w-0 dshx:truncate dshx:@max-pane-narrow:sr-only">{summary}</span>
          <span className="dshx:shrink-0 dshx:tabular-nums">{PlanProgress.formatDuration(now - oldest)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="dshx-root dshx:flex dshx:w-80 dshx:flex-col dshx:gap-3 dshx:p-3" side="top">
        {activity.tools.length > 0 && (
          <Section title="Tool calls">
            {activity.tools.map(tool => (
              <Row icon={<WrenchIcon aria-hidden className={ICON} />} key={tool.callId} label={tool.name} now={now} since={tool.startedAt} />
            ))}
          </Section>
        )}
        {activity.jobs.length > 0 && (
          <Section title="Background jobs">
            {activity.jobs.map(job => (
              <Row detail={job.kind} icon={<TerminalIcon aria-hidden className={ICON} />} key={job.jobId} label={job.label} now={now} since={job.startedAt} />
            ))}
          </Section>
        )}
        {activity.subagents.length > 0 && (
          <Section title="Subagents">
            {activity.subagents.map(job => (
              <Row icon={<BotIcon aria-hidden className={ICON} />} key={job.jobId} label={job.label} now={now} since={job.startedAt} />
            ))}
          </Section>
        )}
      </PopoverContent>
    </Popover>
  )
}
