import { StepTrail, type TrailStepStatus } from '@dshfiles/plugin-ui/components/motion/step-trail'
import { PlanProgress, type PlanStep } from './plan-progress.js'

const TRAIL_STATUS = { completed: 'done', in_progress: 'active', pending: 'pending' } as const satisfies Record<PlanStep['status'], TrailStepStatus>

const STATUS_LABEL = { completed: 'done', in_progress: 'in progress', pending: 'pending' } as const

/** The steps of a plan as a kit step trail and, when timing is on, how long each took or has run so far. */
export const PlanSteps = (props: { readonly steps: readonly PlanStep[]; readonly now: number; readonly timing: boolean }): JSX.Element => (
  <StepTrail
    aria-label="Plan steps"
    data-dshfiles-agent-plan-steps=""
    size="sm"
    steps={props.steps.map((step, index) => {
      const duration = props.timing ? PlanProgress.shownDuration(PlanProgress.elapsed(step, props.now)) : undefined
      return {
        id: step.content,
        label: step.content,
        status: TRAIL_STATUS[step.status],
        accessibleLabel: `Step ${index + 1}: ${step.content}, ${STATUS_LABEL[step.status]}`,
        // The running step's time is a plain reading like the finished ones: colour is for a failure, not for "working".
        ...(duration !== undefined && { meta: duration, activeLabel: <span className="dshx:font-normal dshx:text-muted-foreground">{duration}</span> }),
      }
    })}
  />
)
