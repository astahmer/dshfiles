import * as React from 'react'
import { animate, motionSafe, presets, springs, durations } from '../../motion/index.js'
import { usePrefersReducedMotion } from '../../motion/react.js'
import { cn } from '../../lib/utils.js'
import {
  CheckIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleHelpIcon,
  EllipsisIcon,
  LoaderCircleIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  ShieldAlertIcon,
  XIcon,
} from '../../icons.js'
import { Button } from '../ui/button.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.js'
import { RollingNumber } from './text.js'
import { ElapsedClock, formatClock } from './elapsed-clock.js'

export type ApprovalStepStatus = 'done' | 'running' | 'waiting' | 'pending'
/** `answer` asks the user a question; `approval` needs an explicit approve / revise / deny. */
export type ApprovalGate = 'answer' | 'approval'
export type ApprovalDecision = 'approve' | 'revise' | 'deny'
export type ApprovalTone = 'warning' | 'success' | 'destructive' | 'info' | 'violet'

export interface ApprovalRunStep {
  readonly id: string
  readonly label: string
  /** Monospace target: a file, an event, a service. */
  readonly detail?: string
  /** Secondary line under the label. */
  readonly note?: string
  /** Tool chip before the label (`fly`, `gh`, `jj`). */
  readonly tool?: string
  readonly badge?: { readonly label: string; readonly tone: ApprovalTone }
  readonly status: ApprovalStepStatus
  readonly gate?: ApprovalGate
  /** Shown right-aligned for done steps. */
  readonly durationSeconds?: number
  /** 0..1 for the running step's bar. */
  readonly progress?: number
  /** Text shown in the expanded gate while waiting. */
  readonly question?: string
}

export type ApprovalRunState = 'working' | 'waiting' | 'paused' | 'done'

export interface ApprovalRunProps extends Omit<React.HTMLAttributes<HTMLElement>, 'children' | 'title'> {
  readonly heading: string
  readonly state: ApprovalRunState
  readonly steps: readonly ApprovalRunStep[]
  /** Steps after the visible ones ("1 more after these"). */
  readonly moreCount?: number
  readonly totalSteps: number
  readonly startedAt: number
  readonly endedAt?: number
  readonly onPauseToggle?: () => void
  readonly onDecision?: (stepId: string, decision: ApprovalDecision) => void
  readonly onMenu?: () => void
}

const stateBadge = {
  working: { label: 'Working', className: 'dshx:border-violet/40 dshx:bg-violet/15 dshx:text-violet' },
  waiting: { label: 'Needs you', className: 'dshx:border-warning/40 dshx:bg-warning/15 dshx:text-warning' },
  paused: { label: 'Paused', className: 'dshx:border-border dshx:bg-muted dshx:text-muted-foreground' },
  done: { label: 'Done', className: 'dshx:border-success/40 dshx:bg-success/15 dshx:text-success' },
} as const satisfies Record<ApprovalRunState, { readonly label: string; readonly className: string }>

const toneClass = {
  warning: 'dshx:border-warning/40 dshx:bg-warning/15 dshx:text-warning',
  success: 'dshx:border-success/40 dshx:bg-success/15 dshx:text-success',
  destructive: 'dshx:border-destructive/40 dshx:bg-destructive/15 dshx:text-destructive',
  info: 'dshx:border-info/40 dshx:bg-info/15 dshx:text-info',
  violet: 'dshx:border-violet/40 dshx:bg-violet/15 dshx:text-violet',
} as const satisfies Record<ApprovalTone, string>

/**
 * An agent run console that stops for the user: done steps tick off, the running step carries a live bar, and a
 * gated step (question or high-impact approval) expands in place with Approve / Revise / Deny. A highlight band
 * glides to whichever step is active, status icons pop as they change, and the percentage rolls.
 */
