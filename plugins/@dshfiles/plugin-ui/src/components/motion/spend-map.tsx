import * as React from 'react'
import { animate, drawStroke, motionSafe, springs, staggers, durations, easings } from '../../motion/index.js'
import { useEnter } from '../../motion/react.js'
import { cn } from '../../lib/utils.js'
import { TrendingDownIcon, TrendingUpIcon } from '../../icons.js'
import { RollingNumber } from './text.js'
import { DrawnPath, useNodeLinks, type NodeLink } from './node-links.js'
import { SlidingSegments, type SlidingSegmentOption } from './sliding-segments.js'

export interface SpendLeaf {
  readonly id: string
  readonly label: string
  /** A lucide icon or a letter tile. */
  readonly icon?: React.ReactNode
  readonly amount: number
  /** Share of the total, 0..1. */
  readonly share: number
  /** Change against the previous period, in percent. */
  readonly trend?: number
  /** A warning chip instead of the trend ("Near cap", "Trending over"). */
  readonly flag?: { readonly label: string; readonly tone: 'warning' | 'destructive' }
  /** Daily spend for the detail sparkline. */
  readonly series?: readonly number[]
  /** Monthly cap for the detail bar. */
  readonly cap?: number
  readonly projected?: number
}

export interface SpendDimension {
  readonly id: string
  readonly label: string
  readonly icon?: React.ReactNode
  readonly leaves: readonly SpendLeaf[]
}

export interface SpendMapProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  readonly heading: string
  readonly subtitle?: string
  readonly total: number
  readonly cap: number
  /** Under the gauge: the account or project name and the period position ("Day 18 / 30"). */
  readonly owner: string
  readonly period?: string
  readonly projected?: number
  readonly dimensions: readonly SpendDimension[]
  readonly dimensionId: string
  readonly onDimensionChange: (id: string) => void
  readonly leafId: string | null
  readonly onLeafChange: (id: string) => void
  readonly metrics?: readonly SlidingSegmentOption<string>[]
  readonly metric?: string
  readonly onMetricChange?: (metric: string) => void
  readonly format?: (value: number) => string
  readonly footer?: React.ReactNode
}

const noLeaves: readonly SpendLeaf[] = []
const formatMoney = (value: number) => `$${Math.round(value).toLocaleString('en-US')}`
const percent = (share: number) => `${Math.round(share * 100)}%`

/**
 * Where the money went: a cap gauge whose arc sweeps to the month-to-date total, fanning out to spend dimensions
 * (models, agents, projects, keys) and then to the selected dimension's entries. Choosing a dimension redraws its
 * connectors and slides its entries in; choosing an entry swaps the detail (rolling total, sparkline that draws
 * itself, cap bar). Cost per model, subagent, project or thread.
 */
