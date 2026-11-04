import * as React from 'react'
import { animate, drawStroke, durations, easings, everyFrame, motionSafe, presets, springs } from '../../motion/index.js'
import { useFlip } from '../../motion/react.js'
import { cn } from '../../lib/utils.js'
import type { LucideIcon } from '../../icons.js'
import { ArrowUpIcon, CheckIcon, ListOrderedIcon, MinusIcon, PauseIcon, PlayIcon, PlusIcon, XIcon } from '../../icons.js'
import { Button } from '../ui/button.js'
import { AgentAvatar, agentToneSoft, agentToneSolid, type AgentTone } from './agent-avatar.js'
import { PresenceList } from './presence-list.js'
import { RollingNumber } from './text.js'

export interface AgentQueueJob {
  readonly id: string
  readonly label: string
  readonly tone?: AgentTone
  readonly icon?: LucideIcon
  /** Epoch ms the job entered the queue; its wait time ticks from here. */
  readonly enqueuedAt: number
  readonly priority?: boolean
}

export interface AgentQueueRunningJob extends AgentQueueJob {
  /** Epoch ms the worker picked it up. */
  readonly startedAt: number
  /** 0..1 when known; the pill fills behind the label. */
  readonly progress?: number
}

export interface AgentQueueWorker {
  readonly id: string
  readonly name: string
  readonly tone?: AgentTone
  readonly job?: AgentQueueRunningJob
  /** Outcome of the job that just left this worker; tints its fly-out. */
  readonly lastOutcome?: 'done' | 'failed'
}

export interface AgentQueueProps extends React.HTMLAttributes<HTMLElement> {
  readonly name: string
  readonly live?: boolean
  readonly paused: boolean
  readonly onPausedChange?: (paused: boolean) => void
  readonly concurrency: number
  readonly onConcurrencyChange?: (concurrency: number) => void
  readonly maxConcurrency?: number
  readonly waiting: readonly AgentQueueJob[]
  readonly workers: readonly AgentQueueWorker[]
  readonly done: number
  readonly failed: number
  readonly throughputPerMin: number
  readonly waitP95Ms: number
  /** Queue depth samples, oldest first; one is appended per tick. */
  readonly depthHistory: readonly number[]
  /** Dashed reference line; spans above it are tinted. */
  readonly depthTarget?: number
  /** Seconds the history covers, for the axis label. */
  readonly historySeconds?: number
  /** Waiting rows shown before the rest collapse into tiles. */
  readonly visibleWaiting?: number
}