export function ApprovalRun({
  heading,
  state,
  steps,
  moreCount = 0,
  totalSteps,
  startedAt,
  endedAt,
  onPauseToggle,
  onDecision,
  onMenu,
  className,
  ...props
}: ApprovalRunProps) {
  const listRef = React.useRef<HTMLOListElement>(null)
  const bandRef = React.useRef<HTMLDivElement>(null)
  const activeIndex = steps.findIndex(step => step.status === 'running' || step.status === 'waiting')
  const active = activeIndex === -1 ? undefined : steps[activeIndex]
  const doneCount = steps.filter(step => step.status === 'done').length
  const stepNumber = Math.min(totalSteps, activeIndex === -1 ? doneCount : doneCount + 1)
  const badge = stateBadge[state]

  // The highlight band follows the active row: measure it after layout and glide there.
  React.useLayoutEffect(() => {
    const list = listRef.current
    const band = bandRef.current
    if (list == null || band == null) return
    const row = active === undefined ? null : list.querySelector<HTMLElement>(`[data-step-id="${CSS.escape(active.id)}"]`)
    if (row == null) {
      const c = animate(band, { opacity: 0 }, motionSafe({ duration: durations.fast }))
      return () => c.stop()
    }
    const first = band.style.opacity === '' || band.style.opacity === '0'
    const target = { top: `${row.offsetTop}px`, height: `${row.offsetHeight}px` }
    if (first) {
      band.style.top = target.top
      band.style.height = target.height
    }
    const c = animate(band, { ...target, opacity: 1 }, motionSafe(springs.smooth))
    return () => c.stop()
  })

  return (
    <section
      aria-label={`${heading}: ${badge.label}`}
      className={cn(
        'dshx:@container dshx:overflow-hidden dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card dshx:text-card-foreground dshx:shadow-sm',
        className,
      )}
      {...props}
    >
      <header className="dshx:flex dshx:items-center dshx:gap-2 dshx:px-4 dshx:py-3">
        <h3 className="dshx:min-w-0 dshx:truncate dshx:text-sm dshx:font-semibold">{heading}</h3>
        <PopKey
          popKey={state}
          className={cn('dshx:shrink-0 dshx:rounded-md dshx:border dshx:px-1.5 dshx:py-px dshx:text-xs dshx:font-medium', badge.className)}
        >
          {badge.label}
        </PopKey>
        {onMenu ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" className="dshx:ml-auto" aria-label="Run actions" onClick={onMenu}>
                <EllipsisIcon aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Run actions</TooltipContent>
          </Tooltip>
        ) : null}
      </header>

      <div className="dshx:relative dshx:mx-1 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-background/40">
        <div
          ref={bandRef}
          aria-hidden
          className="dshx:pointer-events-none dshx:absolute dshx:inset-x-0 dshx:border-y dshx:border-border dshx:bg-muted/70 dshx:opacity-0"
        />
        <ol ref={listRef} aria-label="Steps" className="dshx:relative dshx:flex dshx:flex-col dshx:py-1.5">
          {steps.map(step => (
            <StepRow key={step.id} step={step} paused={state === 'paused'} onDecision={onDecision} />
          ))}
          {moreCount > 0 ? (
            <li className="dshx:px-4 dshx:py-2 dshx:pl-11 dshx:text-xs dshx:text-muted-foreground">
              <RollingNumber value={moreCount} /> more after these
            </li>
          ) : null}
        </ol>
      </div>

      <footer className="dshx:flex dshx:items-center dshx:gap-2 dshx:px-4 dshx:py-3 dshx:text-xs dshx:text-muted-foreground">
        <span className="dshx:inline-flex dshx:items-center dshx:gap-1">
          Step <RollingNumber value={stepNumber} /> of {totalSteps}
        </span>
        <span aria-hidden className="dshx:size-1 dshx:rounded-full dshx:bg-muted-foreground/50" />
        <ElapsedClock startedAt={startedAt} endedAt={endedAt} running={state === 'working' || state === 'waiting'} format={formatClock} aria-label="Elapsed" />
        {state !== 'done' ? (
          <Button
            variant="outline"
            size="sm"
            className="dshx:ml-auto"
            onClick={onPauseToggle}
            disabled={onPauseToggle === undefined}
            aria-pressed={state === 'paused'}
          >
            {state === 'paused' ? <PlayIcon aria-hidden /> : <PauseIcon aria-hidden />}
            {state === 'paused' ? 'Resume' : 'Pause'}
          </Button>
        ) : null}
      </footer>
    </section>
  )
}

