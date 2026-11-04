import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { ListTodoIcon } from '@dshfiles/plugin-ui/icons'
import type { ReactNode } from 'react'
import type { LiveActivity } from './live-activity.js'
import { PlanProgress, type PlanWrite } from './plan-progress.js'
import { PlanSteps } from './plan-steps.js'
import { useNow } from './use-now.js'

/** The plan the pin shows: the newest write, only while it belongs to the latest turn and still has steps left. */
export const pinnedPlan = (writes: readonly PlanWrite[] | undefined, activity: LiveActivity | undefined) => {
  const latest = writes?.at(-1)
  if (latest === undefined || latest.todos.length === 0) return undefined
  if (activity?.turn !== undefined && latest.turn !== activity.turn) return undefined
  const all = writes ?? []
  const progress = PlanProgress.progress(latest.todos, PlanProgress.lineage(all, all.length - 1))
  return progress.done ? undefined : progress
}

/** A chip beside the native plan-mode control: "Step 2 of 5 · Write the tests · 1m 04s", opening the whole plan. */
export const PlanPin = (props: { readonly writes: readonly PlanWrite[] | undefined; readonly activity: LiveActivity | undefined; readonly timing: boolean; readonly running: boolean }): ReactNode => {
  const progress = pinnedPlan(props.writes, props.activity)
  const now = useNow(progress !== undefined && props.running && props.timing)
  if (progress === undefined) return null
  const step = progress.currentStep
  // Between turns nobody works the step, so the chip shows a clock only while the Session runs.
  const elapsed = step === undefined || !props.timing || !props.running ? undefined : PlanProgress.elapsed(step, now)
  const label = PlanProgress.label(progress)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label={`${label}${step === undefined ? '' : `: ${step.content}`}. Show the plan`}
          className="dshx-root dshx:flex dshx:h-7 dshx:max-w-64 dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:px-2 dshx:text-xs dshx:text-muted-foreground dshx:hover:bg-accent dshx:hover:text-accent-foreground"
          data-dshfiles-agent-plan-pin=""
          type="button"
        >
          <ListTodoIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0" />
          <span className="dshx:shrink-0 dshx:font-medium dshx:text-foreground">{label}</span>
          {step !== undefined && <span className="dshx:min-w-0 dshx:truncate dshx:@max-pane-compact:hidden">{step.content}</span>}
          {elapsed !== undefined && <span className="dshx:shrink-0 dshx:tabular-nums">{PlanProgress.formatDuration(elapsed)}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="dshx-root dshx:w-80 dshx:p-3" side="top">
        <div className="dshx:mb-2 dshx:text-xs dshx:font-medium dshx:text-muted-foreground">
          {label} · {progress.completed} done
        </div>
        <PlanSteps now={now} steps={progress.steps} timing={props.timing} />
      </PopoverContent>
    </Popover>
  )
}
