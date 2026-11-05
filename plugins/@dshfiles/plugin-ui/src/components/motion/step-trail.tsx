import * as React from 'react'
import { animate, motionSafe, springs } from '../../motion/index.js'
import { useEnter } from '../../motion/react.js'
import { cn } from '../../lib/utils.js'
import { AutoHeight } from './auto-height.js'
import { StepGlyph } from './step-glyph.js'
import { ShimmerText } from './text.js'

export type TrailStepStatus = 'done' | 'active' | 'pending' | 'gated'

export interface TrailSubstep {
  readonly id: string
  readonly label: React.ReactNode
  readonly status: 'done' | 'active' | 'pending'
}

export interface TrailStep {
  readonly id: string
  readonly label: React.ReactNode
  readonly status: TrailStepStatus
  /** Right-hand meta for a finished step, e.g. its duration ("12s"). */
  readonly meta?: React.ReactNode
  /** Verb shown on the right while the step runs ("Writing"). */
  readonly activeLabel?: React.ReactNode
  /** Pill on a gated step ("Asks first"): the agent stops for approval there. */
  readonly gateLabel?: React.ReactNode
  /** Substeps, shown under the step while it is active. */
  readonly substeps?: readonly TrailSubstep[]
  /** The row's accessible name ("Step 2: Fix the bug, in progress"); defaults to its text. */
  readonly accessibleLabel?: string
}

export interface StepTrailProps extends Omit<React.HTMLAttributes<HTMLOListElement>, 'children'> {
  readonly steps: readonly TrailStep[]
  readonly onStepClick?: (step: TrailStep) => void
  /** `sm` fits a card or popover: smaller glyphs, 24 px rows, body-size text. */
  readonly size?: 'sm' | 'default'
}

/**
 * An agent's plan as a vertical trail: finished steps get a check that pops in and the connector fills down to the
 * next one, the current step pulses and unfolds its substeps, and a gated step shows the approval it will ask for.
 */
export function StepTrail({ steps, onStepClick, size = 'default', className, ...props }: StepTrailProps) {
  return (
    <ol aria-label="Plan" className={cn('dshx:@container dshx:flex dshx:flex-col', className)} {...props}>
      {steps.map((step, index) => (
        <TrailRow key={step.id} step={step} last={index === steps.length - 1} onStepClick={onStepClick} size={size} />
      ))}
    </ol>
  )
}

function TrailRow({
  step,
  last,
  onStepClick,
  size,
}: {
  readonly step: TrailStep
  readonly last: boolean
  readonly onStepClick: ((step: TrailStep) => void) | undefined
  readonly size: 'sm' | 'default'
}) {
  const small = size === 'sm'
  const fillRef = React.useRef<HTMLSpanElement>(null)
  const filled = step.status === 'done'
  const firstFill = React.useRef(true)
  React.useLayoutEffect(() => {
    const fill = fillRef.current
    if (fill == null) return
    if (firstFill.current) {
      firstFill.current = false
      fill.style.transform = filled ? 'scaleY(1)' : 'scaleY(0)'
      return
    }
    const controls = animate(fill, { transform: filled ? 'scaleY(1)' : 'scaleY(0)' }, motionSafe({ ...springs.gentle, delay: filled ? 0.12 : 0 }))
    return () => controls.complete()
  }, [filled])

  const substeps = step.status === 'active' ? (step.substeps ?? []) : []
  const label = (
    <span
      className={cn(
        // Narrow panes wrap to two lines instead of cutting the step name next to a pill.
        'dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:motion-safe:transition-colors dshx:@max-pane-narrow:line-clamp-2 dshx:@max-pane-narrow:text-sm dshx:@max-pane-narrow:leading-5 dshx:@max-pane-narrow:whitespace-normal',
        small ? 'dshx:text-sm' : 'dshx:text-[15px]',
        step.status === 'done' && 'dshx:text-muted-foreground',
        step.status === 'active' && 'dshx:text-foreground',
        step.status === 'pending' && 'dshx:text-muted-foreground/70',
        step.status === 'gated' && 'dshx:text-foreground',
      )}
    >
      {step.label}
    </span>
  )

  return (
    <li
      className={cn('dshx:relative dshx:flex', small ? 'dshx:gap-2.5' : 'dshx:gap-3.5')}
      aria-current={step.status === 'active' ? 'step' : undefined}
      aria-label={step.accessibleLabel}
    >
      <div className={cn('dshx:relative dshx:flex dshx:shrink-0 dshx:flex-col dshx:items-center', small ? 'dshx:w-3.5' : 'dshx:w-5')}>
        <span className={cn('dshx:flex dshx:items-center', small ? 'dshx:h-6' : 'dshx:h-8')}>
          <StepGlyph
            aria-hidden={step.accessibleLabel !== undefined || undefined}
            size={small ? 'sm' : 'default'}
            status={step.status === 'gated' ? 'locked' : step.status}
          />
        </span>
        {!last ? (
          <span aria-hidden className="dshx:relative dshx:-my-1.5 dshx:w-[1.5px] dshx:flex-1 dshx:overflow-hidden dshx:rounded-full dshx:bg-border">
            <span ref={fillRef} className="dshx:absolute dshx:inset-0 dshx:origin-top dshx:bg-primary" />
          </span>
        ) : null}
      </div>
      <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:pb-1">
        <div
          className={cn(
            'dshx:flex dshx:items-center dshx:gap-3 dshx:@max-pane-narrow:gap-2',
            small ? 'dshx:min-h-6' : 'dshx:min-h-8 dshx:@max-pane-narrow:py-1.5',
          )}
        >
          {onStepClick !== undefined ? (
            <button
              type="button"
              onClick={() => onStepClick(step)}
              className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:rounded-sm dshx:text-left dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50"
            >
              {label}
            </button>
          ) : (
            label
          )}
          <StepMeta step={step} small={small} />
        </div>
        <AutoHeight>{substeps.length > 0 ? <Substeps substeps={substeps} /> : null}</AutoHeight>
      </div>
    </li>
  )
}

