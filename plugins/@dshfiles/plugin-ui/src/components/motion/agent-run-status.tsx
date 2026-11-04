import * as React from 'react'
import { animate, motionSafe, springs, durations, easings } from '../../motion/index.js'
import { useEnter, usePrefersReducedMotion } from '../../motion/react.js'
import { cn } from '../../lib/utils.js'
import { ArrowUpRightIcon, AsteriskIcon, CheckIcon, CircleXIcon, PauseIcon, PlayIcon, SquareIcon, type LucideIcon } from '../../icons.js'
import { Button } from '../ui/button.js'
import { ShimmerText, RollingNumber } from './text.js'
import { ElapsedClock, formatDuration } from './elapsed-clock.js'

export type AgentRunState = 'running' | 'paused' | 'done' | 'stopped' | 'failed'

export interface AgentRunStep {
  readonly id: string
  readonly label: string
  readonly icon?: LucideIcon
  /** Epoch ms. */
  readonly startedAt: number
  readonly endedAt?: number
}

export interface AgentRunStatusProps extends Omit<React.HTMLAttributes<HTMLElement>, 'children' | 'title'> {
  /** What the run is for ("Fix the flaky webhook test"); the header shows it while the step row shows the current step. */
  readonly heading: string
  readonly model: string
  /** Steps so far, oldest first; the last one is the current step. */
  readonly steps: readonly AgentRunStep[]
  readonly totalSteps: number
  /** Epoch ms the run started (header clock). */
  readonly startedAt: number
  readonly endedAt?: number
  readonly state: AgentRunState
  /** Glyph in the spinner ring; defaults to an asterisk. */
  readonly glyph?: LucideIcon
  readonly onPauseToggle?: () => void
  readonly onStop?: () => void
  readonly onOpen?: () => void
  readonly openLabel?: string
}

const stateLabel = {
  running: 'Running',
  paused: 'Paused',
  done: 'Completed',
  stopped: 'Stopped',
  failed: 'Failed',
} as const satisfies Record<AgentRunState, string>

/**
 * Compact live status card for one agent run: a spinning ring around the agent glyph, the current step shimmering,
 * a live clock, "Step n of N" with a segmented progress rail, and Pause / Stop / Open run. Step changes blur in,
 * segments fill on a spring, and the ring settles into a check (or cross) when the run ends.
 */
