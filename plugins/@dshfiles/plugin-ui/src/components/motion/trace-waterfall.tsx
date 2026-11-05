import * as React from 'react'
import { animate, motionSafe, springs } from '../../motion/index.js'
import { cn } from '../../lib/utils.js'
import { SparklesIcon } from '../../icons.js'
import {
  GrowRow,
  useLeavingRows,
  StatStrip,
  TimeAxisLabels,
  TimeGrid,
  TraceStatusBadge,
  TreeLabel,
  fitDomain,
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
  type TraceTreeNode,
} from './trace-kit.js'

export type TraceSpanKind = 'agent' | 'model' | 'tool'

export interface TraceSpan extends TraceTreeNode {
  readonly name: string
  /** Model or tool target, muted after the name. */
  readonly detail?: string | undefined
  readonly kind: TraceSpanKind
  readonly glyph?: TraceGlyph | undefined
  /** Seconds from the trace start. */
  readonly start: number
  /** Seconds from the trace start; missing while the span runs. */
  readonly end?: number | undefined
  readonly cost?: number | undefined
  readonly tokens?: number | undefined
  /** Set when the span failed. */
  readonly error?: string | undefined
}

export interface TraceWaterfallProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title' | 'onSelect'> {
  /** What the run was asked to do. */
  readonly subtitle?: string
  readonly spans: readonly TraceSpan[]
  /** Spans may still arrive; open spans grow with the clock. */
  readonly live: boolean
  /** Epoch ms of the trace start; the live clock counts from it. */
  readonly startedAt?: number | undefined
  readonly selectedId?: string | null | undefined
  readonly onSelectSpan?: ((id: string) => void) | undefined
  readonly defaultCollapsed?: readonly string[]
}

/**
 * Where an agent run's time goes: a span tree on the left and a waterfall on the right. Spans rise in as they arrive,
 * open bars grow under a live cursor, the axis springs wider as the run outlasts it, totals roll, and the slowest leaf
 * gets a chip. Parents collapse to a `+N` chip. Data comes in through props.
 */
