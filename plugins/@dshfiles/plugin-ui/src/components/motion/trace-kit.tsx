/**
 * Shared pieces of the trace components (AgentTimeline, TraceWaterfall, TraceReplay, CostWaterfall, FallbackChain):
 * tones, formatters, a nice time axis, a playback clock, a live clock, a sprung number, the stat strip, the legend,
 * the playback controls and the span glyph tile. Everything animated routes through the motion layer.
 */
import * as React from 'react'
import type { ValueAnimationTransition } from 'motion'
import { animate, easings, everyFrame, motionSafe, springs, type AnimationOptions } from '../../motion/index.js'
import { usePrefersReducedMotion } from '../../motion/react.js'
import { cn } from '../../lib/utils.js'
import {
  ChevronRightIcon,
  CornerDownRightIcon,
  LoaderCircleIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
  XIcon,
  type LucideIcon,
} from '../../icons.js'
import { Badge } from '../ui/badge.js'
import { Button } from '../ui/button.js'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group.js'
import { RollingNumber } from './text.js'

/* ---------------------------------------------------------------- tones */

export type TraceTone = 'neutral' | 'info' | 'violet' | 'teal' | 'warning' | 'success' | 'destructive' | 'primary'

/** Solid fill: model calls, the active lane colour. */
export const toneSolid = {
  neutral: 'dshx:bg-muted-foreground/60',
  info: 'dshx:bg-info',
  violet: 'dshx:bg-violet',
  teal: 'dshx:bg-teal',
  warning: 'dshx:bg-warning',
  success: 'dshx:bg-success',
  destructive: 'dshx:bg-destructive',
  primary: 'dshx:bg-primary',
} as const satisfies Record<TraceTone, string>

/** Dimmed fill: tool calls and thinking. */
export const toneSoft = {
  neutral: 'dshx:bg-muted-foreground/30',
  info: 'dshx:bg-info/40',
  violet: 'dshx:bg-violet/40',
  teal: 'dshx:bg-teal/40',
  warning: 'dshx:bg-warning/40',
  success: 'dshx:bg-success/40',
  destructive: 'dshx:bg-destructive/40',
  primary: 'dshx:bg-primary/30',
} as const satisfies Record<TraceTone, string>

/** Faint fill with a border: a span bar in a waterfall. */
export const toneTint = {
  neutral: 'dshx:bg-muted-foreground/15 dshx:border-muted-foreground/30',
  info: 'dshx:bg-info/15 dshx:border-info/35',
  violet: 'dshx:bg-violet/15 dshx:border-violet/35',
  teal: 'dshx:bg-teal/15 dshx:border-teal/35',
  warning: 'dshx:bg-warning/15 dshx:border-warning/35',
  success: 'dshx:bg-success/15 dshx:border-success/35',
  destructive: 'dshx:bg-destructive/15 dshx:border-destructive/45',
  primary: 'dshx:bg-primary/10 dshx:border-primary/25',
} as const satisfies Record<TraceTone, string>

export const toneText = {
  neutral: 'dshx:text-muted-foreground',
  info: 'dshx:text-info',
  violet: 'dshx:text-violet',
  teal: 'dshx:text-teal',
  warning: 'dshx:text-warning',
  success: 'dshx:text-success',
  destructive: 'dshx:text-destructive',
  primary: 'dshx:text-primary',
} as const satisfies Record<TraceTone, string>

export const toneBorder = {
  neutral: 'dshx:border-muted-foreground/50',
  info: 'dshx:border-info',
  violet: 'dshx:border-violet',
  teal: 'dshx:border-teal',
  warning: 'dshx:border-warning',
  success: 'dshx:border-success',
  destructive: 'dshx:border-destructive',
  primary: 'dshx:border-primary',
} as const satisfies Record<TraceTone, string>

/** Diagonal hatching in the current text colour: "waiting" time. Pair with `dshx:text-muted-foreground/50`. */
export const hatchImage = 'repeating-linear-gradient(135deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 5px)'
export const hatchStyle: React.CSSProperties = { backgroundImage: hatchImage }