function StepRow({
  step,
  paused,
  onDecision,
}: {
  readonly step: ApprovalRunStep
  readonly paused: boolean
  readonly onDecision: ((stepId: string, decision: ApprovalDecision) => void) | undefined
}) {
  const muted = step.status === 'pending'
  const percent = Math.round((step.progress ?? 0) * 100)
  return (
    <li
      data-step-id={step.id}
      aria-current={step.status === 'running' || step.status === 'waiting' ? 'step' : undefined}
      className="dshx:flex dshx:flex-col dshx:px-4 dshx:py-2.5"
    >
      <div className="dshx:flex dshx:items-start dshx:gap-3">
        <StepIcon status={step.status} gate={step.gate} paused={paused} />
        <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-0.5">
          <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-x-2 dshx:gap-y-1 dshx:text-sm">
            {step.tool ? (
              <span className="dshx:rounded-md dshx:border dshx:border-border dshx:bg-muted dshx:px-1.5 dshx:font-mono dshx:text-xs">{step.tool}</span>
            ) : null}
            <span className={cn('dshx:min-w-0', muted ? 'dshx:text-muted-foreground' : 'dshx:text-foreground')}>{step.label}</span>
            {step.badge && step.status !== 'pending' && step.gate === undefined ? (
              <span className={cn('dshx:rounded-md dshx:border dshx:px-1.5 dshx:text-xs', toneClass[step.badge.tone])}>{step.badge.label}</span>
            ) : null}
            {step.detail ? (
              <span className="dshx:min-w-0 dshx:max-w-full dshx:truncate dshx:font-mono dshx:text-xs dshx:text-muted-foreground">{step.detail}</span>
            ) : null}
          </div>
          {step.note ? <p className="dshx:text-xs dshx:text-muted-foreground">{step.note}</p> : null}
        </div>
        <div className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-2 dshx:pt-px dshx:text-xs dshx:text-muted-foreground">
          {step.gate !== undefined && step.badge && step.status !== 'done' ? (
            <span className={cn('dshx:rounded-md dshx:border dshx:px-1.5 dshx:@max-pane-narrow:hidden', toneClass[step.badge.tone])}>{step.badge.label}</span>
          ) : null}
          {step.status === 'running' ? (
            <span className="dshx:inline-flex dshx:text-sm dshx:font-medium dshx:text-foreground">
              <RollingNumber value={percent} />%
            </span>
          ) : null}
          {step.status === 'done' && step.durationSeconds !== undefined ? <span className="dshx:font-mono">{formatClock(step.durationSeconds)}</span> : null}
        </div>
      </div>
      {step.status === 'running' ? <ProgressLine value={step.progress ?? 0} /> : null}
      {step.status === 'waiting' && step.gate !== undefined ? <GatePanel step={step} onDecision={onDecision} /> : null}
    </li>
  )
}

function ProgressLine({ value }: { readonly value: number }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  React.useLayoutEffect(() => {
    if (ref.current == null) return
    const c = animate(ref.current, { transform: `scaleX(${Math.max(0, Math.min(1, value))})` }, motionSafe(springs.smooth))
    return () => c.stop()
  }, [value])
  return (
    <span className="dshx:mt-2 dshx:ml-8 dshx:block dshx:h-1 dshx:overflow-hidden dshx:rounded-full dshx:bg-muted" aria-hidden>
      <span ref={ref} style={{ transform: 'scaleX(0)' }} className="dshx:block dshx:h-full dshx:origin-left dshx:rounded-full dshx:bg-foreground" />
    </span>
  )
}

