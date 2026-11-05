import * as React from 'react'
import { animate, everyFrame, motionSafe, springs, durations, easings } from '../../motion/index.js'
import { useEnter, usePrefersReducedMotion } from '../../motion/react.js'
import { cn } from '../../lib/utils.js'
import { CheckIcon, MinusIcon, XIcon, PackageIcon } from '../../icons.js'
import { Button } from '../ui/button.js'
import { PresenceList } from './presence-list.js'
import { ShimmerText } from './text.js'
import { SlidingSegments, type SlidingSegmentOption } from './sliding-segments.js'

export type PipelineStepState = 'pending' | 'running' | 'done' | 'failed'

export interface PipelineStep {
  readonly id: string
  readonly label: string
  readonly state: PipelineStepState
  /** Final duration in seconds, shown under the label once the step settles. */
  readonly durationSeconds?: number
}

export interface PipelineLogLine {
  readonly id: string
  readonly text: string
  readonly icon?: React.ReactNode
  readonly state: 'running' | 'done' | 'failed'
}

export interface PipelineSummaryRow {
  readonly id: string
  readonly label: string
  readonly value: React.ReactNode
  readonly icon?: React.ReactNode
}

/** `cancelled` settled without passing or failing. */
export type PipelineRunStatus = 'idle' | 'running' | 'done' | 'failed' | 'cancelled'

export interface PipelineRunProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  readonly heading: string
  readonly subtitle?: string
  readonly icon?: React.ReactNode
  readonly status: PipelineRunStatus
  /** Empty for a run recorded as one result: the stepper is left out. */
  readonly steps: readonly PipelineStep[]
  /** The running step's live detail: its title, start time (epoch ms) and log lines. */
  readonly activity?: { readonly title: string; readonly startedAt: number; readonly lines: readonly PipelineLogLine[] } | undefined
  /** Shown once the run settles. */
  readonly summary?: { readonly title: string; readonly rows: readonly PipelineSummaryRow[] } | undefined
  readonly targets?: readonly SlidingSegmentOption<string>[]
  readonly target?: string
  readonly onTargetChange?: (target: string) => void
  /** Extra footer control between the target switch and the primary action. */
  readonly extraAction?: React.ReactNode
  readonly onStart?: () => void
  readonly onCancel?: () => void
  readonly onReset?: () => void
  /** Status chip label when done, e.g. "Released", "Landed". */
  readonly doneLabel?: string
  /** Status chip label when failed, e.g. "Timed out". */
  readonly failedLabel?: string
}

/**
 * A step-by-step run card: a stepper whose connectors fill as steps finish, a spinning ring on the running step and a
 * check that pops on completion; below, the running step's live log (shimmering title, ticking clock, lines rising in)
 * cross-fades into a summary when the run settles. Landing a thread, a release, a verification run.
 */