/* ---------------------------------------------------------------- formatters */

export const formatDuration = (seconds: number): string => {
  const s = Math.max(0, seconds)
  if (s < 1) return `${Math.round(s * 1000)}ms`
  if (s < 10) return `${s.toFixed(1)}s`
  if (s < 60) return `${Math.round(s)}s`
  const minutes = Math.floor(s / 60)
  const rest = Math.round(s % 60)
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`
}

export const formatCost = (usd: number): string => {
  if (usd <= 0) return '$0'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

export const formatTokens = (count: number): string => {
  const n = Math.max(0, Math.round(count))
  if (n < 1000) return String(n)
  if (n < 100_000) return `${(n / 1000).toFixed(1)}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export const formatCount = (count: number): string => Math.round(count).toLocaleString()

/** Axis label for a tick in seconds: `0s`, `2s`, `0.5s`, `1m`, `1m 30s`. */
export const formatTick = (seconds: number): string => {
  if (seconds === 0) return '0s'
  if (seconds < 1) return `${Number(seconds.toFixed(2))}s`
  if (seconds < 60) return `${Number(seconds.toFixed(1))}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`
}

/* ---------------------------------------------------------------- axis */

const niceMantissa = (n: number): number => {
  if (n <= 1) return 1
  if (n <= 2) return 2
  if (n <= 5) return 5
  return 10
}

/** A 1-2-5 step that splits `span` into about `target` intervals. */
export const niceStep = (span: number, target = 4): number => {
  const raw = Math.max(span, 1e-6) / target
  const power = 10 ** Math.floor(Math.log10(raw))
  return niceMantissa(raw / power) * power
}

/** Ticks from 0 up to `domain` (inclusive when it lands on a step). */
export const ticksFor = (domain: number, target = 4): number[] => {
  const step = niceStep(domain, target)
  const ticks: number[] = []
  for (let value = 0; value <= domain + 1e-9; value += step) ticks.push(Number(value.toFixed(6)))
  return ticks
}

/** The visible domain for content that ends at `max`: some headroom for the end labels. */
export const fitDomain = (max: number, headroom = 1.22, minimum = 1): number => Math.max(minimum, max * headroom)

/** `value` as a percentage of `domain`, clamped to [0, 100]. */
export const pct = (value: number, domain: number): number => (domain <= 0 ? 0 : Math.min(100, Math.max(0, (value / domain) * 100)))

/* ---------------------------------------------------------------- tree */

export interface TraceTreeNode {
  readonly id: string
  readonly parentId?: string | undefined
}

export interface FlatTreeRow<T> {
  readonly node: T
  readonly depth: number
  readonly childCount: number
  /** All nodes below this one, collapsed or not. */
  readonly descendantCount: number
  readonly collapsed: boolean
}

/** Depth-first rows in input order, skipping the children of collapsed ids. */
export function flattenTree<T extends TraceTreeNode>(nodes: readonly T[], collapsed: ReadonlySet<string>): FlatTreeRow<T>[] {
  const ids = new Set(nodes.map(node => node.id))
  const children = new Map<string | undefined, T[]>()
  for (const node of nodes) {
    const parent = node.parentId !== undefined && ids.has(node.parentId) ? node.parentId : undefined
    const list = children.get(parent) ?? []
    list.push(node)
    children.set(parent, list)
  }
  const count = (id: string): number => (children.get(id) ?? []).reduce((sum, child) => sum + 1 + count(child.id), 0)
  const rows: FlatTreeRow<T>[] = []
  const walk = (parent: string | undefined, depth: number) => {
    for (const node of children.get(parent) ?? []) {
      const isCollapsed = collapsed.has(node.id)
      rows.push({ node, depth, childCount: (children.get(node.id) ?? []).length, descendantCount: count(node.id), collapsed: isCollapsed })
      if (!isCollapsed) walk(node.id, depth + 1)
    }
  }
  walk(undefined, 0)
  return rows
}

/** Collapsed ids as local UI state, with a stable toggle. */
export function useCollapsedSet(initial: readonly string[] = []): readonly [ReadonlySet<string>, (id: string) => void] {
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(() => new Set(initial))
  const toggle = React.useCallback((id: string) => {
    setCollapsed(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  return [collapsed, toggle] as const
}

/* ---------------------------------------------------------------- clocks */

/**
 * A number that springs to `target` instead of jumping: an axis domain that rescales as a trace grows, a bar width.
 * Reduced motion jumps.
 */
export function useSpringNumber(target: number, options: AnimationOptions = springs.smooth): number {
  const [value, setValue] = React.useState(target)
  const current = React.useRef(target)
  const optionsRef = React.useRef(options)
  optionsRef.current = options
  React.useEffect(() => {
    if (Math.abs(current.current - target) < 1e-9) return
    // SAFETY: AnimationOptions is Motion's superset of the value-transition options (the same cast `countTo` makes in
    // the motion layer); they differ only by `undefined` in optional members under exactOptionalPropertyTypes.
    const timing = motionSafe(optionsRef.current) as ValueAnimationTransition<number>
    const transition: ValueAnimationTransition<number> = {
      ...timing,
      onUpdate: (next: number) => {
        current.current = next
        setValue(next)
      },
      onComplete: () => {
        current.current = target
        setValue(target)
      },
    }
    const controls = animate(current.current, target, transition)
    return () => controls.stop()
  }, [target])
  return value
}

/**
 * Seconds since `startedAt` (epoch ms), refreshed every frame while `live`; `settled` otherwise. Under reduced motion
 * it refreshes four times a second instead of every frame.
 */
export function useTraceClock(live: boolean, startedAt: number | undefined, settled: number): number {
  const reduced = usePrefersReducedMotion()
  const read = React.useCallback(() => (startedAt === undefined ? settled : Math.max(0, (Date.now() - startedAt) / 1000)), [startedAt, settled])
  const [now, setNow] = React.useState(() => (live ? read() : settled))
  React.useEffect(() => {
    if (!live || startedAt === undefined) {
      setNow(settled)
      return
    }
    let lastBucket = -1
    return everyFrame(elapsed => {
      if (reduced) {
        const bucket = Math.floor(elapsed * 4)
        if (bucket === lastBucket) return
        lastBucket = bucket
      }
      setNow(read())
    })
  }, [live, startedAt, settled, reduced, read])
  return now
}

export interface Playback {
  readonly time: number
  readonly playing: boolean
  readonly speed: number
  readonly done: boolean
  readonly toggle: () => void
  readonly restart: () => void
  readonly setSpeed: (speed: number) => void
  readonly seek: (time: number) => void
}

/**
 * A replay clock for a recorded trace: `time` advances from 0 to `duration` every frame while playing, times `speed`.
 * Reduced motion starts at the end and does not autoplay; pressing play still replays.
 */
export function usePlayback(
  duration: number,
  { autoPlay = true, initialSpeed = 1 }: { readonly autoPlay?: boolean; readonly initialSpeed?: number } = {},
): Playback {
  const reduced = usePrefersReducedMotion()
  const [time, setTime] = React.useState(() => (reduced ? duration : 0))
  const [playing, setPlaying] = React.useState(autoPlay && !reduced)
  const [speed, setSpeed] = React.useState(initialSpeed)
  const speedRef = React.useRef(speed)
  speedRef.current = speed
  const durationRef = React.useRef(duration)
  durationRef.current = duration

  React.useEffect(() => {
    if (!playing) return
    return everyFrame((_elapsed, delta) => setTime(previous => Math.min(durationRef.current, previous + delta * speedRef.current)))
  }, [playing])

  React.useEffect(() => {
    if (playing && time >= duration) setPlaying(false)
  }, [playing, time, duration])

  const done = time >= duration
  const state = React.useRef({ playing, time })
  state.current = { playing, time }
  const toggle = React.useCallback(() => {
    if (state.current.playing) {
      setPlaying(false)
      return
    }
    if (state.current.time >= durationRef.current) setTime(0)
    setPlaying(true)
  }, [])
  const restart = React.useCallback(() => {
    setTime(0)
    setPlaying(true)
  }, [])
  const seek = React.useCallback((next: number) => setTime(Math.min(durationRef.current, Math.max(0, next))), [])
  return { time, playing, speed, done, toggle, restart, setSpeed, seek }
}

/** How much of [start, end] has elapsed at `now`, 0..1. */
export const progressAt = (start: number, end: number, now: number): number =>
  end <= start ? (now >= end ? 1 : 0) : Math.min(1, Math.max(0, (now - start) / (end - start)))

/* ---------------------------------------------------------------- pieces */

export interface TraceGlyph {
  readonly icon?: LucideIcon | undefined
  /** A letter tile instead of an icon. */
  readonly letter?: string | undefined
  readonly tone?: TraceTone | undefined
}

/** The small square tile in front of a span: a lucide icon or a letter, never a brand logo. */
export function SpanGlyph({
  glyph,
  className,
  size = 'sm',
}: {
  readonly glyph: TraceGlyph | undefined
  readonly className?: string
  readonly size?: 'sm' | 'md'
}) {
  const Icon = glyph?.icon
  const tone = glyph?.tone ?? 'neutral'
  return (
    <span
      aria-hidden
      className={cn(
        'dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-md dshx:border dshx:border-border dshx:bg-card dshx:font-semibold',
        size === 'sm' ? 'dshx:size-5 dshx:text-[10px]' : 'dshx:size-8 dshx:text-xs',
        toneText[tone],
        className,
      )}
    >
      {Icon ? <Icon className={size === 'sm' ? 'dshx:size-3' : 'dshx:size-4'} /> : (glyph?.letter ?? '·').slice(0, 1).toUpperCase()}
    </span>
  )
}

/** A dot that breathes while live (a loop that reduced motion skips). */
export function PulseDot({ active, className }: { readonly active: boolean; readonly className?: string }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  const reduced = usePrefersReducedMotion()
  React.useEffect(() => {
    if (!active || reduced || ref.current == null) return
    const controls = animate(
      ref.current,
      { opacity: [1, 0.3, 1], transform: ['scale(1)', 'scale(0.8)', 'scale(1)'] },
      { duration: 1.4, repeat: Infinity, ease: 'easeInOut' },
    )
    return () => controls.stop()
  }, [active, reduced])
  return <span ref={ref} aria-hidden className={cn('dshx:inline-block dshx:size-1.5 dshx:shrink-0 dshx:rounded-full dshx:bg-current', className)} />
}

/** The `Live` / `Done` / `Failed` chip in a trace header. */
export function TraceStatusBadge({ state }: { readonly state: 'live' | 'done' | 'failed' }) {
  if (state === 'live')
    return (
      <Badge variant="info" className="dshx:gap-1.5">
        <PulseDot active />
        Live
      </Badge>
    )
  if (state === 'failed')
    return (
      <Badge variant="outline" className="dshx:border-destructive/40 dshx:bg-destructive/10 dshx:text-destructive">
        Failed
      </Badge>
    )
  return <Badge variant="success">Done</Badge>
}

export interface TraceStat {
  readonly label: string
  readonly value: number
  readonly format?: (value: number) => string
  /** Muted text after the value ("4.1k in · 960 out"). */
  readonly hint?: React.ReactNode
  readonly tone?: TraceTone | undefined
  /** Plain text instead of rolling digits (for values that change every frame). */
  readonly plain?: boolean
}

/** A row of labelled numbers with dividers; digits roll as they change. */
export function StatStrip({ stats, className }: { readonly stats: readonly TraceStat[]; readonly className?: string }) {
  return (
    <dl
      className={cn(
        'dshx:grid dshx:grid-flow-col dshx:auto-cols-fr dshx:divide-x dshx:divide-border dshx:@max-pane-narrow:grid-flow-row dshx:@max-pane-narrow:grid-cols-3 dshx:@max-pane-narrow:divide-x-0',
        className,
      )}
    >
      {stats.map(stat => {
        const format = stat.format ?? formatCount
        return (
          <div key={stat.label} className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5 dshx:px-3 dshx:py-2 dshx:first:pl-0 dshx:@max-pane-narrow:pl-0">
            <dt className="dshx:truncate dshx:text-[10px] dshx:font-medium dshx:tracking-wider dshx:text-muted-foreground dshx:uppercase">{stat.label}</dt>
            <dd
              className={cn(
                'dshx:flex dshx:min-w-0 dshx:items-baseline dshx:gap-1.5 dshx:text-base dshx:font-medium dshx:tabular-nums',
                stat.tone ? toneText[stat.tone] : 'dshx:text-foreground',
              )}
            >
              {stat.plain ? <span>{format(stat.value)}</span> : <RollingNumber value={stat.value} format={format} />}
              {stat.hint ? <span className="dshx:truncate dshx:text-xs dshx:font-normal dshx:text-muted-foreground">{stat.hint}</span> : null}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

export type LegendSwatch = 'solid' | 'soft' | 'hatched' | 'handoff' | 'failed'

export interface LegendItem {
  readonly label: string
  readonly swatch: LegendSwatch
}

export const defaultLegend: readonly LegendItem[] = [
  { label: 'Model call', swatch: 'solid' },
  { label: 'Tool call', swatch: 'soft' },
  { label: 'Waiting', swatch: 'hatched' },
  { label: 'Handoff', swatch: 'handoff' },
  { label: 'Failed', swatch: 'failed' },
]

/** The key under a trace: what each bar style means. Hides itself in narrow panes. */
export function TraceLegend({ items = defaultLegend, className }: { readonly items?: readonly LegendItem[]; readonly className?: string }) {
  return (
    <ul
      aria-label="Legend"
      className={cn(
        'dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:justify-end dshx:gap-x-3 dshx:gap-y-1 dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-narrow:hidden',
        className,
      )}
    >
      {items.map(item => (
        <li key={item.label} className="dshx:flex dshx:items-center dshx:gap-1.5">
          <LegendMark swatch={item.swatch} />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

function LegendMark({ swatch }: { readonly swatch: LegendSwatch }) {
  if (swatch === 'handoff') return <CornerDownRightIcon aria-hidden className="dshx:size-3" />
  if (swatch === 'failed')
    return (
      <span
        aria-hidden
        className="dshx:inline-flex dshx:h-2.5 dshx:w-3.5 dshx:items-center dshx:justify-center dshx:rounded-[3px] dshx:bg-destructive dshx:text-background"
      >
        <XIcon className="dshx:size-2" strokeWidth={3} />
      </span>
    )
  if (swatch === 'hatched')
    return (
      <span aria-hidden style={hatchStyle} className="dshx:h-2.5 dshx:w-3.5 dshx:rounded-[3px] dshx:border dshx:border-border dshx:text-muted-foreground/50" />
    )
  return (
    <span
      aria-hidden
      className={cn('dshx:h-2.5 dshx:w-3.5 dshx:rounded-[3px]', swatch === 'solid' ? 'dshx:bg-foreground/80' : 'dshx:bg-muted-foreground/40')}
    />
  )
}

/** Play/pause, restart and a speed switch for a replayed trace. */
export function PlaybackControls({
  playback,
  speeds = [1, 2],
  className,
}: {
  readonly playback: Playback
  readonly speeds?: readonly number[]
  readonly className?: string
}) {
  const iconRef = React.useRef<HTMLSpanElement>(null)
  React.useLayoutEffect(() => {
    if (iconRef.current == null) return
    const controls = animate(
      iconRef.current,
      { transform: ['scale(0.6) rotate(-30deg)', 'scale(1) rotate(0deg)'], opacity: [0, 1] },
      motionSafe(springs.bouncy),
    )
    return () => controls.complete()
  }, [playback.playing])
  return (
    <div className={cn('dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1.5', className)}>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className="dshx:rounded-full"
        aria-label={playback.playing ? 'Pause replay' : playback.done ? 'Replay from start' : 'Play replay'}
        onClick={playback.toggle}
      >
        <span ref={iconRef} className="dshx:inline-flex">
          {playback.playing ? <PauseIcon className="dshx:fill-current" /> : <PlayIcon className="dshx:fill-current" />}
        </span>
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Restart replay" onClick={playback.restart}>
        <RotateCcwIcon />
      </Button>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        aria-label="Replay speed"
        value={String(playback.speed)}
        onValueChange={value => {
          if (value !== '') playback.setSpeed(Number(value))
        }}
      >
        {speeds.map(speed => (
          <ToggleGroupItem key={speed} value={String(speed)} aria-label={`${speed}× speed`} className="dshx:px-2 dshx:font-mono! dshx:text-xs">
            {speed}×
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

/** Vertical gridlines at each tick, as an overlay over a timeline column. */
export function TimeGrid({ ticks, domain, className }: { readonly ticks: readonly number[]; readonly domain: number; readonly className?: string }) {
  return (
    <div aria-hidden className={cn('dshx:pointer-events-none dshx:absolute dshx:inset-y-0 dshx:right-0', className)}>
      {ticks.map(tick => (
        <span key={tick} className="dshx:absolute dshx:inset-y-0 dshx:w-px dshx:bg-border/70" style={{ left: `${pct(tick, domain)}%` }} />
      ))}
    </div>
  )
}

/** Tick labels for a timeline column. */
export function TimeAxisLabels({
  ticks,
  domain,
  format = formatTick,
  className,
}: {
  readonly ticks: readonly number[]
  readonly domain: number
  readonly format?: (tick: number) => string
  readonly className?: string
}) {
  return (
    <div aria-hidden className={cn('dshx:relative dshx:h-full dshx:text-xs dshx:text-muted-foreground dshx:tabular-nums', className)}>
      {ticks.map(tick => {
        const left = pct(tick, domain)
        return left > 94 ? null : (
          <span key={tick} className="dshx:absolute dshx:top-1/2 dshx:-translate-y-1/2 dshx:pl-1.5 dshx:whitespace-nowrap" style={{ left: `${left}%` }}>
            {format(tick)}
          </span>
        )
      })}
    </div>
  )
}

/** Indent per tree depth, in px (10px in narrow panes). */
export const TREE_INDENT = 16

/** Left padding per depth: 16px a level, 10px in narrow panes so deep names keep their room. Depths past the end clamp. */
const indentClass = [
  'dshx:pl-0',
  'dshx:pl-4 dshx:@max-pane-narrow:pl-2.5',
  'dshx:pl-8 dshx:@max-pane-narrow:pl-5',
  'dshx:pl-12 dshx:@max-pane-narrow:pl-7.5',
  'dshx:pl-16 dshx:@max-pane-narrow:pl-10',
  'dshx:pl-20 dshx:@max-pane-narrow:pl-12.5',
] as const

/** The indent guide of each ancestor level, centred under that level's chevron. */
const guideClass = [
  'dshx:left-[7px] dshx:@max-pane-narrow:left-[4px]',
  'dshx:left-[23px] dshx:@max-pane-narrow:left-[14px]',
  'dshx:left-[39px] dshx:@max-pane-narrow:left-[24px]',
  'dshx:left-[55px] dshx:@max-pane-narrow:left-[34px]',
  'dshx:left-[71px] dshx:@max-pane-narrow:left-[44px]',
] as const

const clampIndex = (index: number, length: number) => Math.min(Math.max(0, index), length - 1)

export interface GrowRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The row was removed: it folds its height to 0 and fades, then calls `onLeft` so the list can drop it. */
  readonly leaving?: boolean
  readonly onLeft?: () => void
}

/**
 * A table row that opens on mount and folds on removal: its height grows from 0 while it fades in, so the rows below
 * slide down, and a removed row (see `useLeavingRows`) folds back to 0 so they slide up. The row keeps its own slot
 * while it changes height, so nothing is drawn over a neighbour. Reduced motion shows and removes rows at once.
 */
export function GrowRow({ className, children, leaving = false, onLeft, ...props }: GrowRowProps) {
  const ref = React.useRef<HTMLDivElement>(null)
  const onLeftRef = React.useRef(onLeft)
  onLeftRef.current = onLeft
  React.useLayoutEffect(() => {
    const element = ref.current
    if (!leaving || element == null) return
    const height = element.getBoundingClientRect().height
    element.style.overflow = 'hidden'
    // A folding row is no longer part of the table: keep focus and clicks out of it.
    element.inert = true
    const controls = animate(element, { height: [height, 0], opacity: [1, 0] }, motionSafe({ duration: 0.2, ease: easings.in }))
    let current = true
    void controls.finished.then(() => {
      if (current) onLeftRef.current?.()
    })
    return () => {
      current = false
      controls.stop()
    }
  }, [leaving])
  React.useLayoutEffect(() => {
    const element = ref.current
    if (element == null) return
    const height = element.getBoundingClientRect().height
    const clear = () => {
      element.style.removeProperty('height')
      element.style.removeProperty('overflow')
      element.style.removeProperty('opacity')
    }
    element.style.overflow = 'hidden'
    const controls = animate(element, { height: [0, height], opacity: [0, 1] }, motionSafe({ duration: 0.24, ease: easings.out }))
    void controls.finished.then(clear, clear)
    return () => {
      controls.stop()
      clear()
    }
  }, [])
  return (
    <div ref={ref} className={cn(className, leaving && 'dshx:pointer-events-none')} aria-hidden={leaving || undefined} {...props}>
      {children}
    </div>
  )
}

export interface LeavingRow<T> {
  readonly item: T
  readonly leaving: boolean
}

interface GoneRow<T> {
  readonly item: T
  /** Keys of the rows it followed, nearest first, so it folds in its old place even if its neighbour left too. */
  readonly after: readonly string[]
}

/**
 * Keeps rows that disappeared from `items` (a collapsed parent's children, a filtered-out span) in the list, flagged
 * `leaving`, until their `GrowRow` has folded and calls `drop(key)`. Derived during render, so a removed row never
 * blinks out for a frame first.
 */
export interface LeavingRows<T> {
  readonly rows: readonly LeavingRow<T>[]
  readonly drop: (key: string) => void
}

export function useLeavingRows<T>(items: readonly T[], keyOf: (item: T) => string): LeavingRows<T> {
  // Compared by keys, not identity: callers rebuild the row array on every render.
  const signature = items.map(keyOf).join('\u0000')
  const [previous, setPrevious] = React.useState({ signature, items })
  const [gone, setGone] = React.useState<readonly GoneRow<T>[]>([])
  const keyOfRef = React.useRef(keyOf)
  keyOfRef.current = keyOf
  if (previous.signature !== signature) {
    const keys = new Set(items.map(keyOf))
    const removed: GoneRow<T>[] = []
    const seen: string[] = []
    for (const item of previous.items) {
      const key = keyOf(item)
      if (!keys.has(key)) removed.push({ item, after: [...seen].reverse() })
      seen.push(key)
    }
    const removedKeys = new Set(removed.map(row => keyOf(row.item)))
    setPrevious({ signature, items })
    setGone(list => [...list.filter(row => !keys.has(keyOf(row.item)) && !removedKeys.has(keyOf(row.item))), ...removed])
  }
  const drop = React.useCallback((key: string) => setGone(list => list.filter(row => keyOfRef.current(row.item) !== key)), [])
  const rows: LeavingRow<T>[] = items.map(item => ({ item, leaving: false }))
  const present = new Set(items.map(keyOf))
  for (const row of gone) {
    if (present.has(keyOf(row.item))) continue
    let at = 0
    for (const key of row.after) {
      const index = rows.findIndex(candidate => keyOf(candidate.item) === key)
      if (index === -1) continue
      at = index + 1
      break
    }
    rows.splice(at, 0, { item: row.item, leaving: true })
  }
  return { rows, drop }
}

export interface TreeLabelProps {
  readonly depth: number
  readonly name: string
  readonly detail?: string | undefined
  readonly glyph?: TraceGlyph | undefined
  /** Has children: shows the chevron. */
  readonly expandable: boolean
  readonly collapsed: boolean
  /** Rows hidden under a collapsed node: the `+N` chip. */
  readonly hiddenCount?: number
  readonly onToggle?: (() => void) | undefined
  readonly running?: boolean
  readonly failed?: boolean
  /** Bold the name (agents). */
  readonly strong?: boolean
  /** Extra chip after the name (TOP, SLOWEST). */
  readonly badge?: React.ReactNode
  readonly className?: string
}

/** The left cell of a trace row: indent guides, chevron, glyph, name, muted detail, `+N`, spinner or warning. */
export function TreeLabel({
  depth,
  name,
  detail,
  glyph,
  expandable,
  collapsed,
  hiddenCount = 0,
  onToggle,
  running,
  failed,
  strong,
  badge,
  className,
}: TreeLabelProps) {
  return (
    <div
      className={cn(
        'dshx:relative dshx:flex dshx:h-full dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:pr-2 dshx:@max-pane-narrow:gap-1 dshx:@max-pane-narrow:pr-1',
        indentClass[clampIndex(depth, indentClass.length)],
        className,
      )}
    >
      {Array.from({ length: depth }, (_, level) => (
        <span
          key={level}
          aria-hidden
          className={cn('dshx:absolute dshx:inset-y-0 dshx:w-px dshx:bg-border', guideClass[clampIndex(level, guideClass.length)])}
        />
      ))}
      {expandable ? (
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${name}`}
          onClick={event => {
            event.stopPropagation()
            onToggle?.()
          }}
          className="dshx:inline-flex dshx:size-4 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-sm dshx:text-muted-foreground dshx:hover:bg-accent dshx:hover:text-foreground"
        >
          <ChevronRightIcon
            aria-hidden
            className={cn('dshx:size-3.5 dshx:motion-safe:transition-transform dshx:motion-safe:duration-200', collapsed ? 'dshx:rotate-0' : 'dshx:rotate-90')}
          />
        </button>
      ) : (
        <span aria-hidden className="dshx:size-4 dshx:shrink-0" />
      )}
      <SpanGlyph glyph={glyph} />
      <span className={cn('dshx:shrink dshx:truncate dshx:text-sm', strong ? 'dshx:font-medium dshx:text-foreground' : 'dshx:text-foreground/90')}>{name}</span>
      {detail ? (
        <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">{detail}</span>
      ) : (
        <span className="dshx:flex-1" />
      )}
      {collapsed && hiddenCount > 0 ? (
        <span className="dshx:shrink-0 dshx:rounded-sm dshx:bg-muted dshx:px-1 dshx:text-[10px] dshx:font-medium dshx:text-muted-foreground dshx:tabular-nums">
          +{hiddenCount}
        </span>
      ) : null}
      {badge}
      {running ? <LoaderCircleIcon aria-label="Running" role="img" className="dshx:size-3 dshx:shrink-0 dshx:text-info dshx:motion-safe:animate-spin" /> : null}
      {failed ? <TriangleAlertIcon aria-label="Failed" role="img" className="dshx:size-3.5 dshx:shrink-0 dshx:text-destructive" /> : null}
    </div>
  )
}
