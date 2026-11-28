import * as React from 'react'
import { animate, motionSafe, springs } from '../../motion/index.js'
import { cn } from '../../lib/utils.js'
import { SparklesIcon } from '../../icons.js'
import { Badge } from '../ui/badge.js'
import { Button } from '../ui/button.js'
import {
  GrowRow,
  useLeavingRows,
  StatStrip,
  TimeAxisLabels,
  TimeGrid,
  TraceStatusBadge,
  TreeLabel,
  flattenTree,
  formatCost,
  formatDuration,
  formatTokens,
  niceStep,
  pct,
  ticksFor,
  toneTint,
  useCollapsedSet,
  useSpringNumber,
  useTraceClock,
  type TraceGlyph,
  type TraceTone,
  type TraceTreeNode,
} from './trace-kit.js'

/** `span` is any other operation (an HTTP handler, a query): neutral, and counted in no call total. */
export type TraceSpanKind = 'agent' | 'model' | 'tool' | 'span'

export interface TraceSpan extends TraceTreeNode {
  readonly name: string
  /** Model or tool target, muted after the name. */
  readonly detail?: string | undefined
  readonly kind: TraceSpanKind
  readonly glyph?: TraceGlyph | undefined
  /** Bar colour instead of the kind's (a service colour); a failed span stays destructive. */
  readonly tone?: TraceTone | undefined
  /** Seconds from the trace start. */
  readonly start: number
  /** Seconds from the trace start; missing while the span runs. */
  readonly end?: number | undefined
  readonly cost?: number | undefined
  readonly tokens?: number | undefined
  /** Set when the span failed. */
  readonly error?: string | undefined
}

export interface TraceWaterfallLabels {
  readonly heading: string
  /** The accessible name of the span tree. */
  readonly tree: string
  readonly span: string
  readonly duration: string
  readonly spans: string
  readonly cost: string
  readonly tokens: string
  readonly llmCalls: string
  readonly toolCalls: string
  readonly errors: string
  readonly expand: string
  readonly collapse: string
  readonly slowest: string
  /** For stored batches, whose spans do not prove the whole trace has completed. */
  readonly recorded?: string
  readonly zoomToSpan: string
  readonly resetZoom: string
  readonly zoomRange: (from: string, to: string) => string
}

const defaultLabels: TraceWaterfallLabels = {
  heading: 'Trace',
  tree: 'Spans',
  span: 'Span',
  duration: 'Duration',
  spans: 'Spans',
  cost: 'Cost',
  tokens: 'Tokens',
  llmCalls: 'LLM calls',
  toolCalls: 'Tool calls',
  errors: 'Errors',
  expand: 'Expand',
  collapse: 'Collapse',
  slowest: 'Slowest',
  zoomToSpan: 'Zoom to selected span',
  resetZoom: 'Show full trace',
  zoomRange: (from, to) => `Zoomed: ${from} to ${to} from trace start`,
}

export interface TraceWaterfallProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title' | 'onSelect'> {
  /** What the run was asked to do. */
  readonly subtitle?: string | undefined
  readonly spans: readonly TraceSpan[]
  /** Spans may still arrive; open spans grow with the clock. */
  readonly live: boolean
  /** Enable a local time window for recorded spans, without filtering the span tree. */
  readonly zoomable?: boolean
  /** Epoch ms of the trace start; the live clock counts from it. */
  readonly startedAt?: number | undefined
  readonly selectedId?: string | null | undefined
  /** Called on click, and as the arrow keys move through the tree. */
  readonly onSelectSpan?: ((id: string) => void) | undefined
  readonly defaultCollapsed?: readonly string[]
  /** Shortest axis in seconds (2 by default); a millisecond trace passes a smaller one so its bars fill the row. */
  readonly minimumDuration?: number
  readonly labels?: Partial<TraceWaterfallLabels>
}

const hasTiming = (span: TraceSpan): boolean =>
  Number.isFinite(span.start) && span.start >= 0 && (span.end === undefined || (Number.isFinite(span.end) && span.end >= span.start))