const tick = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1)}s`

/**
 * A live agent job queue: header stats that roll, waiting jobs whose wait time ticks, workers whose job pill slides in
 * from the queue and fills as it runs, a done/failed tally that jumps on each landing, and a scrolling depth chart.
 * Background jobs, subagent fan-out, a workflow's pending children.
 */
export function AgentQueue({
  name,
  live = true,
  paused,
  onPausedChange,
  concurrency,
  onConcurrencyChange,
  maxConcurrency = 8,
  waiting,
  workers,
  done,
  failed,
  throughputPerMin,
  waitP95Ms,
  depthHistory,
  depthTarget,
  historySeconds = 96,
  visibleWaiting = 3,
  className,
  ...props
}: AgentQueueProps) {
  const rootRef = React.useRef<HTMLElement>(null)
  const running = workers.filter(worker => worker.job !== undefined).length

  // One frame loop writes every live "x.xs" in the card; React only re-renders on data changes.
  React.useEffect(() => {
    const root = rootRef.current
    if (root == null) return
    return everyFrame(() => {
      const now = Date.now()
      for (const element of Array.from(root.querySelectorAll<HTMLElement>('[data-since]'))) {
        const since = Number(element.dataset.since)
        const frozen = element.dataset.frozen === 'true'
        if (!frozen) element.textContent = tick(now - since)
      }
    })
  }, [])

  const shown = waiting.slice(0, visibleWaiting)
  const overflow = waiting.slice(visibleWaiting)

  return (
    <section ref={rootRef} aria-label={`Queue ${name}`} className={cn('dshx:@container dshx:flex dshx:flex-col dshx:gap-4 dshx:text-sm', className)} {...props}>
      <header className="dshx:flex dshx:items-center dshx:gap-2">
        <ListOrderedIcon aria-hidden className="dshx:size-4 dshx:shrink-0 dshx:text-info" />
        <span className="dshx:font-medium">Queue</span>
        <span className="dshx:min-w-0 dshx:truncate dshx:text-muted-foreground">{name}</span>
        {live ? <LiveBadge paused={paused} /> : null}
        <div className="dshx:ml-auto dshx:flex dshx:items-center dshx:gap-1.5">
          <Button variant="outline" size="sm" aria-pressed={paused} onClick={() => onPausedChange?.(!paused)}>
            {paused ? <PlayIcon /> : <PauseIcon />}
            <span className="dshx:@max-pane-narrow:sr-only">{paused ? 'Resume' : 'Pause'}</span>
          </Button>
          <div role="group" aria-label="Concurrency" className="dshx:flex dshx:items-center dshx:rounded-md dshx:border dshx:border-border">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Fewer workers"
              disabled={concurrency <= 1}
              onClick={() => onConcurrencyChange?.(concurrency - 1)}
            >
              <MinusIcon />
            </Button>
            <RollingNumber value={concurrency} className="dshx:w-5 dshx:justify-center dshx:font-medium" />
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="More workers"
              disabled={concurrency >= maxConcurrency}
              onClick={() => onConcurrencyChange?.(concurrency + 1)}
            >
              <PlusIcon />
            </Button>
          </div>
        </div>
      </header>

      <dl className="dshx:grid dshx:grid-cols-4 dshx:divide-x dshx:divide-border dshx:@max-pane-narrow:grid-cols-2 dshx:@max-pane-narrow:divide-x-0 dshx:@max-pane-narrow:gap-y-3">
        <Stat label="Waiting">
          <RollingNumber value={waiting.length} />
        </Stat>
        <Stat label="Running">
          <RollingNumber value={running} />
          <span className="dshx:text-muted-foreground">/{concurrency}</span>
        </Stat>
        <Stat label="Throughput">
          <RollingNumber value={throughputPerMin} />
          <span className="dshx:text-muted-foreground">/min</span>
        </Stat>
        <Stat label="Wait p95">
          <RollingNumber value={Math.round(waitP95Ms / 1000)} />
          <span className="dshx:text-muted-foreground">s</span>
        </Stat>
      </dl>

      <div className="dshx:grid dshx:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)_6.5rem] dshx:gap-3 dshx:@max-pane-compact:grid-cols-[minmax(0,1fr)_6.5rem] dshx:@max-pane-narrow:grid-cols-1">
        <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2">
          <SectionLabel label="Queue" count={waiting.length} />
          <PresenceList
            as="ol"
            aria-label="Waiting jobs"
            className="dshx:flex dshx:flex-col dshx:gap-1.5"
            enter="slideInLeft"
            exit="popOut"
            items={shown.map(job => ({ key: job.id, node: <WaitingRow job={job} /> }))}
          />
          {overflow.length > 0 ? <OverflowTiles jobs={overflow} /> : null}
          {waiting.length === 0 ? <p className="dshx:px-1 dshx:text-xs dshx:text-muted-foreground">Nothing waiting</p> : null}
        </div>

        <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2 dshx:@max-pane-compact:order-last dshx:@max-pane-compact:col-span-full">
          <SectionLabel label="Workers" count={running} total={workers.length} />
          {/* The landing fly-out heads for the tally column; below 28rem the tallies sit underneath, so clip it to the lane. */}
          <ul aria-label="Workers" className="dshx:flex dshx:flex-col dshx:gap-1.5 dshx:@max-pane-narrow:overflow-x-clip">
            {workers.map(worker => (
              <WorkerRow key={worker.id} worker={worker} />
            ))}
          </ul>
        </div>

        {/* Below 28rem the tallies sit side by side under the workers. */}
        <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:pt-6 dshx:@max-pane-narrow:order-last dshx:@max-pane-narrow:flex-row dshx:@max-pane-narrow:pt-0">
          <Tally kind="done" value={done} />
          <Tally kind="failed" value={failed} />
        </div>
      </div>

      <DepthChart history={depthHistory} target={depthTarget} historySeconds={historySeconds} />
    </section>
  )
}

function LiveBadge({ paused }: { readonly paused: boolean }) {
  const dot = React.useRef<HTMLSpanElement>(null)
  React.useEffect(() => {
    if (paused || dot.current == null) return
    const controls = animate(dot.current, { opacity: [1, 0.3, 1] }, motionSafe({ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }))
    return () => controls.stop()
  }, [paused])
  return (
    <span
      className={cn(
        'dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:rounded-md dshx:px-1.5 dshx:py-0.5 dshx:text-xs dshx:font-medium',
        paused ? 'dshx:bg-warning/15 dshx:text-warning' : 'dshx:bg-info/15 dshx:text-info',
      )}
    >
      <span ref={dot} aria-hidden className="dshx:size-1.5 dshx:rounded-full dshx:bg-current" />
      {paused ? 'Paused' : 'Live'}
    </span>
  )
}

function Stat({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1 dshx:px-3 dshx:first:pl-0 dshx:@max-pane-narrow:px-0">
      <dt className="dshx:text-[11px] dshx:font-medium dshx:uppercase dshx:tracking-wide dshx:text-muted-foreground">{label}</dt>
      <dd className="dshx:flex dshx:items-baseline dshx:text-base dshx:font-medium dshx:tabular-nums">{children}</dd>
    </div>
  )
}

function SectionLabel({ label, count, total }: { readonly label: string; readonly count: number; readonly total?: number }) {
  return (
    <div className="dshx:flex dshx:items-baseline dshx:gap-1.5 dshx:text-[11px] dshx:font-medium dshx:uppercase dshx:tracking-wide dshx:text-muted-foreground">
      {label}
      <span className="dshx:flex dshx:text-foreground">
        <RollingNumber value={count} />
        {total !== undefined ? `/${total}` : null}
      </span>
    </div>
  )
}

function JobIcon({ job }: { readonly job: AgentQueueJob }) {
  const Icon = job.icon
  return (
    <span
      className={cn(
        'dshx:inline-flex dshx:size-5 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded dshx:[&_svg]:size-3',
        agentToneSoft[job.tone ?? 'violet'],
      )}
    >
      {Icon ? <Icon /> : <span className="dshx:text-[10px] dshx:font-semibold">{job.label.charAt(0)}</span>}
    </span>
  )
}

function WaitingRow({ job }: { readonly job: AgentQueueJob }) {
  return (
    <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:rounded-md dshx:border dshx:border-border dshx:bg-card dshx:px-2 dshx:py-1.5 dshx:shadow-xs">
      <JobIcon job={job} />
      <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{job.label}</span>
      {job.priority ? <ArrowUpIcon aria-label="Priority" className="dshx:size-3 dshx:shrink-0 dshx:text-warning" /> : null}
      <Since at={job.enqueuedAt} className="dshx:shrink-0 dshx:text-xs dshx:tabular-nums dshx:text-muted-foreground" />
    </div>
  )
}

/**
 * A live "x.xs" since `at`. The text is written before paint (reading the clock during render is impure) and the
 * card's frame loop keeps it ticking through `data-since`; React never owns the text node.
 */
function Since({ at, className }: { readonly at: number; readonly className: string }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  React.useLayoutEffect(() => {
    if (ref.current != null) ref.current.textContent = tick(Date.now() - at)
  }, [at])
  return <span ref={ref} data-since={at} className={className} />
}

function OverflowTiles({ jobs }: { readonly jobs: readonly AgentQueueJob[] }) {
  const ref = React.useRef<HTMLDivElement>(null)
  useFlip(ref, [jobs.map(job => job.id).join('|')], { enterPreset: 'popIn' })
  return (
    <div ref={ref} aria-label={`${jobs.length} more waiting`} role="img" className="dshx:flex dshx:flex-wrap dshx:gap-1 dshx:px-1 dshx:pt-1">
      {jobs.slice(0, 24).map(job => (
        <span key={job.id} data-flip-key={job.id} className={cn('dshx:size-3 dshx:rounded-[3px] dshx:opacity-70', agentToneSolid[job.tone ?? 'violet'])} />
      ))}
    </div>
  )
}

function WorkerRow({ worker }: { readonly worker: AgentQueueWorker }) {
  const job = worker.job
  const previous = React.useRef<AgentQueueRunningJob | undefined>(job)
  const [leaving, setLeaving] = React.useState<{ readonly job: AgentQueueRunningJob; readonly outcome: 'done' | 'failed' } | null>(null)
  if (previous.current !== undefined && previous.current.id !== job?.id) {
    const left = previous.current
    previous.current = job
    setLeaving({ job: left, outcome: worker.lastOutcome ?? 'done' })
  } else if (previous.current === undefined && job !== undefined) {
    previous.current = job
  }

  return (
    <li className="dshx:flex dshx:items-center dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-muted/30 dshx:p-1.5">
      <div className="dshx:flex dshx:w-32 dshx:min-w-0 dshx:shrink-0 dshx:items-center dshx:gap-2 dshx:@max-pane-narrow:w-auto">
        <AgentAvatar name={worker.name} tone={worker.tone ?? 'chart-4'} decorative />
        {/* Below 28rem the avatar letter names the worker and the job pill gets the width. */}
        <span className="dshx:min-w-0 dshx:truncate dshx:font-medium dshx:@max-pane-narrow:sr-only">{worker.name}</span>
      </div>
      <div className="dshx:relative dshx:h-8 dshx:min-w-0 dshx:flex-1">
        {job ? (
          <JobPill key={job.id} job={job} />
        ) : (
          <div className="dshx:flex dshx:h-full dshx:items-center dshx:rounded-md dshx:border dshx:border-dashed dshx:border-border dshx:px-2.5 dshx:text-muted-foreground">
            Idle
          </div>
        )}
        {leaving ? <LeavingPill key={leaving.job.id} job={leaving.job} outcome={leaving.outcome} onDone={() => setLeaving(null)} /> : null}
      </div>
    </li>
  )
}

function JobPill({ job }: { readonly job: AgentQueueRunningJob }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const fill = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    if (ref.current == null) return
    const controls = animate(ref.current, presets.slideInLeft, motionSafe({ ...springs.smooth, delay: 0.05 }))
    return () => controls.complete()
  }, [])
  const progress = Math.min(1, Math.max(0, job.progress ?? 0))
  React.useEffect(() => {
    if (fill.current == null) return
    const controls = animate(fill.current, { width: `${progress * 100}%` }, motionSafe({ duration: durations.slow, ease: easings.out }))
    return () => controls.stop()
  }, [progress])
  return (
    <div
      ref={ref}
      className="dshx:relative dshx:flex dshx:h-full dshx:items-center dshx:gap-2 dshx:overflow-hidden dshx:rounded-md dshx:border dshx:border-violet/30 dshx:bg-card dshx:px-1.5"
      aria-label={`${job.label}, ${Math.round(progress * 100)}%`}
    >
      <div ref={fill} aria-hidden className="dshx:absolute dshx:inset-y-0 dshx:left-0 dshx:w-0 dshx:bg-violet/15" />
      <span className="dshx:relative">
        <JobIcon job={job} />
      </span>
      <span className="dshx:relative dshx:min-w-0 dshx:flex-1 dshx:truncate">{job.label}</span>
      {job.priority ? <ArrowUpIcon aria-label="Priority" className="dshx:relative dshx:size-3 dshx:shrink-0 dshx:text-warning" /> : null}
      <Since at={job.startedAt} className="dshx:relative dshx:shrink-0 dshx:pr-1 dshx:text-xs dshx:tabular-nums dshx:text-violet" />
    </div>
  )
}

function LeavingPill({ job, outcome, onDone }: { readonly job: AgentQueueRunningJob; readonly outcome: 'done' | 'failed'; readonly onDone: () => void }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const finish = React.useRef(onDone)
  finish.current = onDone
  React.useLayoutEffect(() => {
    if (ref.current == null) return
    const controls = animate(
      ref.current,
      { transform: ['translateX(0%) scale(1)', 'translateX(70%) scale(0.92)'], opacity: [1, 1, 0] },
      motionSafe({ duration: durations.slower, ease: easings.emphasized }),
    )
    void controls.finished.then(() => finish.current())
    return () => controls.stop()
  }, [])
  return (
    <div
      ref={ref}
      aria-hidden
      className={cn(
        'dshx:pointer-events-none dshx:absolute dshx:inset-0 dshx:flex dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-2.5',
        outcome === 'done' ? 'dshx:bg-success/25 dshx:text-success' : 'dshx:bg-destructive/20 dshx:text-destructive',
      )}
    >
      {outcome === 'done' ? <CheckIcon className="dshx:size-3.5 dshx:shrink-0" /> : <XIcon className="dshx:size-3.5 dshx:shrink-0" />}
      <span className="dshx:min-w-0 dshx:truncate">{job.label}</span>
    </div>
  )
}

function Tally({ kind, value }: { readonly kind: 'done' | 'failed'; readonly value: number }) {
  const chip = React.useRef<HTMLSpanElement>(null)
  const first = React.useRef(true)
  React.useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (chip.current == null) return
    const controls = animate(chip.current, { transform: ['scale(1)', 'scale(1.3)', 'scale(1)'] }, motionSafe({ duration: 0.45, ease: easings.out }))
    return () => controls.complete()
  }, [value])
  const done = kind === 'done'
  return (
    <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-muted/30 dshx:p-2.5 dshx:@max-pane-narrow:flex-1">
      <div className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-[11px] dshx:font-medium dshx:uppercase dshx:tracking-wide dshx:text-muted-foreground">
        <span
          ref={chip}
          className={cn(
            'dshx:inline-flex dshx:size-5 dshx:items-center dshx:justify-center dshx:rounded dshx:[&_svg]:size-3',
            done ? 'dshx:bg-success/15 dshx:text-success' : 'dshx:bg-destructive/15 dshx:text-destructive',
          )}
        >
          {done ? <CheckIcon aria-hidden /> : <XIcon aria-hidden />}
        </span>
        {done ? 'Done' : 'Failed'}
      </div>
      <RollingNumber value={value} className={cn('dshx:text-xl dshx:font-medium', done ? 'dshx:text-foreground' : 'dshx:text-destructive')} />
    </div>
  )
}

function useWidth<T extends HTMLElement>(ref: React.RefObject<T>): number {
  const [width, setWidth] = React.useState(0)
  React.useLayoutEffect(() => {
    const element = ref.current
    if (element == null) return
    setWidth(element.getBoundingClientRect().width)
    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return width
}

const CHART_HEIGHT = 120
const PAD_TOP = 8

function DepthChart({
  history,
  target,
  historySeconds,
}: {
  readonly history: readonly number[]
  readonly target: number | undefined
  readonly historySeconds: number
}) {
  const box = React.useRef<HTMLDivElement>(null)
  const scroller = React.useRef<SVGGElement>(null)
  const line = React.useRef<SVGPathElement>(null)
  const drawn = React.useRef(false)
  const width = useWidth(box)
  const max = Math.max(4, Math.ceil(Math.max(...history, target ?? 0) / 4) * 4)
  const step = history.length > 1 ? width / (history.length - 1) : width
  const y = (value: number) => PAD_TOP + (CHART_HEIGHT - PAD_TOP) * (1 - value / max)
  const points = history.map((value, index) => [index * step, y(value)] as const)
  const linePath = points.map(([x, py], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${py.toFixed(1)}`).join(' ')
  const areaPath = points.length > 0 ? `${linePath} L${width.toFixed(1)} ${CHART_HEIGHT} L0 ${CHART_HEIGHT} Z` : ''
  const last = points[points.length - 1]

  // Spans above the target, as [startIndex, endIndex] pairs.
  const bands: [number, number][] = []
  if (target !== undefined) {
    let start = -1
    history.forEach((value, index) => {
      if (value > target && start < 0) start = index
      if ((value <= target || index === history.length - 1) && start >= 0) {
        bands.push([start, value > target ? index : index - 1])
        start = -1
      }
    })
  }

  // First draw: trace the line in. Later samples: scroll the chart left by one step.
  React.useLayoutEffect(() => {
    if (width === 0 || line.current == null) return
    if (!drawn.current) {
      drawn.current = true
      const path = line.current
      const controls = drawStroke(path, { duration: 1.1 })
      void controls.finished.then(() => {
        path.style.strokeDasharray = ''
        path.style.strokeDashoffset = ''
      })
      return
    }
    if (scroller.current == null) return
    const controls = animate(
      scroller.current,
      { transform: [`translateX(${step}px)`, 'translateX(0px)'] },
      motionSafe({ duration: durations.slow, ease: easings.out }),
    )
    return () => controls.complete()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, width])

  return (
    <figure className="dshx:flex dshx:flex-col dshx:gap-1.5">
      <figcaption className="dshx:text-[11px] dshx:font-medium dshx:uppercase dshx:tracking-wide dshx:text-muted-foreground">Queue depth</figcaption>
      <div className="dshx:flex dshx:gap-2">
        <div
          className="dshx:flex dshx:flex-col dshx:justify-between dshx:py-0.5 dshx:text-[11px] dshx:tabular-nums dshx:text-muted-foreground"
          style={{ height: CHART_HEIGHT }}
        >
          <span>{max}</span>
          <span>{max / 2}</span>
          <span>0</span>
        </div>
        <div ref={box} className="dshx:relative dshx:min-w-0 dshx:flex-1 dshx:overflow-hidden" style={{ height: CHART_HEIGHT }}>
          {width > 0 ? (
            <svg
              width={width}
              height={CHART_HEIGHT}
              role="img"
              aria-label={`Queue depth, now ${history[history.length - 1] ?? 0}`}
              className="dshx:block dshx:overflow-visible"
            >
              <g ref={scroller}>
                {bands.map(([from, to]) => (
                  <rect
                    key={`${from}-${to}`}
                    x={from * step}
                    y={0}
                    width={Math.max(step, (to - from) * step)}
                    height={CHART_HEIGHT}
                    className="dshx:fill-warning/10"
                  />
                ))}
                <path d={areaPath} className="dshx:fill-violet/10" />
                <path ref={line} d={linePath} fill="none" strokeWidth={1.5} strokeLinejoin="round" className="dshx:stroke-violet" />
              </g>
              {target !== undefined ? (
                <line x1={0} x2={width} y1={y(target)} y2={y(target)} strokeDasharray="3 4" strokeWidth={1} className="dshx:stroke-muted-foreground/50" />
              ) : null}
              {last ? <circle cx={last[0]} cy={last[1]} r={3.5} className="dshx:fill-violet" /> : null}
            </svg>
          ) : null}
        </div>
      </div>
      <div className="dshx:flex dshx:justify-between dshx:pl-6 dshx:text-[11px] dshx:text-muted-foreground">
        <span>{historySeconds}s ago</span>
        <span>now</span>
      </div>
    </figure>
  )
}