export function AgentRunStatus({
  heading,
  model,
  steps,
  totalSteps,
  startedAt,
  endedAt,
  state,
  glyph,
  onPauseToggle,
  onStop,
  onOpen,
  openLabel = 'Open run',
  className,
  ...props
}: AgentRunStatusProps) {
  const current = steps[steps.length - 1]
  const index = Math.min(steps.length, totalSteps)
  const active = state === 'running'
  const finished = state === 'done' || state === 'stopped' || state === 'failed'
  const CurrentIcon = current?.icon
  return (
    <section
      aria-label={`Agent run: ${heading}, ${stateLabel[state].toLowerCase()}`}
      className={cn(
        'dshx:@container dshx:flex dshx:flex-col dshx:gap-4 dshx:rounded-2xl dshx:border dshx:border-border dshx:bg-card dshx:p-4 dshx:text-card-foreground dshx:shadow-sm',
        className,
      )}
      {...props}
    >
      <header className="dshx:flex dshx:items-center dshx:gap-3">
        <RunRing state={state} glyph={glyph ?? AsteriskIcon} />
        <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-0.5">
          <ShimmerText active={active} className={cn('dshx:min-w-0 dshx:truncate dshx:text-sm dshx:font-medium', !active && 'dshx:text-foreground')}>
            {heading}
          </ShimmerText>
          <Swap swapKey={state} className="dshx:min-w-0 dshx:truncate dshx:text-xs dshx:text-muted-foreground">
            <span aria-live="polite">{stateLabel[state]}</span>
          </Swap>
        </div>
        <ElapsedClock
          startedAt={startedAt}
          endedAt={endedAt}
          running={active}
          aria-label="Elapsed"
          className="dshx:shrink-0 dshx:font-mono dshx:text-sm dshx:text-muted-foreground"
        />
      </header>

      <div className="dshx:flex dshx:flex-col dshx:gap-2">
        <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-3 dshx:text-xs dshx:text-muted-foreground">
          <span className="dshx:min-w-0 dshx:truncate">{model}</span>
          <span className="dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:gap-1">
            Step <RollingNumber value={index} /> of {totalSteps}
          </span>
        </div>
        <SegmentRail
          total={totalSteps}
          done={finished && state === 'done' ? totalSteps : Math.max(0, index - 1)}
          current={finished ? -1 : index - 1}
          paused={state === 'paused'}
        />
      </div>

      {current ? (
        <Swap swapKey={current.id} preset="riseIn" className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-3 dshx:text-sm">
          {CurrentIcon ? <CurrentIcon aria-hidden className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" /> : null}
          <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{current.label}</span>
          <ElapsedClock
            startedAt={current.startedAt}
            endedAt={current.endedAt ?? endedAt}
            running={active}
            format={formatDuration}
            className="dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground"
          />
        </Swap>
      ) : null}

      <footer className="dshx:flex dshx:items-center dshx:gap-2">
        <Button
          variant="outline"
          size="sm"
          className="dshx:rounded-full dshx:px-3.5"
          onClick={onPauseToggle}
          disabled={finished || onPauseToggle === undefined}
          aria-pressed={state === 'paused'}
        >
          {state === 'paused' ? <PlayIcon aria-hidden /> : <PauseIcon aria-hidden />}
          <span className="dshx:@max-pane-narrow:sr-only">{state === 'paused' ? 'Resume' : 'Pause'}</span>
        </Button>
        <Button variant="outline" size="sm" className="dshx:rounded-full dshx:px-3.5" onClick={onStop} disabled={finished || onStop === undefined}>
          <SquareIcon aria-hidden />
          <span className="dshx:@max-pane-narrow:sr-only">Stop</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="dshx:ml-auto dshx:rounded-full dshx:text-muted-foreground"
          onClick={onOpen}
          disabled={onOpen === undefined}
        >
          {openLabel}
          <ArrowUpRightIcon aria-hidden />
        </Button>
      </footer>
    </section>
  )
}

/** Remounts its children under a new key and plays an enter preset, so labels swap with a soft blur. */
function Swap({
  swapKey,
  preset = 'blurIn',
  className,
  children,
}: {
  readonly swapKey: string
  readonly preset?: 'blurIn' | 'riseIn'
  readonly className?: string
  readonly children: React.ReactNode
}) {
  return (
    <SwapInner key={swapKey} preset={preset} className={className}>
      {children}
    </SwapInner>
  )
}

function SwapInner({
  preset,
  className,
  children,
}: {
  readonly preset: 'blurIn' | 'riseIn'
  readonly className: string | undefined
  readonly children: React.ReactNode
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  useEnter(ref, preset, { duration: durations.base, ease: easings.out })
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}

function RunRing({ state, glyph: Glyph }: { readonly state: AgentRunState; readonly glyph: LucideIcon }) {
  const arc = React.useRef<SVGSVGElement>(null)
  const badge = React.useRef<HTMLSpanElement>(null)
  const reduced = usePrefersReducedMotion()
  const spinning = state === 'running' && !reduced
  React.useEffect(() => {
    if (!spinning || arc.current == null) return
    const controls = animate(arc.current, { rotate: [0, 360] }, { duration: 1.1, ease: 'linear', repeat: Infinity })
    return () => controls.stop()
  }, [spinning])
  React.useLayoutEffect(() => {
    if (badge.current == null || state === 'running' || state === 'paused') return
    const controls = animate(badge.current, { transform: ['scale(0.4)', 'scale(1)'], opacity: [0, 1] }, motionSafe(springs.bouncy))
    return () => controls.complete()
  }, [state])
  const ended = state === 'done' || state === 'stopped' || state === 'failed'
  return (
    <span
      className="dshx:relative dshx:inline-flex dshx:size-9 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-full dshx:bg-muted"
      aria-hidden
    >
      <svg ref={arc} viewBox="0 0 36 36" className={cn('dshx:absolute dshx:inset-0 dshx:size-9', ended && 'dshx:opacity-0')}>
        <circle cx="18" cy="18" r="16.5" fill="none" stroke="currentColor" strokeWidth="1.5" className="dshx:text-border" />
        <circle
          cx="18"
          cy="18"
          r="16.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray="26 200"
          className={cn(state === 'paused' ? 'dshx:text-muted-foreground' : 'dshx:text-foreground')}
        />
      </svg>
      {ended ? (
        <span
          ref={badge}
          className={cn(
            'dshx:inline-flex dshx:size-9 dshx:items-center dshx:justify-center dshx:rounded-full',
            state === 'done' && 'dshx:bg-success/15 dshx:text-success',
            state === 'failed' && 'dshx:bg-destructive/15 dshx:text-destructive',
            state === 'stopped' && 'dshx:bg-muted dshx:text-muted-foreground',
          )}
        >
          {state === 'done' ? (
            <CheckIcon className="dshx:size-4" />
          ) : state === 'failed' ? (
            <CircleXIcon className="dshx:size-4" />
          ) : (
            <SquareIcon className="dshx:size-3.5" />
          )}
        </span>
      ) : (
        <Glyph className={cn('dshx:size-4', state === 'paused' ? 'dshx:text-muted-foreground' : 'dshx:text-chart-3')} />
      )}
    </span>
  )
}

/** Segmented progress: done segments fill on a spring, the current one breathes. */
function SegmentRail({ total, done, current, paused }: { readonly total: number; readonly done: number; readonly current: number; readonly paused: boolean }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const reduced = usePrefersReducedMotion()
  React.useLayoutEffect(() => {
    const root = ref.current
    if (root == null) return
    const fills = Array.from(root.querySelectorAll<HTMLElement>('[data-fill]'))
    const controls = fills.map((fill, index) => {
      const target = index < done ? 1 : index === current ? 0.45 : 0
      return animate(fill, { transform: `scaleX(${target})` }, motionSafe({ ...springs.smooth, delay: index < done ? 0 : 0.05 }))
    })
    let pulse: ReturnType<typeof animate> | undefined
    const live = fills[current]
    if (live !== undefined && !paused && !reduced) pulse = animate(live, { opacity: [1, 0.45, 1] }, { duration: 1.6, ease: 'easeInOut', repeat: Infinity })
    return () => {
      for (const c of controls) c.stop()
      pulse?.stop()
      if (live !== undefined) live.style.opacity = ''
    }
  }, [done, current, paused, reduced, total])
  return (
    <div ref={ref} role="progressbar" aria-label="Run progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} className="dshx:flex dshx:gap-1">
      {Array.from({ length: total }, (_, index) => (
        <span key={index} className="dshx:relative dshx:h-[3px] dshx:flex-1 dshx:overflow-hidden dshx:rounded-full dshx:bg-muted">
          <span
            data-fill
            style={{ transform: 'scaleX(0)' }}
            className={cn('dshx:absolute dshx:inset-0 dshx:origin-left dshx:rounded-full', index === current ? 'dshx:bg-info' : 'dshx:bg-foreground/60')}
          />
        </span>
      ))}
    </div>
  )
}
