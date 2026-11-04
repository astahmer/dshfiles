import * as React from 'react'
import { animate, enter, motionSafe, presets, springs, staggers, easings, type AnimationPlaybackControls } from '../../motion/index.js'
import { Button } from '../ui/button.js'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip.js'
import { CheckIcon, CircleDashedIcon, GitMergeIcon, LoaderCircleIcon, XIcon } from '../../icons.js'
import { cn } from '../../lib/utils.js'
import { ShimmerText } from './text.js'

export type MergeCheckStatus = 'queued' | 'running' | 'passed' | 'failed'

export interface MergeCheck {
  readonly id: string
  readonly label: string
  readonly status: MergeCheckStatus
  /** Short result beside the label ("42 passed", "ready"). */
  readonly detail?: string
  /** Tooltip line ("vitest · 42 passed, 0 failed"). */
  readonly summary?: string
  /** Tooltip duration ("38s"). */
  readonly duration?: string
}

export type MergeState = 'blocked' | 'ready' | 'merging' | 'merged'

export interface MergeChecksProps extends React.HTMLAttributes<HTMLDivElement> {
  readonly checks: readonly MergeCheck[]
  readonly state: MergeState
  /** Bookmark the change lands on, for the merged line. Default "main". */
  readonly into?: string
  readonly onMerge?: () => void
}

/**
 * The bottom of a landing card: one chip per check (tests, lint, types, preview) whose glyph flips from a spinner to a
 * check with a bounce as results arrive, a tooltip with each check's summary and duration, and a footer that turns into
 * "Ready to merge" with a Merge button popping in. Merging shimmers; merged sweeps a success wash across the footer.
 */
export function MergeChecks({ checks, state, into = 'main', onMerge, className, ...props }: MergeChecksProps) {
  const chips = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    if (chips.current == null) return
    const controls = enter(Array.from(chips.current.children), 'riseIn', { stagger: staggers.base })
    return () => controls?.complete()
  }, [])

  const failed = checks.filter(check => check.status === 'failed').length
  const pending = checks.filter(check => check.status === 'queued' || check.status === 'running').length

  return (
    <TooltipProvider delayDuration={150}>
      <div className={cn('dshx-root dshx:@container dshx:flex dshx:flex-col dshx:gap-2', className)} {...props}>
        <div ref={chips} role="list" aria-label="Checks" className="dshx:flex dshx:flex-wrap dshx:gap-1.5 dshx:px-1">
          {checks.map(check => (
            <CheckChip key={check.id} check={check} />
          ))}
        </div>
        <MergeFooter state={state} failed={failed} pending={pending} into={into} onMerge={onMerge} />
      </div>
    </TooltipProvider>
  )
}

const CheckChip = React.forwardRef<HTMLDivElement, { readonly check: MergeCheck }>(function CheckChip({ check }, ref) {
  const tooltip = check.summary ?? check.detail
  const chip = (
    <div
      ref={ref}
      role="listitem"
      tabIndex={tooltip ? 0 : undefined}
      aria-label={`${check.label}: ${check.detail ?? check.status}`}
      className={cn(
        'dshx:flex dshx:h-7 dshx:items-center dshx:gap-1.5 dshx:rounded-full dshx:border dshx:px-2.5 dshx:text-xs dshx:transition-colors dshx:duration-300 dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50',
        check.status === 'failed' ? 'dshx:border-destructive/40 dshx:bg-destructive/8' : 'dshx:border-border dshx:bg-muted/40 dshx:hover:bg-muted',
      )}
    >
      <StatusGlyph status={check.status} />
      <span className="dshx:font-medium dshx:text-foreground">{check.label}</span>
      {check.detail ? (
        <span className={cn('dshx:@max-pane-narrow:hidden', check.status === 'failed' ? 'dshx:text-destructive' : 'dshx:text-muted-foreground')}>
          {check.detail}
        </span>
      ) : null}
    </div>
  )
  if (!tooltip) return chip
  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent side="top">
        {tooltip}
        {check.duration ? <span className="dshx:ml-2 dshx:opacity-60">{check.duration}</span> : null}
      </TooltipContent>
    </Tooltip>
  )
})

function StatusGlyph({ status }: { readonly status: MergeCheckStatus }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  const first = React.useRef(true)
  React.useLayoutEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (ref.current == null) return
    const controls = animate(ref.current, { opacity: [0, 1], transform: ['scale(0.3) rotate(-30deg)', 'scale(1) rotate(0deg)'] }, motionSafe(springs.bouncy))
    return () => controls.complete()
  }, [status])
  return (
    <span ref={ref} aria-hidden className="dshx:flex dshx:size-3.5 dshx:items-center dshx:justify-center">
      {status === 'passed' ? (
        <CheckIcon className="dshx:size-3.5 dshx:text-success" strokeWidth={2.5} />
      ) : status === 'failed' ? (
        <XIcon className="dshx:size-3.5 dshx:text-destructive" strokeWidth={2.5} />
      ) : status === 'running' ? (
        <LoaderCircleIcon className="dshx:size-3.5 dshx:animate-spin dshx:text-info dshx:motion-reduce:animate-none" />
      ) : (
        <CircleDashedIcon className="dshx:size-3.5 dshx:text-muted-foreground" />
      )}
    </span>
  )
}