export function PipelineRun({
  heading,
  subtitle,
  icon,
  status,
  steps,
  activity,
  summary,
  targets,
  target,
  onTargetChange,
  extraAction,
  onStart,
  onCancel,
  onReset,
  doneLabel = 'Done',
  failedLabel = 'Failed',
  className,
  ...props
}: PipelineRunProps) {
  const runningIndex = steps.findIndex(step => step.state === 'running')
  const settled = steps.filter(step => step.state === 'done').length
  const panelMode = status === 'running' ? 'activity' : status === 'idle' ? 'idle' : 'summary'
  const primaryAction = primaryActionFor({ status, onStart, onCancel, onReset })
  const hasFooter = (targets !== undefined && target !== undefined) || extraAction !== undefined || primaryAction !== undefined
  const panelRef = React.useRef<HTMLDivElement>(null)
  useEnter(panelRef, 'blurIn', { duration: durations.base, ease: easings.out }, panelMode)

  return (
    <section
      aria-label={heading}
      className={cn(
        'dshx:@container dshx:flex dshx:w-full dshx:min-w-0 dshx:flex-col dshx:gap-2.5 dshx:rounded-2xl dshx:border dshx:border-border dshx:bg-muted/60 dshx:p-3',
        className,
      )}
      {...props}
    >
      <header className="dshx:flex dshx:items-center dshx:gap-3 dshx:px-1">
        <span className="dshx:grid dshx:size-9 dshx:shrink-0 dshx:place-items-center dshx:rounded-[10px] dshx:bg-foreground dshx:text-background dshx:[&_svg]:size-4 dshx:@max-pane-narrow:hidden">
          {icon ?? <PackageIcon />}
        </span>
        <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
          <span className="dshx:truncate dshx:text-sm dshx:font-semibold dshx:text-foreground">{heading}</span>
          {subtitle ? <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">{subtitle}</span> : null}
        </div>
        <StatusChip
          status={status}
          step={runningIndex === -1 ? settled : runningIndex + 1}
          total={steps.length}
          doneLabel={doneLabel}
          failedLabel={failedLabel}
        />
      </header>

      {steps.length === 0 ? null : (
        <ol
          aria-label="Steps"
          className="dshx:flex dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card dshx:px-2 dshx:pt-4 dshx:pb-2 dshx:@max-pane-narrow:px-1"
        >
          {steps.map((step, index) => (
            <StepNode key={step.id} step={step} index={index} next={steps[index + 1]} />
          ))}
        </ol>
      )}

      <div
        className={cn(
          'dshx:flex dshx:flex-col dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card dshx:p-4 dshx:@max-pane-narrow:p-3',
          // The fixed height keeps a live run from jumping as the log cross-fades into the summary.
          steps.length > 0 && 'dshx:min-h-[156px] dshx:@max-pane-narrow:min-h-[132px]',
        )}
        aria-live="polite"
      >
        <div ref={panelRef} key={panelMode} className="dshx:flex dshx:flex-1 dshx:flex-col">
          {panelMode === 'activity' && activity ? (
            <ActivityPanel activity={activity} />
          ) : panelMode === 'summary' && summary ? (
            <SummaryPanel summary={summary} failed={status === 'failed'} />
          ) : (
            <IdlePanel steps={steps} />
          )}
        </div>
      </div>

      {hasFooter ? (
        <footer className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
          {targets && target !== undefined ? (
            <SlidingSegments
              aria-label="Target"
              options={targets}
              value={target}
              onValueChange={value => onTargetChange?.(value)}
              className="dshx:rounded-full dshx:p-1 dshx:[&>span]:rounded-full dshx:[&>button]:rounded-full"
            />
          ) : null}
          {extraAction}
          {primaryAction ? (
            <Button className={primaryActionClass} onClick={primaryAction.onClick}>
              {primaryAction.label}
            </Button>
          ) : null}
        </footer>
      ) : null}
    </section>
  )
}

/** The footer's one action for the run's state; left out when the screen gave no handler for it. */
function primaryActionFor(input: {
  readonly status: PipelineRunStatus
  readonly onStart: (() => void) | undefined
  readonly onCancel: (() => void) | undefined
  readonly onReset: (() => void) | undefined
}): { readonly label: string; readonly onClick: () => void } | undefined {
  if (input.status === 'running') return input.onCancel && { label: 'Cancel', onClick: input.onCancel }
  if (input.status === 'idle') return input.onStart && { label: 'Start', onClick: input.onStart }
  return input.onReset && { label: 'Reset', onClick: input.onReset }
}

/** `ml-auto` instead of a spacer so the action stays right-aligned when the footer wraps. */
const primaryActionClass = 'dshx:ml-auto dshx:h-9 dshx:min-w-32 dshx:rounded-full dshx:px-6 dshx:@max-pane-narrow:min-w-0 dshx:@max-pane-narrow:px-5'

/** Before the run: the steps in order, so the empty log still says what Start will do. */
function IdlePanel({ steps }: { readonly steps: readonly PipelineStep[] }) {
  return (
    <div className="dshx:flex dshx:flex-1 dshx:flex-col dshx:items-center dshx:justify-center dshx:gap-1.5 dshx:text-center">
      <p className="dshx:text-sm dshx:font-medium dshx:text-foreground">Ready to run {steps.length} steps</p>
      <p className="dshx:max-w-[34ch] dshx:text-xs dshx:leading-relaxed dshx:text-muted-foreground">{steps.map(step => step.label).join(' → ')}</p>
    </div>
  )
}

function statusChipContent(status: PipelineRunStatus, step: number, total: number, doneLabel: string, failedLabel: string): React.ReactNode {
  switch (status) {
    case 'running':
      return (
        <>
          <span aria-hidden className="dshx:size-1.5 dshx:rounded-full dshx:bg-current" />
          Step {step}
          <span className="dshx:opacity-60">/{total}</span>
        </>
      )
    case 'done':
      return (
        <>
          <CheckIcon aria-hidden /> {doneLabel}
        </>
      )
    case 'failed':
      return (
        <>
          <XIcon aria-hidden /> {failedLabel}
        </>
      )
    case 'cancelled':
      return (
        <>
          <MinusIcon aria-hidden /> Cancelled
        </>
      )
    case 'idle':
      return 'Not started'
  }
}

function StatusChip({
  status,
  step,
  total,
  doneLabel,
  failedLabel,
}: {
  readonly status: PipelineRunStatus
  readonly step: number
  readonly total: number
  readonly doneLabel: string
  readonly failedLabel: string
}) {
  const ref = React.useRef<HTMLSpanElement>(null)
  useEnter(ref, 'popIn', springs.bouncy, status)
  return (
    <span
      ref={ref}
      className={cn(
        'dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:gap-1.5 dshx:rounded-full dshx:border dshx:px-2.5 dshx:py-0.5 dshx:text-xs dshx:font-medium dshx:[&_svg]:size-3',
        status === 'running' && 'dshx:border-info/30 dshx:bg-info/10 dshx:text-info',
        status === 'done' && 'dshx:border-success/30 dshx:bg-success/10 dshx:text-success',
        status === 'failed' && 'dshx:border-destructive/30 dshx:bg-destructive/10 dshx:text-destructive',
        (status === 'idle' || status === 'cancelled') && 'dshx:border-border dshx:bg-background dshx:text-muted-foreground',
      )}
    >
      {statusChipContent(status, step, total, doneLabel, failedLabel)}
    </span>
  )
}

function StepNode({ step, index, next }: { readonly step: PipelineStep; readonly index: number; readonly next: PipelineStep | undefined }) {
  const markRef = React.useRef<HTMLSpanElement>(null)
  const fillRef = React.useRef<HTMLSpanElement>(null)
  const durationRef = React.useRef<HTMLSpanElement>(null)
  const settled = step.state === 'done' || step.state === 'failed'
  useEnter(markRef, 'popIn', springs.bouncy, settled ? step.state : 'open')
  useEnter(durationRef, 'riseIn', springs.smooth, step.durationSeconds === undefined ? 'none' : 'shown')

  const fill = step.state === 'done' ? 1 : step.state === 'running' ? 0.3 : 0
  React.useLayoutEffect(() => {
    const element = fillRef.current
    if (element == null) return
    const controls = animate(element, { transform: `scaleX(${fill})` }, motionSafe({ duration: durations.slower, ease: easings.inOut }))
    return () => controls.stop()
  }, [fill])

  return (
    <li
      className="dshx:relative dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:items-center dshx:gap-1.5 dshx:px-0.5"
      aria-label={`${step.label}: ${step.state}`}
    >
      {next ? (
        <span
          aria-hidden
          className="dshx:absolute dshx:top-[15px] dshx:left-[calc(50%+20px)] dshx:h-0.5 dshx:w-[calc(100%-40px)] dshx:overflow-hidden dshx:rounded-full dshx:bg-border"
        >
          <span
            ref={fillRef}
            style={{ transform: 'scaleX(0)' }}
            className={cn('dshx:absolute dshx:inset-0 dshx:origin-left', step.state === 'running' ? 'dshx:bg-info' : 'dshx:bg-success')}
          />
        </span>
      ) : null}
      <span
        className={cn(
          'dshx:relative dshx:grid dshx:size-8 dshx:place-items-center dshx:rounded-full dshx:border dshx:transition-colors dshx:duration-300',
          step.state === 'pending' && 'dshx:border-border dshx:bg-background',
          step.state === 'running' && 'dshx:border-info/30 dshx:bg-info/10 dshx:ring-4 dshx:ring-info/10',
          step.state === 'done' && 'dshx:border-success/30 dshx:bg-success/15 dshx:text-success',
          step.state === 'failed' && 'dshx:border-destructive/30 dshx:bg-destructive/15 dshx:text-destructive',
        )}
      >
        {step.state === 'running' ? <SpinRing /> : null}
        <span ref={markRef} className="dshx:grid dshx:place-items-center dshx:[&_svg]:size-3.5">
          {step.state === 'done' ? (
            <CheckIcon aria-hidden strokeWidth={2.5} />
          ) : step.state === 'failed' ? (
            <XIcon aria-hidden strokeWidth={2.5} />
          ) : (
            <span
              aria-hidden
              className={cn('dshx:text-[11px] dshx:font-medium dshx:tabular-nums', step.state === 'running' ? 'dshx:text-info' : 'dshx:text-muted-foreground')}
            >
              {index + 1}
            </span>
          )}
        </span>
      </span>
      <span className={cn('dshx:max-w-full dshx:truncate dshx:text-xs', step.state === 'pending' ? 'dshx:text-muted-foreground' : 'dshx:text-foreground')}>
        {step.label}
      </span>
      <span ref={durationRef} className="dshx:h-4 dshx:font-mono dshx:text-[11px] dshx:text-muted-foreground dshx:tabular-nums">
        {step.durationSeconds === undefined ? '' : `${step.durationSeconds.toFixed(1)}s`}
      </span>
    </li>
  )
}

/** The rotating partial ring on the running step. */
function SpinRing() {
  const ref = React.useRef<SVGSVGElement>(null)
  const reduced = usePrefersReducedMotion()
  React.useEffect(() => {
    if (reduced || ref.current == null) return
    const controls = animate(ref.current, { rotate: [0, 360] }, { duration: 0.9, ease: 'linear', repeat: Infinity })
    return () => controls.stop()
  }, [reduced])
  return (
    <svg ref={ref} aria-hidden viewBox="0 0 32 32" className="dshx:absolute dshx:inset-[-1px] dshx:size-8 dshx:text-info">
      <circle cx="16" cy="16" r="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="22 63" />
    </svg>
  )
}

/** Seconds since `startedAt`, one decimal, written by `everyFrame` without re-rendering. */
function LiveSeconds({ startedAt, className }: { readonly startedAt: number; readonly className?: string }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  React.useEffect(() => {
    const element = ref.current
    if (element == null) return
    let shown = ''
    return everyFrame(() => {
      const text = `${Math.max(0, (Date.now() - startedAt) / 1000).toFixed(1)}s`
      if (text !== shown) {
        shown = text
        element.textContent = text
      }
    })
  }, [startedAt])
  return <span ref={ref} className={className} role="timer" aria-label="Elapsed" />
}

function ActivityPanel({ activity }: { readonly activity: NonNullable<PipelineRunProps['activity']> }) {
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-3">
      <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-3">
        <ShimmerText className="dshx:min-w-0 dshx:truncate dshx:text-sm dshx:font-medium">{activity.title}</ShimmerText>
        <LiveSeconds startedAt={activity.startedAt} className="dshx:shrink-0 dshx:font-mono dshx:text-xs dshx:text-muted-foreground dshx:tabular-nums" />
      </div>
      <PresenceList
        as="ol"
        className="dshx:flex dshx:flex-col"
        enter="slideInLeft"
        items={activity.lines.map((line, index) => ({
          key: line.id,
          node: <LogLine line={line} last={index === activity.lines.length - 1} />,
        }))}
      />
    </div>
  )
}

