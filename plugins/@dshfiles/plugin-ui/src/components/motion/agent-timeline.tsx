import * as React from 'react'
import { animate, easings, motionSafe, springs } from '../../motion/index.js'
import { cn } from '../../lib/utils.js'
import { RotateCwIcon, XIcon } from '../../icons.js'
import { RollingNumber, ShimmerText } from './text.js'
import {
  PlaybackControls,
  SpanGlyph,
  TimeAxisLabels,
  TimeGrid,
  TraceLegend,
  formatCost,
  formatDuration,
  hatchImage,
  pct,
  progressAt,
  ticksFor,
  toneBorder,
  toneSoft,
  toneSolid,
  usePlayback,
  type LegendItem,
  type TraceGlyph,
  type TraceTone,
} from './trace-kit.js'

export interface AgentTimelineLane {
  readonly id: string
  readonly name: string
  /** Model or role line under the name. */
  readonly model: string
  readonly glyph?: TraceGlyph | undefined
  readonly tone: TraceTone
}

/** `thinking` is a dim block, `tool` a solid one, `waiting` hatched, `failed` an outlined error, `retry` a solid block with a retry mark. */
export type AgentTimelineSegmentKind = 'thinking' | 'tool' | 'waiting' | 'failed' | 'retry'

export interface AgentTimelineSegment {
  readonly id: string
  readonly laneId: string
  readonly kind: AgentTimelineSegmentKind
  /** Seconds from the run start. */
  readonly start: number
  readonly end: number
  readonly label?: string | undefined
  readonly tokens?: number | undefined
  readonly cost?: number | undefined
}

/** One agent handing work to another at `at` seconds: a dot on the sender's lane and an elbow into the receiver's. */
export interface AgentTimelineHandoff {
  readonly id: string
  readonly fromLaneId: string
  readonly toLaneId: string
  readonly at: number
}

export interface AgentTimelineProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  /** The run's goal, as the card heading. */
  readonly heading: string
  readonly lanes: readonly AgentTimelineLane[]
  readonly segments: readonly AgentTimelineSegment[]
  readonly handoffs?: readonly AgentTimelineHandoff[]
  /** Run length in seconds; defaults to the last segment end. */
  readonly duration?: number
  /** Replay from the start on mount; false shows the finished run, and play still replays it. */
  readonly autoPlay?: boolean
  readonly speeds?: readonly number[]
  /** What each bar style means; defaults to agent thinking, tool calls, waiting, handoffs and failures. */
  readonly legend?: readonly LegendItem[]
  readonly labels?: Partial<AgentTimelineLabels>
}

export interface AgentTimelineLabels {
  readonly running: string
  readonly done: string
  readonly failed: string
  readonly tokens: string
  /** The accessible name of the lane list. */
  readonly lanes: string
}

const defaultLabels: AgentTimelineLabels = { running: 'Running', done: 'Done', failed: 'Failed', tokens: 'tokens', lanes: 'Agents' }

const ROW = 52
const BAR = 22

const defaultLegend: readonly LegendItem[] = [
  { label: 'Thinking', swatch: 'soft' },
  { label: 'Tool call', swatch: 'solid' },
  { label: 'Waiting', swatch: 'hatched' },
  { label: 'Handoff', swatch: 'handoff' },
  { label: 'Failed', swatch: 'failed' },
]

/**
 * A multi-agent run as swimlanes: one lane per agent, blocks that grow under a moving playhead, handoff elbows from the
 * orchestrator into each subagent, and a header whose tokens and cost roll as the replay advances. Replays a recorded
 * run (play, pause, restart, speed); data comes in through props.
 */
