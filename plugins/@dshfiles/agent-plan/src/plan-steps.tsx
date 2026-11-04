import { StepGlyph, type StepGlyphStatus } from '@dshfiles/plugin-ui/components/motion/step-glyph'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { PlanProgress, type PlanStep } from './plan-progress.js'

const GLYPH_STATUS = { completed: 'done', in_progress: 'running', pending: 'pending' } as const satisfies Record<PlanStep['status'], StepGlyphStatus>

const STATUS_LABEL = { completed: 'done', in_progress: 'in progress', pending: 'pending' } as const

/** The steps of a plan with done / active / pending glyphs and, when timing is on, how long each took. */
export const PlanSteps = (props: { readonly steps: readonly PlanStep[]; readonly now: number; readonly timing: boolean }): JSX.Element => (
  <ol aria-label="Plan steps" className="dshx:flex dshx:flex-col dshx:gap-1 dshx:text-sm" data-dshfiles-agent-plan-steps="">
    {props.steps.map((step, index) => {
      const elapsed = props.timing ? PlanProgress.elapsed(step, props.now) : undefined
      return (
        <li
          aria-label={`Step ${index + 1}: ${step.content}, ${STATUS_LABEL[step.status]}`}
          className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2"
          data-status={step.status}
          key={step.content}
        >
          <StepGlyph aria-hidden size="sm" status={GLYPH_STATUS[step.status]} tone="success" />
          <span
            className={cn(
              'dshx:min-w-0 dshx:flex-1 dshx:truncate',
              step.status === 'completed' && 'dshx:text-muted-foreground dshx:line-through',
              step.status === 'in_progress' && 'dshx:font-medium',
            )}
          >
            {step.content}
          </span>
          {elapsed !== undefined && (
            <span className="dshx:shrink-0 dshx:text-xs dshx:tabular-nums dshx:text-muted-foreground">{PlanProgress.formatDuration(elapsed)}</span>
          )}
        </li>
      )
    })}
  </ol>
)