export function TraceWaterfall({ subtitle, spans, live, startedAt, selectedId, onSelectSpan, defaultCollapsed, className, ...props }: TraceWaterfallProps) {
  const settled = spans.reduce((max, span) => Math.max(max, span.end ?? span.start), 0)
  const now = Math.max(useTraceClock(live, startedAt, settled), settled)
  const [collapsed, toggle] = useCollapsedSet(defaultCollapsed)
  const visibleRows = flattenTree(spans, collapsed)
  // Rows hidden by a collapse fold away instead of vanishing, so the rows below slide up.
  const { rows: shownRows, drop } = useLeavingRows(visibleRows, row => row.node.id)

  const step = niceStep(now * 1.2, 4)
  const domain = useSpringNumber(Math.max(Math.ceil(fitDomain(now, 1.2) / step) * step, 2), springs.gentle)
  const ticks = ticksFor(domain, 4)

  const endOf = (span: TraceSpan) => span.end ?? now
  const leaves = spans.filter(span => span.kind !== 'agent' && span.end !== undefined)
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

  return (
    <section
      aria-label={subtitle ? `Trace: ${subtitle}` : 'Trace'}
      className={cn(
        'dshx-root dshx:@container dshx:flex dshx:flex-col dshx:overflow-hidden dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card dshx:text-card-foreground',
        className,
      )}
      {...props}
    >
      <header className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:border-b dshx:border-border dshx:px-4 dshx:py-3">
        <SparklesIcon aria-hidden className="dshx:size-4 dshx:shrink-0 dshx:text-info" />
        <h3 className="dshx:shrink-0 dshx:text-sm dshx:font-medium">Trace</h3>
        {subtitle ? (
          <p className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm dshx:text-muted-foreground">{subtitle}</p>
        ) : (
          <span className="dshx:flex-1" />
        )}
        <TraceStatusBadge state={live ? 'live' : totals.errors > 0 ? 'failed' : 'done'} />
      </header>

      <StatStrip
        className="dshx:border-b dshx:border-border dshx:px-4 dshx:py-1"
        stats={[
          { label: 'Duration', value: now, format: formatDuration, plain: true },
          { label: 'Cost', value: totals.cost, format: formatCost },
          { label: 'Tokens', value: totals.tokens, format: formatTokens },
          { label: 'LLM calls', value: totals.llm },
          { label: 'Tool calls', value: totals.tools },
          { label: 'Errors', value: totals.errors, tone: totals.errors > 0 ? 'destructive' : undefined },
        ]}
      />

      <div role="table" aria-label="Spans" className="dshx:relative dshx:min-w-0">
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
          role="row"
          className="dshx:relative dshx:flex dshx:h-8 dshx:items-center dshx:border-b dshx:border-border dshx:text-[10px] dshx:font-medium dshx:tracking-wider dshx:text-muted-foreground dshx:uppercase"
        >
          <span
            role="columnheader"
            className="dshx:w-[220px] dshx:shrink-0 dshx:border-r dshx:border-border dshx:px-4 dshx:leading-8 dshx:@max-pane-compact:w-[184px] dshx:@max-pane-narrow:w-[46%]"
          >
            Span
          </span>
          <span
            role="columnheader"
            className="dshx:relative dshx:mr-4 dshx:h-full dshx:min-w-0 dshx:flex-1 dshx:@max-pane-narrow:mr-3 dshx:normal-case dshx:tracking-normal"
          >
            <span className="dshx:sr-only">Timeline</span>
            <TimeAxisLabels ticks={ticks} domain={domain} />
          </span>
        </div>
        <div role="rowgroup" className="dshx:flex dshx:flex-col dshx:py-1">
          {shownRows.map(({ item: row, leaving }) => {
            const span = row.node
            const end = endOf(span)
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
                role="row"
                aria-selected={onSelectSpan ? selected : undefined}
                onClick={onSelectSpan ? () => onSelectSpan(span.id) : undefined}
                className={cn(
                  'dshx:relative dshx:flex dshx:h-9 dshx:items-center',
                  onSelectSpan && 'dshx:cursor-pointer dshx:hover:bg-accent/40',
                  selected && 'dshx:bg-accent/60 dshx:hover:bg-accent/60',
                )}
              >
                <div
                  role="cell"
                  className="dshx:h-full dshx:w-[220px] dshx:shrink-0 dshx:border-r dshx:border-border dshx:pl-3 dshx:@max-pane-compact:w-[184px] dshx:@max-pane-narrow:w-[46%]"
                >
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
                  />
                </div>
                <div role="cell" className="dshx:relative dshx:mr-4 dshx:h-full dshx:min-w-0 dshx:flex-1 dshx:@max-pane-narrow:mr-3">
                  <WaterfallBar
                    span={span}
                    left={pct(span.start, domain)}
                    width={relativeWidth(pct(span.start, domain), pct(end - span.start, domain))}
                    running={running}
                    label={`${formatDuration(end - span.start)}${cost > 0 ? ` · ${formatCost(cost)}` : ''}`}
                    slowest={isSlowest}
                  />
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

const kindTone = { agent: 'neutral', model: 'violet', tool: 'teal' } as const satisfies Record<TraceSpanKind, keyof typeof toneTint>

function WaterfallBar({
  span,
  left,
  width,
  running,
  label,
  slowest,
}: {
  readonly span: TraceSpan
  readonly left: number
  readonly width: number
  readonly running: boolean
  readonly label: string
  readonly slowest: boolean
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
  const tone = failed ? 'destructive' : kindTone[span.kind]
  return (
    <div className="dshx:absolute dshx:inset-y-0 dshx:flex dshx:items-center dshx:gap-1.5" style={{ left: `${left}%`, right: 0 }}>
      <span
        ref={ref}
        aria-hidden
        className={cn(
          'dshx:relative dshx:h-4 dshx:shrink-0 dshx:origin-left dshx:overflow-hidden dshx:rounded-[5px] dshx:border',
          toneTint[tone],
          span.kind === 'agent' && !running && 'dshx:bg-transparent dshx:border-muted-foreground/40',
        )}
        style={{ width: `max(3px, ${width}%)` }}
      >
        {running ? <span className="dshx:absolute dshx:inset-y-0 dshx:right-0 dshx:w-2/5 dshx:bg-gradient-to-r dshx:from-transparent dshx:to-card/70" /> : null}
      </span>
      <span
        className={cn(
          'dshx:shrink-0 dshx:text-xs dshx:whitespace-nowrap dshx:tabular-nums dshx:@max-pane-narrow:hidden',
          failed ? 'dshx:text-destructive' : 'dshx:text-muted-foreground',
        )}
      >
        {label}
      </span>
      {slowest ? (
        <span
          ref={chipRef}
          className="dshx:shrink-0 dshx:rounded-sm dshx:bg-warning/15 dshx:px-1 dshx:text-[10px] dshx:font-semibold dshx:tracking-wider dshx:text-warning dshx:uppercase dshx:@max-pane-narrow:hidden"
        >
          Slowest
        </span>
      ) : null}
    </div>
  )
}