export function SpendMap({
  heading,
  subtitle,
  total,
  cap,
  owner,
  period,
  projected,
  dimensions,
  dimensionId,
  onDimensionChange,
  leafId,
  onLeafChange,
  metrics,
  metric,
  onMetricChange,
  format = formatMoney,
  footer,
  className,
  ...props
}: SpendMapProps) {
  const mapRef = React.useRef<HTMLDivElement>(null)
  const dimension = dimensions.find(entry => entry.id === dimensionId) ?? dimensions[0]
  const leaves = dimension?.leaves ?? noLeaves
  const leaf = leaves.find(entry => entry.id === leafId) ?? leaves[0]

  const links = React.useMemo<NodeLink[]>(
    () => [
      ...dimensions.map(entry => ({ id: `root:${entry.id}`, from: 'root', to: `dim:${entry.id}` })),
      ...leaves.map(entry => ({ id: `leaf:${dimension?.id}:${entry.id}`, from: `dim:${dimension?.id}`, to: `leaf:${dimension?.id}:${entry.id}` })),
    ],
    [dimensions, leaves, dimension?.id],
  )
  const layout = useNodeLinks(mapRef, links, [dimension?.id, leaves.length])
  const activeLinks = [`root:${dimension?.id}`, `leaf:${dimension?.id}:${leaf?.id}`]

  const leavesRef = React.useRef<HTMLDivElement>(null)
  useEnter(leavesRef, 'slideInLeft', { children: true, stagger: staggers.base, delay: 0.12 }, dimension?.id)

  return (
    <section
      aria-label={heading}
      className={cn(
        'dshx:@container dshx:flex dshx:w-full dshx:min-w-0 dshx:flex-col dshx:overflow-hidden dshx:rounded-2xl dshx:border dshx:border-border dshx:bg-card',
        className,
      )}
      {...props}
    >
      <header className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-x-3 dshx:gap-y-2 dshx:px-4 dshx:pt-3.5 dshx:pb-3">
        <div className="dshx:flex dshx:min-w-[8rem] dshx:flex-1 dshx:flex-col">
          <span className="dshx:truncate dshx:text-sm dshx:font-semibold dshx:text-foreground">{heading}</span>
          {subtitle ? <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">{subtitle}</span> : null}
        </div>
        {metrics && metric !== undefined ? (
          <SlidingSegments size="sm" aria-label="Measure" options={metrics} value={metric} onValueChange={value => onMetricChange?.(value)} />
        ) : null}
      </header>

      {/* The map scrolls inside its own box when even the narrow layout cannot fit; it never widens the card. */}
      <div className="dshx:mx-2.5 dshx:overflow-x-auto dshx:overflow-y-hidden dshx:rounded-xl dshx:border dshx:border-border dshx:bg-background dshx:[scrollbar-width:thin]">
        <div
          ref={mapRef}
          className="dshx:relative dshx:flex dshx:min-w-fit dshx:items-center dshx:gap-7 dshx:p-4 dshx:@max-pane-compact:gap-5 dshx:@max-pane-narrow:gap-4 dshx:@max-pane-narrow:p-3"
        >
          <svg
            aria-hidden
            className="dshx:pointer-events-none dshx:absolute dshx:inset-0 dshx:size-full dshx:overflow-visible"
            width={layout.width}
            height={layout.height}
          >
            <g className="dshx:text-border">
              {links.map(link => (
                <DrawnPath
                  key={link.id}
                  d={layout.paths.get(link.id) ?? ''}
                  drawKey={link.id}
                  delay={link.id.startsWith('leaf:') ? 0.05 : 0}
                  stroke="currentColor"
                  strokeWidth={1}
                />
              ))}
            </g>
            {/* The selected route is a second, darker stroke that mounts (and so draws) on each new selection. */}
            <g className="dshx:text-foreground">
              {activeLinks.map(id => (
                <DrawnPath
                  key={id}
                  d={layout.paths.get(id) ?? ''}
                  drawKey={id}
                  delay={0.08}
                  duration={durations.slow}
                  stroke="currentColor"
                  strokeWidth={1.5}
                />
              ))}
            </g>
            {links.map(link => {
              const ends = layout.ends.get(link.id)
              if (ends === undefined) return null
              const active = activeLinks.includes(link.id)
              return (
                <g key={link.id} className={cn('dshx:transition-colors dshx:duration-300', active ? 'dshx:text-foreground' : 'dshx:text-border')}>
                  <circle cx={ends[0]} cy={ends[1]} r={2.75} className="dshx:fill-card" stroke="currentColor" strokeWidth={1.25} />
                  <circle cx={ends[2]} cy={ends[3]} r={2.75} className="dshx:fill-card" stroke="currentColor" strokeWidth={1.25} />
                </g>
              )
            })}
          </svg>

          <div className="dshx:relative dshx:flex dshx:w-[118px] dshx:shrink-0 dshx:flex-col dshx:items-center dshx:gap-2 dshx:@max-pane-narrow:hidden">
            <div data-node-anchor="root" className="dshx:relative">
              <CapGauge value={total} cap={cap} format={format} />
            </div>
            <div className="dshx:flex dshx:flex-col dshx:items-center dshx:text-center">
              <span className="dshx:text-xs dshx:font-semibold dshx:text-foreground">{owner}</span>
              {period ? <span className="dshx:text-[11px] dshx:text-muted-foreground">{period}</span> : null}
            </div>
            {projected !== undefined ? (
              <span className="dshx:rounded-md dshx:bg-warning/15 dshx:px-1.5 dshx:py-0.5 dshx:text-[11px] dshx:font-medium dshx:text-warning">
                Projected {format(projected)}
              </span>
            ) : null}
          </div>

          <div
            role="radiogroup"
            aria-label="Split by"
            className="dshx:relative dshx:flex dshx:w-[150px] dshx:shrink-0 dshx:flex-col dshx:gap-2 dshx:@max-pane-narrow:w-[116px]"
          >
            {dimensions.map(entry => (
              <DimensionCard
                key={entry.id}
                dimension={entry}
                selected={entry.id === dimension?.id}
                highlightLeafId={entry.id === dimension?.id ? (leaf?.id ?? null) : null}
                onSelect={() => onDimensionChange(entry.id)}
              />
            ))}
          </div>

          <div
            ref={leavesRef}
            key={dimension?.id}
            role="radiogroup"
            aria-label={dimension?.label ?? 'Entries'}
            className="dshx:relative dshx:flex dshx:min-w-[8.5rem] dshx:flex-1 dshx:flex-col dshx:gap-1.5"
          >
            {leaves.map(entry => (
              <LeafCard
                key={entry.id}
                anchor={`leaf:${dimension?.id}:${entry.id}`}
                leaf={entry}
                selected={entry.id === leaf?.id}
                format={format}
                onSelect={() => onLeafChange(entry.id)}
              />
            ))}
          </div>
        </div>
      </div>

      {leaf ? <LeafDetail leaf={leaf} format={format} /> : null}

      {footer ? (
        <footer className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-3 dshx:px-4 dshx:pb-3 dshx:text-[11px] dshx:text-muted-foreground">
          {footer}
        </footer>
      ) : null}
    </section>
  )
}

const TICKS = 44
const SWEEP = 300
const START = -150

/** The month-to-date arc against the cap: ticks light up as the arc sweeps, a knob rides its end. */
function CapGauge({ value, cap, format }: { readonly value: number; readonly cap: number; readonly format: (value: number) => string }) {
  const arcRef = React.useRef<SVGPathElement>(null)
  const knobRef = React.useRef<SVGCircleElement>(null)
  const ticksRef = React.useRef<SVGGElement>(null)
  const shown = React.useRef(0)
  const fraction = cap > 0 ? Math.min(1, value / cap) : 0
  const radius = 38
  const arcLength = (SWEEP / 360) * 2 * Math.PI * radius

  React.useLayoutEffect(() => {
    const arc = arcRef.current
    const knob = knobRef.current
    const ticks = ticksRef.current
    if (arc == null || knob == null || ticks == null) return
    const render = (current: number) => {
      shown.current = current
      arc.style.strokeDashoffset = `${arcLength * (1 - current)}`
      const angle = ((START + SWEEP * current - 90) * Math.PI) / 180
      knob.setAttribute('cx', `${60 + radius * Math.cos(angle)}`)
      knob.setAttribute('cy', `${60 + radius * Math.sin(angle)}`)
      const lit = Math.round(current * TICKS)
      Array.from(ticks.children).forEach((tick, index) => tick.setAttribute('data-lit', index < lit ? 'true' : 'false'))
    }
    const controls = animate(shown.current, fraction, { ...motionSafe({ ...springs.gentle }), onUpdate: render })
    return () => controls.stop()
  }, [fraction, arcLength])

  return (
    <div role="meter" aria-label="Spend against cap" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={value} className="dshx:relative dshx:size-[118px]">
      <svg viewBox="0 0 120 120" className="dshx:size-full" aria-hidden>
        <g ref={ticksRef}>
          {Array.from({ length: TICKS }, (_, index) => {
            const angle = ((START + (SWEEP * index) / (TICKS - 1) - 90) * Math.PI) / 180
            const inner = 49
            const outer = index % 4 === 0 ? 56 : 54
            return (
              <line
                key={index}
                x1={60 + inner * Math.cos(angle)}
                y1={60 + inner * Math.sin(angle)}
                x2={60 + outer * Math.cos(angle)}
                y2={60 + outer * Math.sin(angle)}
                strokeWidth={1.2}
                strokeLinecap="round"
                className="dshx:stroke-border dshx:transition-colors dshx:duration-300 dshx:data-[lit=true]:stroke-muted-foreground"
              />
            )
          })}
        </g>
        <path d={arcPath(radius)} fill="none" strokeWidth={3.5} strokeLinecap="round" className="dshx:stroke-muted" />
        <path
          ref={arcRef}
          d={arcPath(radius)}
          fill="none"
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeDasharray={arcLength}
          strokeDashoffset={arcLength}
          className="dshx:stroke-foreground"
        />
        <circle ref={knobRef} cx={60} cy={60 - radius} r={3.5} className="dshx:fill-foreground dshx:stroke-card" strokeWidth={2} />
      </svg>
      <div className="dshx:absolute dshx:inset-0 dshx:flex dshx:flex-col dshx:items-center dshx:justify-center">
        <RollingNumber value={value} format={format} className="dshx:text-lg dshx:leading-none dshx:font-semibold dshx:tracking-tight dshx:text-foreground" />
        <span className="dshx:mt-1 dshx:text-[10px] dshx:text-muted-foreground">of {format(cap)}</span>
      </div>
    </div>
  )
}

function arcPath(radius: number): string {
  const point = (degrees: number) => {
    const angle = ((degrees - 90) * Math.PI) / 180
    return `${(60 + radius * Math.cos(angle)).toFixed(2)} ${(60 + radius * Math.sin(angle)).toFixed(2)}`
  }
  return `M ${point(START)} A ${radius} ${radius} 0 1 1 ${point(START + SWEEP)}`
}

function DimensionCard({
  dimension,
  selected,
  highlightLeafId,
  onSelect,
}: {
  readonly dimension: SpendDimension
  readonly selected: boolean
  readonly highlightLeafId: string | null
  readonly onSelect: () => void
}) {
  const top = dimension.leaves.find(entry => entry.id === highlightLeafId) ?? dimension.leaves[0]
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-node-anchor={`dim:${dimension.id}`}
      onClick={onSelect}
      className={cn(
        'dshx:flex dshx:w-full dshx:flex-col dshx:gap-1.5 dshx:rounded-lg dshx:border dshx:px-2.5 dshx:py-2 dshx:text-left dshx:outline-none dshx:transition-[background-color,border-color,box-shadow] dshx:duration-200 dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50',
        selected ? 'dshx:border-foreground/25 dshx:bg-muted dshx:shadow-sm' : 'dshx:border-border dshx:bg-card dshx:hover:bg-accent/50',
      )}
    >
      <span className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-xs dshx:font-medium dshx:text-foreground dshx:[&_svg]:size-3.5 dshx:[&_svg]:text-muted-foreground">
        {dimension.icon}
        <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{dimension.label}</span>
        <span className="dshx:text-[11px] dshx:font-normal dshx:text-muted-foreground">{dimension.leaves.length}</span>
      </span>
      <span aria-hidden className="dshx:flex dshx:h-1 dshx:gap-0.5">
        {dimension.leaves.map(entry => (
          <span
            key={entry.id}
            style={{ flexGrow: Math.max(entry.share, 0.02) }}
            className={cn(
              'dshx:h-full dshx:basis-0 dshx:rounded-full dshx:transition-colors dshx:duration-300',
              entry.id === top?.id && selected ? 'dshx:bg-foreground' : 'dshx:bg-muted-foreground/30',
            )}
          />
        ))}
      </span>
      {top ? (
        <span className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-[11px] dshx:text-muted-foreground">
          <span aria-hidden className={cn('dshx:size-1.5 dshx:shrink-0 dshx:rounded-full', selected ? 'dshx:bg-foreground' : 'dshx:bg-muted-foreground/40')} />
          <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{top.label}</span>
          <RollingNumber value={Math.round(top.share * 100)} format={value => `${Math.round(value)}%`} className="dshx:font-medium dshx:text-foreground" />
        </span>
      ) : null}
    </button>
  )
}