const hasInterval = (span: TraceSpan | undefined): span is TraceSpan & { end: number } => span?.end !== undefined && hasTiming(span) && span.end > span.start

// Scale the local window directly: the full-trace ticks round to whole microseconds, collapsing narrow windows.
const zoomTicks = (domain: number): number[] => [...new Set([0, domain / 4, domain / 2, domain * 0.75])]

const formatZoomTick = (tick: number, domain: number): string => {
  if (domain < 0.0001) return `${Number((tick * 1e6).toPrecision(3))}µs`
  if (domain < 0.1) return `${Number((tick * 1e3).toPrecision(3))}ms`
  return `${Number(tick.toPrecision(3))}s`
}

const formatZoomRange = (start: number, end: number): [string, string] => {
  const from = formatDuration(start)
  const to = formatDuration(end)
  if (end - start >= 0.1 && from !== to) return [from, to]
  const fromMs = Number((start * 1000).toFixed(3))
  const toMs = Number((end * 1000).toFixed(3))
  return Number.isFinite(toMs) && fromMs !== toMs ? [`${fromMs}ms`, `${toMs}ms`] : [`${start}s`, `${end}s`]
}

/** Draw fewer labels if the plot (not the viewport) cannot fit them. The time grid still uses every tick. */
function ZoomAxisLabels({ ticks, domain }: { readonly ticks: readonly number[]; readonly domain: number }) {
  const plotRef = React.useRef<HTMLDivElement>(null)
  const [stride, setStride] = React.useState(0)
  React.useLayoutEffect(() => {
    const plot = plotRef.current
    if (plot === null) return
    const labels = Array.from(plot.children)
    const measure = () => {
      const area = plot.getBoundingClientRect()
      // Hidden labels still have their natural glyph widths, including after a font change.
      const bounds = labels.map(label => label.getBoundingClientRect())
      const gap = 4
      const fits = (step: number): boolean => {
        let previousRight = area.left - gap
        return bounds.every((box, index) => {
          if (index % step !== 0) return true
          if (box.left < previousRight + gap || box.right > area.right) return false
          previousRight = box.right
          return true
        })
      }
      setStride([1, 2, labels.length].find(fits) ?? 0)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(plot)
    for (const label of labels) observer.observe(label)
    return () => observer.disconnect()
  }, [domain, ticks])
  return (
    <div
      ref={plotRef}
      aria-hidden
      data-slot="trace-waterfall-zoom-axis"
      className="dshx:relative dshx:h-full dshx:text-xs dshx:text-muted-foreground dshx:tabular-nums"
    >
      {ticks.map((tick, index) => (
        <span
          key={tick}
          className="dshx:absolute dshx:top-1/2 dshx:-translate-y-1/2 dshx:pl-1.5 dshx:whitespace-nowrap"
          style={{ left: `${pct(tick, domain)}%`, visibility: stride !== 0 && index % stride === 0 ? 'visible' : 'hidden' }}
        >
          {formatZoomTick(tick, domain)}
        </span>
      ))}
    </div>
  )
}

const isWaterfallKey = (key: string): boolean => ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(key)

/**
 * Where an agent run's time goes: a span tree on the left and a waterfall on the right. Spans rise in as they arrive,
 * open bars grow under a live cursor, the axis springs wider as the run outlasts it, totals roll, and the slowest leaf
 * gets a chip. Parents collapse to a `+N` chip. The rows form an ARIA tree with one tab stop: arrows move (and select),
 * Left/Right fold or walk to the parent and first child, Home/End jump. Data comes in through props.
 */
export function TraceWaterfall({
  subtitle,
  spans,
  live,
  zoomable = false,
  startedAt,
  selectedId,
  onSelectSpan,
  defaultCollapsed,
  minimumDuration = 2,
  labels: labelOverrides,
  className,
  ...props
}: TraceWaterfallProps) {
  const labels = { ...defaultLabels, ...labelOverrides }
  const settled = spans.reduce((max, span) => (hasTiming(span) && (live || span.end !== undefined) ? Math.max(max, span.end ?? span.start) : max), 0)
  const now = Math.max(useTraceClock(live, startedAt, settled), settled)
  const [collapsed, toggle] = useCollapsedSet(defaultCollapsed)
  const visibleRows = flattenTree(spans, collapsed)
  // Rows hidden by a collapse fold away instead of vanishing, so the rows below slide up.
  const { rows: shownRows, drop } = useLeavingRows(visibleRows, row => row.node.id)
  const treeRef = React.useRef<HTMLDivElement>(null)
  const [focusedId, setFocusedId] = React.useState<string | null>(null)

  const [zoomSpanId, setZoomSpanId] = React.useState<string | null>(null)
  const canZoom = zoomable && !live
  const zoomSpan = canZoom ? spans.find(span => span.id === zoomSpanId) : undefined
  const zoom = hasInterval(zoomSpan) ? zoomSpan : undefined
  if (zoomSpanId !== null && zoom === undefined) setZoomSpanId(null)
  const selectedSpan = canZoom ? spans.find(span => span.id === selectedId) : undefined
  const origin = zoom?.start ?? 0
  const fitted = Math.max(now * 1.2, minimumDuration)
  const step = niceStep(fitted, 4)
  const fullDomain = useSpringNumber(Math.max(Math.ceil(fitted / step) * step, minimumDuration), springs.gentle)
  const domain = zoom === undefined ? fullDomain : zoom.end - origin
  const isZoomed = zoom !== undefined
  const ticks = React.useMemo(() => (isZoomed ? zoomTicks(domain) : ticksFor(domain, 4)), [domain, isZoomed])

  const endOf = (span: TraceSpan) => span.end ?? now
  const parentIds = new Set(spans.map(span => span.parentId))
  const leaves = spans.filter(span => span.kind !== 'agent' && span.end !== undefined && hasTiming(span) && !parentIds.has(span.id))
  const slowest = leaves.length >= 3 ? leaves.reduce((a, b) => (endOf(b) - b.start > endOf(a) - a.start ? b : a)) : undefined
  const childrenOf = (id: string) => spans.filter(span => span.parentId === id)
  const costOf = (span: TraceSpan): number => span.cost ?? childrenOf(span.id).reduce((sum, child) => sum + costOf(child), 0)

  const totals = spans.reduce(
    (acc, span) => ({
      cost: acc.cost + (span.kind === 'agent' ? 0 : (span.cost ?? 0)),
      tokens: acc.tokens + (span.tokens ?? 0),
      llm: acc.llm + (span.kind === 'model' ? 1 : 0),
      tools: acc.tools + (span.kind === 'tool' ? 1 : 0),
      errors: acc.errors + (span.error === undefined ? 0 : 1),
    }),
    { cost: 0, tokens: 0, llm: 0, tools: 0, errors: 0 },
  )

  const visibleIds = visibleRows.map(row => row.node.id)
  const activeId = [focusedId, selectedId].find((id): id is string => id != null && visibleIds.includes(id)) ?? visibleIds[0]
  const moveTo = (id: string | undefined) => {
    if (id === undefined) return
    setFocusedId(id)
    onSelectSpan?.(id)
    for (const element of treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []) {
      if (element.dataset.spanId === id) element.focus()
    }
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isWaterfallKey(event.key)) return
    const index = visibleRows.findIndex(row => row.node.id === activeId)
    const row = visibleRows[index]
    if (row === undefined) return
    event.preventDefault()
    const expandable = row.childCount > 0
    if (event.key === 'ArrowDown') moveTo(visibleRows[index + 1]?.node.id)
    else if (event.key === 'ArrowUp') moveTo(visibleRows[index - 1]?.node.id)
    else if (event.key === 'Home') moveTo(visibleRows[0]?.node.id)
    else if (event.key === 'End') moveTo(visibleRows.at(-1)?.node.id)
    else if (event.key === 'ArrowRight' && expandable && row.collapsed) toggle(row.node.id)
    else if (event.key === 'ArrowRight' && expandable) moveTo(visibleRows[index + 1]?.node.id)
    else if (event.key === 'ArrowLeft' && expandable && !row.collapsed) toggle(row.node.id)
    else if (event.key === 'ArrowLeft') moveTo(visibleIds.find(id => id === row.node.parentId))
    else if (event.key === 'Enter' || event.key === ' ') onSelectSpan?.(row.node.id)
  }

  return (
    <section
      aria-label={subtitle ? `${labels.heading}: ${subtitle}` : labels.heading}
      className={cn(
        'dshx-root dshx:@container dshx:flex dshx:flex-col dshx:overflow-hidden dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card dshx:text-card-foreground',
        className,
      )}
      {...props}
    >
      <header className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:border-b dshx:border-border dshx:px-4 dshx:py-3">
        <SparklesIcon aria-hidden className="dshx:size-4 dshx:shrink-0 dshx:text-info" />
        <h3 className="dshx:shrink-0 dshx:text-sm dshx:font-medium">{labels.heading}</h3>
        {subtitle ? (
          <p className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm dshx:text-muted-foreground">{subtitle}</p>
        ) : (
          <span className="dshx:flex-1" />
        )}
        {/* A failed trace keeps its Failed badge; Recorded only replaces the neutral Done state. */}
        {!live && totals.errors === 0 && labels.recorded !== undefined ? (
          <Badge variant="muted">{labels.recorded}</Badge>
        ) : (
          <TraceStatusBadge state={live ? 'live' : totals.errors > 0 ? 'failed' : 'done'} />
        )}
      </header>

      <StatStrip
        className="dshx:border-b dshx:border-border dshx:px-4 dshx:py-1"
        stats={[
          { label: labels.duration, value: now, format: formatDuration, plain: true },
          { label: labels.spans, value: spans.length },
          { label: labels.cost, value: totals.cost, format: formatCost },
          { label: labels.tokens, value: totals.tokens, format: formatTokens },
          { label: labels.llmCalls, value: totals.llm },
          { label: labels.toolCalls, value: totals.tools },
          { label: labels.errors, value: totals.errors, tone: totals.errors > 0 ? 'destructive' : undefined },
        ]}
      />

      {canZoom ? (
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-x-3 dshx:gap-y-1 dshx:border-b dshx:border-border dshx:px-3 dshx:py-1">
          <Button
            className="dshx:h-11"
            type="button"
            variant="outline"
            size="sm"
            disabled={zoom === undefined && !hasInterval(selectedSpan)}
            onClick={() => setZoomSpanId(zoom === undefined && hasInterval(selectedSpan) ? selectedSpan.id : null)}
          >
            {zoom === undefined ? labels.zoomToSpan : labels.resetZoom}
          </Button>
          <span role="status" className="dshx:text-xs dshx:tabular-nums dshx:text-muted-foreground">
            {zoom === undefined ? '' : labels.zoomRange(...formatZoomRange(origin, zoom.end))}
          </span>
        </div>
      ) : null}

      <div className="dshx:relative dshx:min-w-0">
        <div
          aria-hidden
          className="dshx:pointer-events-none dshx:absolute dshx:inset-y-0 dshx:right-4 dshx:left-[220px] dshx:@max-pane-compact:left-[184px] dshx:@max-pane-narrow:right-3 dshx:@max-pane-narrow:left-[46%]"
        >
          <TimeGrid ticks={ticks} domain={domain} className="dshx:left-0" />
          {live ? (
            <span className="dshx:absolute dshx:top-8 dshx:bottom-0 dshx:w-px dshx:bg-info" style={{ left: `${pct(now, domain)}%` }}>
              <span className="dshx:absolute dshx:-top-[3px] dshx:-left-[2.5px] dshx:size-1.5 dshx:rounded-full dshx:bg-info" />
            </span>
          ) : null}
        </div>
        <div
          aria-hidden
          className="dshx:relative dshx:flex dshx:h-8 dshx:items-center dshx:border-b dshx:border-border dshx:text-2xs dshx:font-medium dshx:tracking-wider dshx:text-muted-foreground dshx:uppercase"
        >
          <span className="dshx:w-[220px] dshx:shrink-0 dshx:border-r dshx:border-border dshx:px-4 dshx:leading-8 dshx:@max-pane-compact:w-[184px] dshx:@max-pane-narrow:w-[46%]">
            {labels.span}
          </span>
          <span className="dshx:relative dshx:mr-4 dshx:h-full dshx:min-w-0 dshx:flex-1 dshx:@max-pane-narrow:mr-3 dshx:normal-case dshx:tracking-normal">
            {isZoomed ? <ZoomAxisLabels ticks={ticks} domain={domain} /> : <TimeAxisLabels ticks={ticks} domain={domain} />}
          </span>
        </div>
        <div ref={treeRef} role="tree" aria-label={labels.tree} className="dshx:flex dshx:flex-col dshx:py-1" onKeyDown={onKeyDown}>
          {shownRows.map(({ item: row, leaving }) => {
            const span = row.node
            const end = endOf(span)
            const clippedStart = zoom === undefined ? span.start : Math.max(origin, span.start) - origin
            const clippedEnd = zoom === undefined ? end : Math.min(zoom.end, end) - origin
            // Keep a zero-duration point if it is inside the window, but never turn an open or inverted span into a bar.
            const inWindow =
              hasTiming(span) &&
              (span.end !== undefined || live) &&
              (zoom === undefined || (span.start < zoom.end && (end > origin || (span.start === end && end === origin))))
            const left = pct(clippedStart, domain)
            const running = span.end === undefined && live
            const failed = span.error !== undefined
            const cost = costOf(span)
            const selected = selectedId === span.id
            const isSlowest = slowest?.id === span.id
            return (
              <GrowRow
                key={span.id}
                leaving={leaving}
                onLeft={() => drop(span.id)}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-expanded={row.childCount > 0 ? !row.collapsed : undefined}
                aria-selected={onSelectSpan ? selected : undefined}
                tabIndex={span.id === activeId ? 0 : -1}
                data-span-id={span.id}
                data-status={failed ? 'error' : running ? 'running' : 'ok'}
                onClick={() => {
                  setFocusedId(span.id)
                  onSelectSpan?.(span.id)
                }}
                className={cn(
                  'dshx:relative dshx:flex dshx:h-9 dshx:items-center dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/60 dshx:focus-visible:ring-inset',
                  zoom !== undefined && 'dshx:h-auto dshx:min-h-11',
                  onSelectSpan && 'dshx:cursor-pointer dshx:hover:bg-accent/40',
                  selected && 'dshx:bg-accent/60 dshx:hover:bg-accent/60',
                )}
              >
                <div className="dshx:min-h-0 dshx:w-[220px] dshx:shrink-0 dshx:self-stretch dshx:border-r dshx:border-border dshx:pl-3 dshx:@max-pane-compact:w-[184px] dshx:@max-pane-narrow:w-[46%]">
                  <TreeLabel
                    depth={row.depth}
                    name={span.name}
                    detail={span.detail}
                    glyph={span.glyph}
                    expandable={row.childCount > 0}
                    collapsed={row.collapsed}
                    hiddenCount={row.descendantCount}
                    onToggle={() => toggle(span.id)}
                    running={running}
                    failed={failed}
                    strong={span.kind === 'agent'}
                    expandLabel={labels.expand}
                    collapseLabel={labels.collapse}
                    toggleFocusable={false}
                  />
                </div>
                <div className="dshx:relative dshx:mr-4 dshx:min-w-0 dshx:flex-1 dshx:self-stretch dshx:@max-pane-narrow:mr-3">
                  {inWindow ? (
                    <WaterfallBar
                      span={span}
                      left={left}
                      width={relativeWidth(left, pct(clippedEnd - clippedStart, domain))}
                      running={running}
                      zoomed={zoom !== undefined}
                      label={`${formatDuration(end - span.start)}${cost > 0 ? ` · ${formatCost(cost)}` : ''}`}
                      slowest={isSlowest}
                      slowestLabel={labels.slowest}
                    />
                  ) : null}
                </div>
              </GrowRow>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/** A bar inside a box that starts at `left`%: its width relative to what remains of the column. */
const relativeWidth = (left: number, width: number) => (left >= 100 ? 0 : (Math.min(width, 100 - left) / (100 - left)) * 100)

const kindTone = { agent: 'neutral', model: 'violet', tool: 'teal', span: 'neutral' } as const satisfies Record<TraceSpanKind, keyof typeof toneTint>

function WaterfallBar({
  span,
  left,
  width,
  running,
  zoomed,
  label,
  slowest,
  slowestLabel,
}: {
  readonly span: TraceSpan
  readonly left: number
  readonly width: number
  readonly running: boolean
  readonly zoomed: boolean
  readonly label: string
  readonly slowest: boolean
  readonly slowestLabel: string
}) {
  const ref = React.useRef<HTMLSpanElement>(null)
  React.useLayoutEffect(() => {
    if (ref.current == null) return
    const controls = animate(ref.current, { transform: ['scaleX(0)', 'scaleX(1)'], opacity: [0.4, 1] }, motionSafe(springs.smooth))
    return () => controls.complete()
  }, [])
  const chipRef = React.useRef<HTMLSpanElement>(null)
  React.useLayoutEffect(() => {
    if (!slowest || chipRef.current == null) return
    const controls = animate(chipRef.current, { opacity: [0, 1], transform: ['scale(0.7)', 'scale(1)'] }, motionSafe(springs.bouncy))
    return () => controls.complete()
  }, [slowest])
  const failed = span.error !== undefined
  const tone = failed ? 'destructive' : (span.tone ?? kindTone[span.kind])
  const trackClass = 'dshx:absolute dshx:inset-y-0 dshx:right-0 dshx:flex dshx:items-center dshx:gap-1.5'
  const position = { left: `${left}%` }
  const bar = (
    <span
      ref={ref}
      aria-hidden
      data-slot="trace-waterfall-bar"
      className={cn(
        'dshx:relative dshx:h-4 dshx:shrink-0 dshx:origin-left dshx:overflow-hidden dshx:rounded-md dshx:border',
        toneTint[tone],
        span.kind === 'agent' && !running && 'dshx:bg-transparent dshx:border-muted-foreground/40',
        zoomed && 'dshx:h-2.5',
      )}
      style={{ width: `max(3px, ${width}%)` }}
    >
      {running ? <span className="dshx:absolute dshx:inset-y-0 dshx:right-0 dshx:w-2/5 dshx:bg-gradient-to-r dshx:from-transparent dshx:to-card/70" /> : null}
    </span>
  )
  const annotation = (
    <div
      className={cn(
        'dshx:flex dshx:items-center dshx:gap-x-1.5',
        zoomed ? 'dshx:min-w-0 dshx:flex-wrap dshx:gap-y-0.5' : 'dshx:shrink-0 dshx:@max-pane-narrow:hidden',
      )}
    >
      <span
        className={cn(
          'dshx:text-xs dshx:tabular-nums',
          zoomed ? 'dshx:min-w-0 dshx:[overflow-wrap:anywhere]' : 'dshx:whitespace-nowrap',
          failed ? 'dshx:text-destructive' : 'dshx:text-muted-foreground',
        )}
      >
        {label}
      </span>
      {slowest ? (
        <span
          ref={chipRef}
          className="dshx:min-w-0 dshx:rounded-sm dshx:bg-warning/15 dshx:px-1 dshx:text-2xs dshx:font-semibold dshx:tracking-wider dshx:text-warning dshx:uppercase dshx:[overflow-wrap:anywhere]"
        >
          {slowestLabel}
        </span>
      ) : null}
    </div>
  )
  return zoomed ? (
    <div className="dshx:flex dshx:h-full dshx:min-w-0 dshx:flex-col dshx:justify-center dshx:gap-0.5 dshx:py-1">
      <div data-slot="trace-waterfall-clip" className="dshx:relative dshx:h-2.5 dshx:overflow-hidden">
        <div className={trackClass} style={position}>
          {bar}
        </div>
      </div>
      {annotation}
    </div>
  ) : (
    <div className={trackClass} style={position}>
      {bar}
      {annotation}
    </div>
  )
}
