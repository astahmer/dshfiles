import * as React from 'react'
import { animate, motionSafe, presets, springs, staggers } from '../../motion/index.js'
import { usePrefersReducedMotion } from '../../motion/react.js'
import { LoaderCircleIcon } from '../../icons.js'
import { cn } from '../../lib/utils.js'
import { RollingNumber, ShimmerText } from './text.js'
import { LaneGraphCell, layoutLaneGraph, type LaneGraphEdge, type LaneTone } from './lane-graph.js'

export type PipelineStepState = 'pending' | 'running' | 'ok' | 'failed' | 'skipped'

export interface PipelineStep {
  readonly id: string
  readonly label: string
  /** Muted prefix before the label: a branch outcome ("ok", "mismatch") or "+" for a step that spawns children. */
  readonly prefix?: string
  /** Graph lane; 0 is the left side branch lane, 1 the spine, and so on. */
  readonly lane: number
  /** Upstream step ids. */
  readonly after: readonly string[]
  readonly state: PipelineStepState
  readonly progress?: { readonly done: number; readonly total: number }
  /** Seconds since the run started. A running step's end is the run's `elapsed`. */
  readonly start?: number
  readonly end?: number
}

export interface PipelineDagProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  readonly heading: string
  readonly subtitle?: string
  readonly steps: readonly PipelineStep[]
  /** Seconds since the run started; drives the time axis, playhead and running bars. */
  readonly elapsed: number
  readonly status: 'idle' | 'running' | 'ok' | 'failed'
  readonly warnings?: number
  /** Latest log line under the table. */
  readonly latest?: { readonly at: string; readonly step: string; readonly text: string }
  readonly selectedId?: string
  readonly onSelectStep?: (id: string) => void
}

const ROW = 30
const compact = (value: number) => (value >= 1000 ? `${Math.round(value / 100) / 10}K`.replace('.0K', 'K') : `${Math.round(value)}`)
const niceScale = (seconds: number) => {
  const steps = [4, 8, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300, 600]
  return steps.find(step => step >= seconds * 1.15) ?? Math.ceil((seconds * 1.15) / 60) * 60
}
const stateLabel = { pending: 'Pending', running: 'Running', ok: 'Ok', failed: 'Failed', skipped: 'Skipped' } as const satisfies Record<
  PipelineStepState,
  string
>
const stateTone = { pending: 'muted', running: 'info', ok: 'success', failed: 'destructive', skipped: 'muted' } as const satisfies Record<
  PipelineStepState,
  LaneTone
>
const barTone = {
  pending: 'dshx:bg-muted-foreground/40',
  running: 'dshx:bg-info',
  ok: 'dshx:bg-success',
  failed: 'dshx:bg-destructive',
  skipped: 'dshx:bg-muted-foreground/40',
} as const satisfies Record<PipelineStepState, string>

/**
 * A run of a pipeline drawn the way a DAG that is mostly a list should be: one table row per step, a lane gutter whose
 * arrows point at the next steps, then state, progress and a Gantt span on a time axis that rescales as the run grows.
 * Nodes pop and edges colour as steps finish, the running row glows, bars stretch live with `elapsed`, and the latest
 * log line crossfades under the table.
 */