/** The expanded question/approval: grows from zero height, then its buttons rise in one after another. */
function GatePanel({
  step,
  onDecision,
}: {
  readonly step: ApprovalRunStep
  readonly onDecision: ((stepId: string, decision: ApprovalDecision) => void) | undefined
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    const element = ref.current
    if (element == null) return
    const height = element.scrollHeight
    element.style.overflow = 'hidden'
    const grow = animate(element, { height: [0, height], opacity: [0, 1] }, motionSafe(springs.smooth))
    void grow.finished.then(() => {
      element.style.height = ''
      element.style.overflow = ''
    })
    const buttons = Array.from(element.querySelectorAll('[data-gate-button]'))
    const rise = animate(buttons, presets.riseIn, motionSafe({ ...springs.snappy, delay: (i: number) => 0.08 + i * 0.05 }))
    return () => {
      grow.complete()
      rise.complete()
    }
  }, [])
  const approval = step.gate === 'approval'
  return (
    <div ref={ref} className="dshx:ml-8">
      <div className="dshx:mt-2 dshx:flex dshx:flex-col dshx:gap-2.5 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card dshx:p-3">
        {step.question ? <p className="dshx:text-sm dshx:text-foreground">{step.question}</p> : null}
        <div className="dshx:flex dshx:flex-wrap dshx:gap-2" role="group" aria-label={approval ? 'Decision' : 'Answer'}>
          <Button data-gate-button size="sm" onClick={() => onDecision?.(step.id, 'approve')}>
            <CheckIcon aria-hidden />
            {approval ? 'Approve' : 'Yes, continue'}
          </Button>
          <Button data-gate-button size="sm" variant="outline" onClick={() => onDecision?.(step.id, 'revise')}>
            <PencilIcon aria-hidden />
            Revise
          </Button>
          <Button
            data-gate-button
            size="sm"
            variant="ghost"
            className="dshx:text-destructive dshx:hover:text-destructive"
            onClick={() => onDecision?.(step.id, 'deny')}
          >
            <XIcon aria-hidden />
            Deny
          </Button>
        </div>
      </div>
    </div>
  )
}

function StepIcon({ status, gate, paused }: { readonly status: ApprovalStepStatus; readonly gate: ApprovalGate | undefined; readonly paused: boolean }) {
  const kind = status === 'done' ? 'done' : status === 'running' ? 'running' : gate === 'approval' ? 'approval' : gate === 'answer' ? 'answer' : 'pending'
  return (
    <PopKey popKey={kind} className="dshx:mt-px dshx:inline-flex dshx:size-5 dshx:shrink-0 dshx:items-center dshx:justify-center" aria-hidden>
      {kind === 'done' ? <CircleCheckIcon className="dshx:size-4 dshx:text-muted-foreground" /> : null}
      {kind === 'running' ? <Spin paused={paused} /> : null}
      {kind === 'answer' ? <CircleHelpIcon className={cn('dshx:size-4', status === 'waiting' ? 'dshx:text-success' : 'dshx:text-muted-foreground')} /> : null}
      {kind === 'approval' ? (
        <ShieldAlertIcon className={cn('dshx:size-4', status === 'waiting' ? 'dshx:text-destructive' : 'dshx:text-destructive/70')} />
      ) : null}
      {kind === 'pending' ? <CircleDashedIcon className="dshx:size-4 dshx:text-muted-foreground" /> : null}
    </PopKey>
  )
}

function Spin({ paused }: { readonly paused: boolean }) {
  const ref = React.useRef<SVGSVGElement>(null)
  const reduced = usePrefersReducedMotion()
  React.useEffect(() => {
    if (paused || reduced || ref.current == null) return
    const c = animate(ref.current, { rotate: [0, 360] }, { duration: 0.9, ease: 'linear', repeat: Infinity })
    return () => c.stop()
  }, [paused, reduced])
  return <LoaderCircleIcon ref={ref} className="dshx:size-4 dshx:text-foreground" />
}

/** Re-plays a small pop whenever `popKey` changes (status icons, the state badge). */
function PopKey({
  popKey,
  className,
  children,
  ...props
}: { readonly popKey: string; readonly className?: string; readonly children: React.ReactNode } & Omit<
  React.HTMLAttributes<HTMLSpanElement>,
  'children' | 'className'
>) {
  const ref = React.useRef<HTMLSpanElement>(null)
  const first = React.useRef(true)
  React.useLayoutEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (ref.current == null) return
    const c = animate(ref.current, { transform: ['scale(0.6)', 'scale(1)'], opacity: [0, 1] }, motionSafe(springs.bouncy))
    return () => c.complete()
  }, [popKey])
  return (
    <span ref={ref} className={className} {...props}>
      {children}
    </span>
  )
}