export function AgentTimeline({
  heading,
  lanes,
  segments,
  handoffs = [],
  duration,
  autoPlay = true,
  speeds = [1, 2],
  legend = defaultLegend,
  labels: labelOverrides,
  className,
  ...props
}: AgentTimelineProps) {
  const labels = { ...defaultLabels, ...labelOverrides }
  const length = duration ?? segments.reduce((max, segment) => Math.max(max, segment.end), 0)
  const playback = usePlayback(length, { autoPlay })
  const now = playback.time
  const domain = Math.max(1, length * 1.06)
  const ticks = ticksFor(domain, 5)
  const laneIndex = new Map(lanes.map((lane, index) => [lane.id, index]))
  const laneTone = new Map(lanes.map(lane => [lane.id, lane.tone]))

  let tokens = 0
  let cost = 0
  for (const segment of segments) {
    const done = Math.floor(progressAt(segment.start, segment.end, now) * 10) / 10
    tokens += (segment.tokens ?? 0) * done
    cost += (segment.cost ?? 0) * done
  }
  const running = now < length
  const failed = !running && segments.some(segment => segment.kind === 'failed') && !segments.some(segment => segment.kind === 'retry')

  return (
    <section
      aria-label={heading}
      className={cn(
        'dshx-root dshx:@container dshx:flex dshx:flex-col dshx:gap-4 dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card dshx:p-5 dshx:text-card-foreground',
        className,
      )}
      {...props}
    >
      <header className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5 dshx:@max-pane-narrow:px-0">
        <h3 className="dshx:truncate dshx:text-base dshx:font-medium">{heading}</h3>
        <p className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-baseline dshx:gap-x-1.5 dshx:text-sm dshx:text-muted-foreground dshx:tabular-nums">
          {running ? (
            <ShimmerText>{labels.running}</ShimmerText>
          ) : (
            <span className={failed ? 'dshx:text-destructive' : 'dshx:text-success'}>{failed ? labels.failed : labels.done}</span>
          )}
          <span aria-hidden>·</span>
          <span className="dshx:min-w-[3.5ch] dshx:text-foreground">{formatDuration(now)}</span>
          <span aria-hidden>·</span>
          <span className="dshx:inline-flex dshx:gap-1">
            <RollingNumber value={Math.round(tokens)} className="dshx:text-foreground" /> {labels.tokens}
          </span>
          <span aria-hidden>·</span>
          <RollingNumber value={cost} format={formatCost} className="dshx:text-foreground" />
        </p>
      </header>

      <div className="dshx:flex dshx:min-w-0 dshx:gap-3">
        <ol aria-label={labels.lanes} className="dshx:flex dshx:w-40 dshx:shrink-0 dshx:flex-col dshx:@max-pane-compact:w-32 dshx:@max-pane-narrow:w-24">
          {lanes.map(lane => {
            const done = segments.filter(segment => segment.laneId === lane.id && segment.end <= now).length
            return (
              <li key={lane.id} className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:justify-center" style={{ height: ROW }}>
                <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:text-sm dshx:font-medium">
                  <span aria-hidden className={cn('dshx:size-2 dshx:shrink-0 dshx:rounded-full', toneSolid[lane.tone])} />
                  <span className="dshx:min-w-0 dshx:truncate">{lane.name}</span>
                  <span className="dshx:sr-only">, {done} steps finished</span>
                </span>
                <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:pl-4 dshx:text-xs dshx:text-muted-foreground">
                  <SpanGlyph glyph={lane.glyph} className="dshx:size-3.5 dshx:border-0 dshx:bg-transparent dshx:@max-pane-narrow:hidden" />
                  <span className="dshx:min-w-0 dshx:truncate">{lane.model}</span>
                </span>
              </li>
            )
          })}
        </ol>

        <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
          <div
            role="img"
            aria-label={`Timeline at ${formatDuration(now)} of ${formatDuration(length)}`}
            className="dshx:relative dshx:border-b dshx:border-border"
            style={{ height: lanes.length * ROW }}
          >
            <TimeGrid ticks={ticks} domain={domain} className="dshx:left-0" />
            {handoffs.map(handoff => {
              const from = laneIndex.get(handoff.fromLaneId)
              const to = laneIndex.get(handoff.toLaneId)
              if (from === undefined || to === undefined || now < handoff.at) return null
              const target = segments
                .filter(segment => segment.laneId === handoff.toLaneId && segment.start >= handoff.at)
                .reduce((min, segment) => Math.min(min, segment.start), Infinity)
              return (
                <HandoffElbow
                  key={handoff.id}
                  tone={laneTone.get(handoff.toLaneId) ?? 'neutral'}
                  fromRow={from}
                  toRow={to}
                  left={pct(handoff.at, domain)}
                  width={Number.isFinite(target) ? pct(target - handoff.at, domain) : 0}
                />
              )
            })}
            {segments.map(segment => {
              const row = laneIndex.get(segment.laneId)
              if (row === undefined || now < segment.start) return null
              const visibleEnd = Math.min(segment.end, now)
              return (
                <TimelineBlock
                  key={segment.id}
                  segment={segment}
                  tone={laneTone.get(segment.laneId) ?? 'neutral'}
                  top={row * ROW + (ROW - BAR) / 2}
                  left={pct(segment.start, domain)}
                  width={pct(visibleEnd - segment.start, domain)}
                  finished={now >= segment.end}
                />
              )
            })}
            <span
              aria-hidden
              className="dshx:pointer-events-none dshx:absolute dshx:inset-y-0 dshx:w-px dshx:bg-foreground/70"
              style={{ left: `${pct(now, domain)}%` }}
            >
              <span className="dshx:absolute dshx:-bottom-1.5 dshx:-left-[5px] dshx:size-[11px] dshx:rounded-full dshx:border-2 dshx:border-card dshx:bg-foreground" />
            </span>
          </div>
          <TimeAxisLabels ticks={ticks} domain={domain} className="dshx:h-7 dshx:-ml-1.5" />
        </div>
      </div>

      <footer className="dshx:flex dshx:min-w-0 dshx:items-center dshx:justify-between dshx:gap-3">
        <PlaybackControls playback={playback} speeds={speeds} />
        <TraceLegend items={legend} />
      </footer>
    </section>
  )
}