export function PipelineDag({
  heading,
  subtitle,
  steps,
  elapsed,
  status,
  warnings = 0,
  latest,
  selectedId,
  onSelectStep,
  className,
  ...props
}: PipelineDagProps) {
  const scale = niceScale(Math.max(elapsed, 3))
  const ticks = [0, scale / 4, scale / 2, (scale * 3) / 4]
  const byId = new Map(steps.map(step => [step.id, step] as const))
  const edges: LaneGraphEdge[] = steps.flatMap(step =>
    step.after.map(upstream => ({
      from: upstream,
      to: step.id,
      arrow: true,
      // Side branches stay on their own (lower-numbered) lane and bend next to the spine node.
      bend: (byId.get(upstream)?.lane ?? 0) > step.lane ? ('upper' as const) : ('lower' as const),
      tone: byId.get(upstream)?.state === 'ok' ? (step.state === 'pending' ? 'muted' : 'success') : stateTone[byId.get(upstream)?.state ?? 'pending'],
    })),
  )
  const layout = layoutLaneGraph(
    steps.map(step => ({ id: step.id, lane: step.lane })),
    edges,
    { rowHeight: ROW, laneWidth: 16, nodeRadius: 5 },
  )

  return (
    <section
      aria-label={heading}
      className={cn(
        'dshx-root dshx:@container dshx:flex dshx:flex-col dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card dshx:text-card-foreground',
        className,
      )}
      {...props}
    >
      <header className="dshx:flex dshx:items-center dshx:gap-2 dshx:px-3 dshx:pt-3 dshx:pb-2">
        <h3 className="dshx:min-w-0 dshx:shrink dshx:truncate dshx:text-sm dshx:font-semibold">{heading}</h3>
        {subtitle ? (
          <span className="dshx:min-w-0 dshx:shrink-[2] dshx:truncate dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">{subtitle}</span>
        ) : null}
        <span className="dshx:flex-1" />
        {warnings > 0 ? (
          <span className="dshx:shrink-0 dshx:text-xs dshx:text-warning">
            <RollingNumber value={warnings} /> {warnings === 1 ? 'warning' : 'warnings'}
          </span>
        ) : null}
        <RunStatus status={status} />
      </header>
      <div role="list" aria-label={`${heading} steps`} className="dshx:flex dshx:flex-col dshx:px-2">
        <div aria-hidden className="dshx:flex dshx:h-6 dshx:items-center dshx:gap-2 dshx:text-[11px] dshx:text-muted-foreground">
          <span className="dshx:min-w-0 dshx:flex-1 dshx:pl-1" style={{ marginLeft: layout.lanes * 16 + 8 }}>
            Step
          </span>
          <span className="dshx:w-[74px] dshx:shrink-0">State</span>
          <span className="dshx:w-16 dshx:shrink-0 dshx:@max-pane-compact:hidden">Progress</span>
          <span className="dshx:relative dshx:h-full dshx:w-[34%] dshx:shrink-0 dshx:@max-pane-narrow:hidden">
            {ticks.map(tick => (
              <span
                key={tick}
                className="dshx:absolute dshx:top-1/2 dshx:-translate-y-1/2 dshx:motion-safe:transition-[left] dshx:motion-safe:duration-500"
                style={{ left: `${(tick / scale) * 100}%` }}
              >
                {Math.round(tick)}s
              </span>
            ))}
          </span>
          <span className="dshx:w-8 dshx:shrink-0 dshx:text-right dshx:@max-pane-narrow:hidden">Span</span>
        </div>
        {steps.map((step, index) => (
          <StepRow
            key={step.id}
            step={step}
            index={index}
            layout={layout}
            scale={scale}
            elapsed={elapsed}
            ticks={ticks}
            selected={selectedId === step.id}
            onSelect={onSelectStep}
          />
        ))}
      </div>
      <LatestLine latest={latest} />
    </section>
  )
}

function RunStatus({ status }: { readonly status: PipelineDagProps['status'] }) {
  if (status === 'running') {
    return (
      <span className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1.5 dshx:text-xs">
        <LoaderCircleIcon className="dshx:size-3 dshx:animate-spin dshx:text-info dshx:motion-reduce:animate-none" />
        <ShimmerText>Running</ShimmerText>
      </span>
    )
  }
  const text = status === 'ok' ? 'Succeeded' : status === 'failed' ? 'Failed' : 'Idle'
  return (
    <span
      className={cn(
        'dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1.5 dshx:text-xs',
        status === 'ok' ? 'dshx:text-success' : status === 'failed' ? 'dshx:text-destructive' : 'dshx:text-muted-foreground',
      )}
    >
      <span
        className={cn(
          'dshx:size-1.5 dshx:rounded-full',
          status === 'ok' ? 'dshx:bg-success' : status === 'failed' ? 'dshx:bg-destructive' : 'dshx:bg-muted-foreground',
        )}
      />
      {text}
    </span>
  )
}