function LogLine({ line, last }: { readonly line: PipelineLogLine; readonly last: boolean }) {
  return (
    <div className="dshx:flex dshx:flex-col">
      <div className="dshx:flex dshx:items-center dshx:gap-2.5 dshx:text-sm">
        <span className="dshx:grid dshx:size-4 dshx:shrink-0 dshx:place-items-center dshx:text-violet dshx:[&_svg]:size-3.5">{line.icon}</span>
        <span className={cn('dshx:min-w-0 dshx:truncate', line.state === 'failed' ? 'dshx:text-destructive' : 'dshx:text-foreground')}>{line.text}</span>
      </div>
      {last && line.state === 'running' ? (
        <div className="dshx:flex dshx:items-center dshx:gap-2.5 dshx:pt-2">
          <span className="dshx:grid dshx:size-4 dshx:shrink-0 dshx:place-items-center">
            <SmallSpinner />
          </span>
          <span aria-hidden className="dshx:h-2 dshx:w-36 dshx:overflow-hidden dshx:rounded-full dshx:bg-muted">
            <IndeterminateBar />
          </span>
        </div>
      ) : null}
    </div>
  )
}

function SmallSpinner() {
  const ref = React.useRef<SVGSVGElement>(null)
  const reduced = usePrefersReducedMotion()
  React.useEffect(() => {
    if (reduced || ref.current == null) return
    const controls = animate(ref.current, { rotate: [0, 360] }, { duration: 0.8, ease: 'linear', repeat: Infinity })
    return () => controls.stop()
  }, [reduced])
  return (
    <svg ref={ref} aria-hidden viewBox="0 0 16 16" className="dshx:size-3 dshx:text-info">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeDasharray="14 40" />
    </svg>
  )
}