function LeafCard({
  leaf,
  anchor,
  selected,
  format,
  onSelect,
}: {
  readonly leaf: SpendLeaf
  readonly anchor: string
  readonly selected: boolean
  readonly format: (value: number) => string
  readonly onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-node-anchor={anchor}
      onClick={onSelect}
      className={cn(
        'dshx:flex dshx:w-full dshx:items-center dshx:gap-2 dshx:rounded-lg dshx:border dshx:px-2 dshx:py-1.5 dshx:text-left dshx:outline-none dshx:transition-[background-color,border-color,box-shadow,transform] dshx:duration-200 dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50 dshx:active:scale-[0.98]',
        selected ? 'dshx:border-foreground/25 dshx:bg-muted dshx:shadow-sm' : 'dshx:border-border dshx:bg-card dshx:hover:bg-accent/50',
      )}
    >
      <span className="dshx:grid dshx:size-6 dshx:shrink-0 dshx:place-items-center dshx:rounded-md dshx:border dshx:border-border dshx:bg-background dshx:text-[11px] dshx:font-semibold dshx:text-foreground dshx:[&_svg]:size-3.5">
        {leaf.icon ?? leaf.label.slice(0, 1)}
      </span>
      <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
        <span className="dshx:truncate dshx:text-xs dshx:font-medium dshx:text-foreground">{leaf.label}</span>
        <span className="dshx:truncate dshx:text-[10px] dshx:text-muted-foreground dshx:tabular-nums">
          {format(leaf.amount)} · {percent(leaf.share)}
        </span>
      </span>
      {leaf.flag ? (
        <span
          className={cn(
            'dshx:shrink-0 dshx:rounded-md dshx:px-1.5 dshx:py-0.5 dshx:text-[10px] dshx:font-medium dshx:@max-pane-narrow:hidden',
            leaf.flag.tone === 'destructive' ? 'dshx:bg-destructive/12 dshx:text-destructive' : 'dshx:bg-warning/15 dshx:text-warning',
          )}
        >
          {leaf.flag.label}
        </span>
      ) : leaf.trend !== undefined ? (
        <TrendChip trend={leaf.trend} className="dshx:@max-pane-narrow:hidden" />
      ) : null}
    </button>
  )
}