function StepRow({
  step,
  index,
  layout,
  scale,
  elapsed,
  ticks,
  selected,
  onSelect,
}: {
  readonly step: PipelineStep
  readonly index: number
  readonly layout: ReturnType<typeof layoutLaneGraph>
  readonly scale: number
  readonly elapsed: number
  readonly ticks: readonly number[]
  readonly selected: boolean
  readonly onSelect: ((id: string) => void) | undefined
}) {
  const row = React.useRef<HTMLDivElement>(null)
  const node = React.useRef<HTMLSpanElement>(null)
  const pulse = React.useRef<HTMLSpanElement>(null)
  const reduced = usePrefersReducedMotion()
  const delay = 0.05 + index * staggers.base
  // The rise-in plays once, staggered by the row's first position; a later reorder must not replay it.
  const enterDelay = React.useRef(delay)
  React.useLayoutEffect(() => {
    if (row.current == null) return
    const controls = animate(row.current, presets.riseIn, motionSafe({ ...springs.smooth, delay: enterDelay.current }))
    return () => controls.complete()
  }, [])
  const firstState = React.useRef(true)
  React.useLayoutEffect(() => {
    if (firstState.current) {
      firstState.current = false
      return
    }
    if (node.current == null) return
    const controls = animate(node.current, { transform: ['scale(1.6)', 'scale(1)'] }, motionSafe(springs.bouncy))
    return () => controls.complete()
  }, [step.state])
  React.useEffect(() => {
    if (step.state !== 'running' || reduced || pulse.current == null) return
    const controls = animate(pulse.current, { transform: ['scale(1)', 'scale(2.3)'], opacity: [0.55, 0] }, { duration: 1.3, repeat: Infinity, ease: 'easeOut' })
    return () => controls.stop()
  }, [step.state, reduced])

  const start = step.start
  const end = step.state === 'running' ? elapsed : step.end
  const tone = stateTone[step.state]
  const nodeEl = (
    <span className="dshx:relative dshx:flex dshx:size-2.5 dshx:items-center dshx:justify-center">
      {step.state === 'running' ? <span ref={pulse} className="dshx:absolute dshx:inset-0 dshx:rounded-full dshx:bg-info" /> : null}
      <span
        ref={node}
        className={cn(
          'dshx:relative dshx:size-2.5 dshx:rounded-full dshx:transition-colors dshx:duration-300',
          step.state === 'pending' || step.state === 'skipped'
            ? 'dshx:border-[1.5px] dshx:border-muted-foreground/70 dshx:bg-card'
            : tone === 'success'
              ? 'dshx:bg-success'
              : tone === 'destructive'
                ? 'dshx:bg-destructive'
                : 'dshx:bg-info',
        )}
      />
    </span>
  )
  const Wrapper = onSelect ? 'button' : 'div'
  return (
    <div ref={row} role="listitem" className="dshx:relative">
      <Wrapper
        {...(onSelect ? { type: 'button' as const, onClick: () => onSelect(step.id), 'aria-pressed': selected } : {})}
        className={cn(
          'dshx:flex dshx:w-full dshx:items-center dshx:gap-2 dshx:rounded-md dshx:text-left dshx:outline-none dshx:transition-colors dshx:duration-300 dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50',
          step.state === 'running' ? 'dshx:bg-info/8' : selected ? 'dshx:bg-accent' : onSelect ? 'dshx:hover:bg-accent/60' : '',
        )}
        style={{ height: ROW }}
      >
        <LaneGraphCell layout={layout} rowId={step.id} lane={step.lane} node={nodeEl} drawDelay={delay + 0.12} />
        <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-baseline dshx:gap-1.5 dshx:pl-1 dshx:text-sm">
          {step.prefix ? <span className="dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground">{step.prefix}</span> : null}
          <span
            className={cn(
              'dshx:min-w-0 dshx:truncate',
              step.state === 'pending' || step.state === 'skipped' ? 'dshx:text-foreground/80' : 'dshx:text-foreground',
            )}
          >
            {step.label}
          </span>
        </span>
        <span className="dshx:flex dshx:w-[74px] dshx:shrink-0 dshx:items-center dshx:gap-1.5 dshx:text-xs dshx:text-muted-foreground">
          {step.state === 'running' ? (
            <LoaderCircleIcon className="dshx:size-3 dshx:shrink-0 dshx:animate-spin dshx:text-info dshx:motion-reduce:animate-none" />
          ) : (
            <span
              className={cn(
                'dshx:size-1.5 dshx:shrink-0 dshx:rounded-full',
                step.state === 'ok' ? 'dshx:bg-success' : step.state === 'failed' ? 'dshx:bg-destructive' : 'dshx:border dshx:border-muted-foreground',
              )}
            />
          )}
          <span className={step.state === 'running' ? 'dshx:text-foreground' : ''}>{stateLabel[step.state]}</span>
        </span>
        <span className="dshx:relative dshx:flex dshx:h-full dshx:w-16 dshx:shrink-0 dshx:items-center dshx:justify-end dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-compact:hidden">
          {step.progress ? (
            <>
              <span className="dshx:tabular-nums">
                {compact(step.progress.done)}/{compact(step.progress.total)}
              </span>
              <span className="dshx:absolute dshx:right-0 dshx:bottom-1 dshx:left-0 dshx:h-[2px] dshx:rounded-full dshx:bg-muted">
                <span
                  className={cn(
                    'dshx:block dshx:h-full dshx:rounded-full dshx:motion-safe:transition-[width] dshx:motion-safe:duration-300',
                    step.progress.done >= step.progress.total ? 'dshx:bg-success' : 'dshx:bg-info',
                  )}
                  style={{ width: `${Math.min(100, (step.progress.done / Math.max(1, step.progress.total)) * 100)}%` }}
                />
              </span>
            </>
          ) : (
            '—'
          )}
        </span>
        <span className="dshx:relative dshx:h-full dshx:w-[34%] dshx:shrink-0 dshx:@max-pane-narrow:hidden">
          {ticks.map(tick => (
            <span
              key={tick}
              aria-hidden
              className="dshx:absolute dshx:top-1.5 dshx:bottom-1.5 dshx:w-px dshx:bg-border dshx:motion-safe:transition-[left] dshx:motion-safe:duration-500"
              style={{ left: `${(tick / scale) * 100}%` }}
            />
          ))}
          <span
            aria-hidden
            className="dshx:absolute dshx:top-1 dshx:bottom-1 dshx:w-px dshx:bg-foreground/50"
            style={{ left: `${Math.min(100, (elapsed / scale) * 100)}%` }}
          />
          {start !== undefined && end !== undefined ? (
            <span
              className={cn(
                'dshx:absolute dshx:top-1/2 dshx:h-1.5 dshx:-translate-y-1/2 dshx:rounded-full dshx:transition-colors dshx:duration-300',
                barTone[step.state],
              )}
              style={{ left: `${(start / scale) * 100}%`, width: `max(3px, ${((end - start) / scale) * 100}%)` }}
            />
          ) : null}
        </span>
        <span className="dshx:w-8 dshx:shrink-0 dshx:text-right dshx:text-xs dshx:text-muted-foreground dshx:tabular-nums dshx:@max-pane-narrow:hidden">
          {start !== undefined && end !== undefined ? <RollingNumber value={Math.floor(end - start)} format={value => `${Math.round(value)}s`} /> : '—'}
        </span>
      </Wrapper>
    </div>
  )
}

function LatestLine({ latest }: { readonly latest: PipelineDagProps['latest'] }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const key = latest ? `${latest.step}:${latest.text}` : ''
  React.useLayoutEffect(() => {
    if (ref.current == null || key === '') return
    const controls = animate(ref.current, presets.blurIn, motionSafe({ duration: 0.3 }))
    return () => controls.complete()
  }, [key])
  return (
    <div className="dshx:mt-1 dshx:flex dshx:h-9 dshx:items-center dshx:border-t dshx:border-border dshx:px-3 dshx:text-xs">
      {latest ? (
        <div ref={ref} aria-live="polite" className="dshx:flex dshx:min-w-0 dshx:items-baseline dshx:gap-2">
          <span className="dshx:shrink-0 dshx:text-muted-foreground">Latest</span>
          <span className="dshx:shrink-0 dshx:text-muted-foreground dshx:tabular-nums">{latest.at}</span>
          <span className="dshx:shrink-0 dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">{latest.step}</span>
          <span className="dshx:min-w-0 dshx:truncate dshx:font-mono dshx:text-foreground">{latest.text}</span>
        </div>
      ) : (
        <span className="dshx:text-muted-foreground">No events yet</span>
      )}
    </div>
  )
}