function StepMeta({ step, small }: { readonly step: TrailStep; readonly small: boolean }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  useEnter(ref, 'blurIn', { duration: 0.3 }, step.status)
  let content: React.ReactNode = null
  if (step.status === 'done' && step.meta !== undefined)
    content = <span className={cn('dshx:text-muted-foreground dshx:tabular-nums', small ? 'dshx:text-xs' : 'dshx:text-sm')}>{step.meta}</span>
  else if (step.status === 'active' && step.activeLabel !== undefined)
    content = <span className={cn('dshx:font-medium dshx:text-info dshx:tabular-nums', small ? 'dshx:text-xs' : 'dshx:text-sm')}>{step.activeLabel}</span>
  else if (step.status === 'gated' && step.gateLabel !== undefined)
    content = (
      <span className="dshx:rounded-full dshx:bg-warning/15 dshx:px-2.5 dshx:py-0.5 dshx:text-[13px] dshx:font-medium dshx:whitespace-nowrap dshx:text-warning dshx:@max-pane-narrow:px-2 dshx:@max-pane-narrow:text-xs">
        {step.gateLabel}
      </span>
    )
  return (
    <span ref={ref} className="dshx:shrink-0">
      {content}
    </span>
  )
}

function Substeps({ substeps }: { readonly substeps: readonly TrailSubstep[] }) {
  const mounted = React.useRef(false)
  React.useEffect(() => {
    mounted.current = true
  }, [])
  return (
    <ul aria-label="Substeps" className="dshx:relative dshx:mt-0.5 dshx:mb-1.5 dshx:ml-0.5 dshx:flex dshx:flex-col dshx:border-l dshx:border-border">
      {substeps.map((substep, index) => (
        <SubstepRow key={substep.id} substep={substep} delay={mounted.current ? 0 : 0.08 + index * 0.06} />
      ))}
    </ul>
  )
}

function SubstepRow({ substep, delay }: { readonly substep: TrailSubstep; readonly delay: number }) {
  const ref = React.useRef<HTMLLIElement>(null)
  const delayRef = React.useRef(delay)
  useEnter(ref, 'slideInLeft', { delay: delayRef.current })
  return (
    <li ref={ref} className="dshx:relative dshx:flex dshx:h-7 dshx:items-center dshx:gap-3 dshx:pl-3.5">
      <span
        aria-hidden
        className={cn(
          'dshx:absolute dshx:-left-[3.5px] dshx:size-1.5 dshx:rounded-full dshx:motion-safe:transition-colors',
          substep.status === 'active' ? 'dshx:bg-primary' : substep.status === 'done' ? 'dshx:bg-muted-foreground/50' : 'dshx:bg-border',
        )}
      />
      {substep.status === 'active' ? (
        <ShimmerText className="dshx:min-w-0 dshx:truncate dshx:text-sm">{substep.label}</ShimmerText>
      ) : (
        <span
          className={cn('dshx:min-w-0 dshx:truncate dshx:text-sm', substep.status === 'done' ? 'dshx:text-muted-foreground' : 'dshx:text-muted-foreground/60')}
        >
          {substep.label}
        </span>
      )}
    </li>
  )
}