function TimelineBlock({
  segment,
  tone,
  top,
  left,
  width,
  finished,
}: {
  readonly segment: AgentTimelineSegment
  readonly tone: TraceTone
  readonly top: number
  readonly left: number
  readonly width: number
  readonly finished: boolean
}) {
  const ref = React.useRef<HTMLSpanElement>(null)
  React.useLayoutEffect(() => {
    if (ref.current == null) return
    const controls = animate(ref.current, { opacity: [0, 1], transform: ['scaleY(0.4)', 'scaleY(1)'] }, motionSafe(springs.bouncy))
    return () => controls.complete()
  }, [])
  const iconRef = React.useRef<HTMLSpanElement>(null)
  React.useLayoutEffect(() => {
    if (!finished || iconRef.current == null) return
    const controls = animate(iconRef.current, { opacity: [0, 1], transform: ['scale(0.4)', 'scale(1)'] }, motionSafe(springs.bouncy))
    return () => controls.complete()
  }, [finished])
  const kind = segment.kind
  return (
    <span
      ref={ref}
      aria-hidden
      className={cn(
        'dshx:absolute dshx:flex dshx:items-center dshx:justify-center dshx:overflow-hidden dshx:rounded-md dshx:transition-[filter] dshx:hover:brightness-125',
        kind === 'thinking' && toneSoft[tone],
        kind === 'tool' && toneSolid[tone],
        kind === 'retry' && toneSolid[tone],
        kind === 'waiting' && 'dshx:border dshx:border-border dshx:text-muted-foreground/50',
        kind === 'failed' && 'dshx:border dshx:border-destructive/60 dshx:bg-destructive/15 dshx:text-destructive',
      )}
      style={{ top, height: BAR, left: `${left}%`, width: `max(3px, calc(${width}% - 2px))`, backgroundImage: kind === 'waiting' ? hatchImage : undefined }}
    >
      {finished && kind === 'failed' ? (
        <span ref={iconRef} className="dshx:inline-flex dshx:size-3.5 dshx:items-center dshx:justify-center dshx:rounded-full dshx:border dshx:border-current">
          <XIcon className="dshx:size-2.5" strokeWidth={2.5} />
        </span>
      ) : null}
      {finished && kind === 'retry' ? (
        <span ref={iconRef} className="dshx:inline-flex dshx:text-card">
          <RotateCwIcon className="dshx:size-3.5" strokeWidth={2.5} />
        </span>
      ) : null}
    </span>
  )
}

function HandoffElbow({
  tone,
  fromRow,
  toRow,
  left,
  width,
}: {
  readonly tone: TraceTone
  readonly fromRow: number
  readonly toRow: number
  readonly left: number
  readonly width: number
}) {
  const ref = React.useRef<HTMLSpanElement>(null)
  const dotRef = React.useRef<HTMLSpanElement>(null)
  const down = toRow >= fromRow
  React.useLayoutEffect(() => {
    if (ref.current == null || dotRef.current == null) return
    const dot = animate(dotRef.current, { opacity: [0, 1], transform: ['scale(0)', 'scale(1)'] }, motionSafe(springs.bouncy))
    const line = animate(
      ref.current,
      {
        clipPath: down
          ? ['inset(0% calc(100% - 3px) 100% 0%)', 'inset(0% calc(100% - 3px) 0% 0%)', 'inset(0% 0% 0% 0%)']
          : ['inset(100% calc(100% - 3px) 0% 0%)', 'inset(0% calc(100% - 3px) 0% 0%)', 'inset(0% 0% 0% 0%)'],
      },
      motionSafe({ duration: 0.55, ease: easings.out }),
    )
    return () => {
      dot.complete()
      line.complete()
    }
  }, [down])
  const fromY = fromRow * ROW + ROW / 2
  const toY = toRow * ROW + ROW / 2
  return (
    <>
      <span
        ref={ref}
        aria-hidden
        className={cn(
          'dshx:pointer-events-none dshx:absolute dshx:border-l-[1.5px]',
          down ? 'dshx:rounded-bl-md dshx:border-b-[1.5px]' : 'dshx:rounded-tl-md dshx:border-t-[1.5px]',
          toneBorder[tone],
        )}
        style={{ left: `${left}%`, top: down ? fromY : toY, height: Math.abs(toY - fromY), width: `${width}%` }}
      />
      <span
        ref={dotRef}
        aria-hidden
        className={cn('dshx:pointer-events-none dshx:absolute dshx:size-2 dshx:rounded-full dshx:ring-2 dshx:ring-card', toneSolid[tone])}
        style={{ left: `calc(${left}% - 3.25px)`, top: fromY - 4 }}
      />
    </>
  )
}