function TrendChip({ trend, suffix, className }: { readonly trend: number; readonly suffix?: string; readonly className?: string }) {
  const up = trend >= 0
  return (
    <span
      className={cn(
        'dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:rounded-md dshx:border dshx:border-border dshx:px-1.5 dshx:py-0.5 dshx:text-[10px] dshx:font-medium dshx:text-foreground dshx:tabular-nums dshx:[&_svg]:size-3',
        className,
      )}
    >
      {up ? <TrendingUpIcon aria-hidden /> : <TrendingDownIcon aria-hidden />}
      {up ? '+' : '−'}
      {Math.abs(trend)}%{suffix ? <span className="dshx:font-normal dshx:text-muted-foreground">{suffix}</span> : null}
    </span>
  )
}

/** The selected entry: rolling month-to-date amount, a sparkline that draws itself, and the cap bar. */
function LeafDetail({ leaf, format }: { readonly leaf: SpendLeaf; readonly format: (value: number) => string }) {
  const lineRef = React.useRef<SVGPolylineElement>(null)
  const fillRef = React.useRef<SVGPolygonElement>(null)
  const capRef = React.useRef<HTMLSpanElement>(null)
  const series = leaf.series ?? []
  const width = 200
  const height = 48
  const max = Math.max(1, ...series)
  const min = Math.min(...series, max)
  const points = series.map(
    (value, index) =>
      [series.length > 1 ? (index / (series.length - 1)) * width : 0, height - 4 - ((value - min) / Math.max(1, max - min)) * (height - 10)] as const,
  )
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const lastPoint = points[points.length - 1]
  const capRatio = leaf.cap ? (leaf.projected ?? leaf.amount) / leaf.cap : 0
  const over = capRatio > 1

  React.useLayoutEffect(() => {
    const path = lineRef.current
    const fill = fillRef.current
    if (path == null || fill == null) return
    const a = drawStroke(path, { duration: durations.slower + 0.2, ease: easings.out })
    const b = animate(fill, { opacity: [0, 1] }, motionSafe({ duration: durations.slower, delay: 0.25 }))
    return () => {
      a.complete()
      b.complete()
    }
  }, [leaf.id])

  React.useLayoutEffect(() => {
    const bar = capRef.current
    if (bar == null) return
    const controls = animate(bar, { width: `${Math.min(100, capRatio * 100)}%` }, motionSafe({ duration: durations.slower, ease: easings.emphasized }))
    return () => controls.stop()
  }, [capRatio])

  return (
    <div className="dshx:grid dshx:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] dshx:items-end dshx:gap-4 dshx:px-4 dshx:pt-3 dshx:pb-3 dshx:@max-pane-narrow:grid-cols-1">
      <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
        <span className="dshx:truncate dshx:text-[11px] dshx:text-muted-foreground">{leaf.label} · month to date</span>
        <span className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
          <RollingNumber value={leaf.amount} format={format} className="dshx:text-2xl dshx:font-semibold dshx:tracking-tight dshx:text-foreground" />
          {leaf.trend !== undefined ? <TrendChip trend={leaf.trend} suffix=" vs last" /> : null}
        </span>
        {leaf.cap ? (
          <div className="dshx:mt-1 dshx:flex dshx:flex-col dshx:gap-1">
            <span className="dshx:h-1 dshx:overflow-hidden dshx:rounded-full dshx:bg-muted">
              <span
                ref={capRef}
                style={{ width: 0 }}
                className={cn('dshx:block dshx:h-full dshx:rounded-full dshx:transition-colors', over ? 'dshx:bg-destructive' : 'dshx:bg-foreground')}
              />
            </span>
            <span className={cn('dshx:flex dshx:justify-between dshx:text-[10px]', over ? 'dshx:text-destructive' : 'dshx:text-muted-foreground')}>
              <span>{Math.round(capRatio * 100)}% of cap, projected</span>
              <span className="dshx:text-muted-foreground">{format(leaf.cap)}</span>
            </span>
          </div>
        ) : (
          <span className="dshx:text-[10px] dshx:text-muted-foreground">No monthly cap set</span>
        )}
      </div>
      <svg
        viewBox={`-4 0 ${width + 8} ${height}`}
        preserveAspectRatio="none"
        className="dshx:h-12 dshx:w-full dshx:overflow-visible dshx:text-foreground"
        aria-hidden
      >
        <defs>
          <linearGradient id={`spend-fill-${leaf.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.14} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
          </linearGradient>
        </defs>
        <polygon ref={fillRef} points={series.length > 1 ? `0,${height} ${line} ${width},${height}` : ''} fill={`url(#spend-fill-${leaf.id})`} />
        <polyline ref={lineRef} points={line} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        {lastPoint ? <circle cx={lastPoint[0]} cy={lastPoint[1]} r={2.5} fill="currentColor" /> : null}
      </svg>
    </div>
  )
}