function MergeFooter({
  state,
  failed,
  pending,
  into,
  onMerge,
}: {
  readonly state: MergeState
  readonly failed: number
  readonly pending: number
  readonly into: string
  readonly onMerge: (() => void) | undefined
}) {
  const line = React.useRef<HTMLSpanElement>(null)
  const wash = React.useRef<HTMLSpanElement>(null)
  const button = React.useRef<HTMLButtonElement>(null)
  const previous = React.useRef(state)
  React.useLayoutEffect(() => {
    const from = previous.current
    previous.current = state
    if (from === state) return
    const running: AnimationPlaybackControls[] = []
    if (line.current) running.push(animate(line.current, presets.blurIn, motionSafe({ duration: 0.3, ease: easings.out })))
    if (state === 'ready' && button.current) running.push(animate(button.current, { transform: ['scale(0.85)', 'scale(1)'] }, motionSafe(springs.bouncy)))
    if (state === 'merged' && wash.current) {
      running.push(animate(wash.current, { transform: ['scaleX(0)', 'scaleX(1)'], opacity: [1, 1] }, motionSafe({ duration: 0.6, ease: easings.emphasized })))
    }
    return () => {
      for (const controls of running) controls.complete()
    }
  }, [state])

  const label =
    state === 'merged' ? (
      <>
        <CheckIcon className="dshx:size-3.5 dshx:shrink-0 dshx:text-success" />
        <span className="dshx:min-w-0 dshx:truncate">
          Merged into <code className="dshx:font-mono dshx:text-xs">{into}</code>
        </span>
      </>
    ) : state === 'merging' ? (
      <>
        <LoaderCircleIcon className="dshx:size-3.5 dshx:shrink-0 dshx:animate-spin dshx:text-muted-foreground dshx:motion-reduce:animate-none" />
        <ShimmerText className="dshx:min-w-0 dshx:truncate">Merging into {into}</ShimmerText>
      </>
    ) : state === 'ready' ? (
      <>
        <CheckIcon className="dshx:size-3.5 dshx:shrink-0 dshx:text-success" />
        <span className="dshx:min-w-0 dshx:truncate">Ready to merge</span>
      </>
    ) : failed > 0 ? (
      <>
        <XIcon className="dshx:size-3.5 dshx:shrink-0 dshx:text-destructive" />
        <span className="dshx:min-w-0 dshx:truncate dshx:text-destructive">
          {failed} {failed === 1 ? 'check' : 'checks'} failed
        </span>
      </>
    ) : (
      <>
        <LoaderCircleIcon className="dshx:size-3.5 dshx:shrink-0 dshx:animate-spin dshx:text-muted-foreground dshx:motion-reduce:animate-none" />
        <ShimmerText className="dshx:min-w-0 dshx:truncate">
          Waiting for {pending} {pending === 1 ? 'check' : 'checks'}
        </ShimmerText>
      </>
    )

  return (
    <div className="dshx:relative dshx:flex dshx:h-10 dshx:items-center dshx:gap-2 dshx:overflow-hidden dshx:rounded-lg dshx:px-1.5">
      <span
        ref={wash}
        aria-hidden
        className="dshx:absolute dshx:inset-0 dshx:origin-left dshx:bg-success/10"
        style={{ transform: state === 'merged' ? 'scaleX(1)' : 'scaleX(0)' }}
      />
      <span ref={line} aria-live="polite" className="dshx:relative dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-2 dshx:text-sm">
        {label}
      </span>
      <Button
        ref={button}
        size="sm"
        variant="secondary"
        disabled={state !== 'ready'}
        onClick={onMerge}
        className={cn(
          'dshx:relative dshx:shrink dshx:rounded-full',
          state === 'merged' ? 'dshx:bg-success/15 dshx:text-success dshx:disabled:opacity-100' : 'dshx:bg-info/12 dshx:text-info dshx:hover:bg-info/20',
        )}
      >
        {state === 'merging' ? (
          <LoaderCircleIcon className="dshx:animate-spin dshx:motion-reduce:animate-none" />
        ) : state === 'merged' ? (
          <CheckIcon />
        ) : (
          <GitMergeIcon />
        )}
        {state === 'merging' ? 'Merging' : state === 'merged' ? 'Merged' : 'Merge'}
      </Button>
    </div>
  )
}