function IndeterminateBar() {
  const ref = React.useRef<HTMLSpanElement>(null)
  const reduced = usePrefersReducedMotion()
  React.useEffect(() => {
    if (reduced || ref.current == null) return
    const controls = animate(ref.current, { transform: ['translateX(-100%)', 'translateX(260%)'] }, { duration: 1.3, ease: easings.inOut, repeat: Infinity })
    return () => controls.stop()
  }, [reduced])
  return <span ref={ref} className="dshx:block dshx:h-full dshx:w-2/5 dshx:rounded-full dshx:bg-foreground/15" />
}

function SummaryPanel({ summary, failed }: { readonly summary: NonNullable<PipelineRunProps['summary']>; readonly failed: boolean }) {
  const listRef = React.useRef<HTMLDListElement>(null)
  useEnter(listRef, 'slideInLeft', { children: true, stagger: 0.06, delay: 0.08 })
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-3">
      <span className={cn('dshx:text-sm dshx:font-medium', failed ? 'dshx:text-destructive' : 'dshx:text-foreground')}>{summary.title}</span>
      <dl ref={listRef} className="dshx:flex dshx:flex-col">
        {summary.rows.map((row, index) => (
          <div key={row.id} className="dshx:relative dshx:flex dshx:items-center dshx:gap-2.5 dshx:py-1 dshx:text-sm">
            {index < summary.rows.length - 1 ? (
              <span aria-hidden className="dshx:absolute dshx:top-[22px] dshx:left-[7px] dshx:h-3 dshx:w-px dshx:bg-border" />
            ) : null}
            <span className="dshx:grid dshx:size-4 dshx:shrink-0 dshx:place-items-center dshx:text-muted-foreground dshx:[&_svg]:size-3.5">{row.icon}</span>
            <dt className="dshx:shrink-0 dshx:text-muted-foreground">{row.label}</dt>
            <dd className="dshx:min-w-0 dshx:font-medium dshx:break-words dshx:text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
