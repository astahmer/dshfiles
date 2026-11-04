import * as React from 'react'
import { animate, easings, motionSafe, springs } from '../../motion/index.js'
import { usePrefersReducedMotion } from '../../motion/react.js'
import { cn } from '../../lib/utils.js'
import { RotateCwIcon, SearchIcon, WorkflowIcon, XIcon, ZoomInIcon, ZoomOutIcon } from '../../icons.js'
import { Badge } from '../ui/badge.js'
import { Button } from '../ui/button.js'
import {
  GrowRow,
  PlaybackControls,
  StatStrip,
  TimeAxisLabels,
  TimeGrid,
  TraceLegend,
  TreeLabel,
  SpanGlyph,
  fitDomain,
  flattenTree,
  formatCost,
  formatDuration,
  formatTick,
  formatTokens,
  hatchImage,
  niceStep,
  toneBorder,
  toneSoft,
  toneSolid,
  useCollapsedSet,
  usePlayback,
  useSpringNumber,
  type TraceGlyph,
  type TraceTone,
  type TraceTreeNode,
} from './trace-kit.js'

/** `agent` rows show a compound bar; `handoff` is the short outlined step where an agent starts subagents. */
export type ReplayStepKind = 'agent' | 'model' | 'tool' | 'handoff'

export interface ReplayStep extends TraceTreeNode {
  readonly name: string
  readonly detail?: string | undefined
  readonly kind: ReplayStepKind
  readonly glyph?: TraceGlyph | undefined
  /** Agent colour; children inherit their agent's tone. */
  readonly tone?: TraceTone | undefined
  /** Seconds from the run start. */
  readonly start: number
  readonly end: number
  readonly cost?: number | undefined
  readonly tokens?: number | undefined
  readonly failed?: boolean | undefined
  /** A second attempt: drawn with a retry mark. */
  readonly retry?: boolean | undefined
  /** Agents: when the parent handed off to this agent (draws the elbow). */
  readonly handoffAt?: number | undefined
  readonly input?: string | undefined
  readonly output?: string | undefined
  readonly error?: string | undefined
}

export interface TraceReplayProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  readonly heading?: string
  readonly steps: readonly ReplayStep[]
  readonly duration?: number
  readonly autoPlay?: boolean
  readonly speeds?: readonly number[]
  /** Called when a step is opened in the inspector. */
  readonly onInspect?: ((id: string | null) => void) | undefined
}

const ROW = 32

/**
 * A recorded agent run replayed as a waterfall: steps appear as the playhead reaches them, each agent row grows a
 * compound bar (model, tool, hatched waiting), handoff elbows drop into subagents, totals roll. Zoom into an agent's
 * window, search steps, and click a step to inspect its timing, cost, input and output.
 */
export function TraceReplay({ heading = 'Trace', steps, duration, autoPlay = true, speeds = [1, 1.5, 2], onInspect, className, ...props }: TraceReplayProps) {
  const length = duration ?? steps.reduce((max, step) => Math.max(max, step.end), 0)
  const playback = usePlayback(length, { autoPlay })
  const now = playback.time
  const reduced = usePrefersReducedMotion()
  const [collapsed, toggle] = useCollapsedSet()
  const [query, setQuery] = React.useState('')
  const [inspected, setInspected] = React.useState<string | null>(null)
  const [zoomId, setZoomId] = React.useState<string | null>(null)

  const byId = new Map(steps.map(step => [step.id, step]))
  const toneOf = (step: ReplayStep): TraceTone => {
    let current: ReplayStep | undefined = step
    while (current) {
      if (current.tone) return current.tone
      current = current.parentId === undefined ? undefined : byId.get(current.parentId)
    }
    return 'neutral'
  }

  // Visible: started, and matching the search (ancestors of a match stay).
  const started = steps.filter(step => step.start <= now)
  const needle = query.trim().toLowerCase()
  const keep = new Set<string>()
  for (const step of started) {
    if (needle !== '' && !`${step.name} ${step.detail ?? ''}`.toLowerCase().includes(needle)) continue
    let current: ReplayStep | undefined = step
    while (current && !keep.has(current.id)) {
      keep.add(current.id)
      current = current.parentId === undefined ? undefined : byId.get(current.parentId)
    }
  }
  const rows = flattenTree(
    started.filter(step => keep.has(step.id)),
    collapsed,
  )
  const rowIndex = new Map(rows.map((row, index) => [row.node.id, index]))

  // Window: follow the playhead, or the zoomed agent.
  const zoomed = zoomId === null ? undefined : byId.get(zoomId)
  const followStep = niceStep(Math.max(now, 1) * 1.25, 4)
  const followHi = Math.max(Math.ceil(fitDomain(Math.max(now, 1), 1.25) / followStep) * followStep, 2)
  const lo = useSpringNumber(zoomed ? zoomed.start : 0, springs.gentle)
  const hi = useSpringNumber(zoomed ? zoomed.end + (zoomed.end - zoomed.start) * 0.08 : followHi, springs.gentle)
  const span = Math.max(hi - lo, 0.1)
  const tickStep = niceStep(span, 4)
  const ticks: number[] = []
  for (let tick = Math.ceil(lo / tickStep) * tickStep; tick <= hi; tick += tickStep) ticks.push(Number((tick - lo).toFixed(6)))
  const place = (start: number, end: number) => {
    const left = Math.min(100, Math.max(0, ((start - lo) / span) * 100))
    const right = Math.min(100, Math.max(0, ((end - lo) / span) * 100))
    return { left, width: Math.max(0, right - left) }
  }

  const leaves = steps.filter(step => step.kind === 'model' || step.kind === 'tool')
  const finishedLeaves = leaves.filter(step => step.end <= now)
  const slowest = finishedLeaves.length >= 3 ? finishedLeaves.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a)) : undefined
  const totals = leaves.reduce(
    (acc, step) => {
      const done = step.end <= now
      return {
        cost: acc.cost + (done ? (step.cost ?? 0) : 0),
        tokens: acc.tokens + (done ? (step.tokens ?? 0) : 0),
        llm: acc.llm + (step.kind === 'model' && step.start <= now ? 1 : 0),
        tools: acc.tools + (step.kind === 'tool' && step.start <= now ? 1 : 0),
        errors: acc.errors + (step.failed && done ? 1 : 0),
      }
    },
    { cost: 0, tokens: 0, llm: 0, tools: 0, errors: 0 },
  )
  const subtreeCost = (id: string): number =>
    steps.filter(step => step.parentId === id).reduce((sum, child) => sum + (child.end <= now ? (child.cost ?? 0) : 0) + subtreeCost(child.id), 0)

  // Follow new rows while playing, unless the user scrolled up.
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const pinned = React.useRef(true)
  React.useEffect(() => {
    const element = scrollRef.current
    if (element == null || !playback.playing || !pinned.current) return
    element.scrollTo({ top: element.scrollHeight, behavior: reduced ? 'auto' : 'smooth' })
  }, [rows.length, playback.playing, reduced])

  const inspect = (id: string | null) => {
    setInspected(id)
    onInspect?.(id)
  }
  const inspectedStep = inspected === null ? undefined : byId.get(inspected)

  return (
    <section
      aria-label={heading}
      className={cn(
        'dshx-root dshx:@container dshx:relative dshx:flex dshx:flex-col dshx:overflow-hidden dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card dshx:text-card-foreground',
        className,
      )}
      {...props}
    >
      <header className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-3 dshx:border-b dshx:border-border dshx:px-4 dshx:py-2.5">
        <h3 className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm dshx:font-medium">{heading}</h3>
        <label className="dshx:flex dshx:h-8 dshx:w-56 dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:rounded-md dshx:border dshx:border-border dshx:bg-background dshx:px-2.5 dshx:text-muted-foreground dshx:focus-within:ring-2 dshx:focus-within:ring-ring/40 dshx:@max-pane-narrow:w-36">
          <SearchIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0" />
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search steps"
            aria-label="Search steps"
            className="dshx:h-full dshx:min-w-0 dshx:flex-1 dshx:bg-transparent dshx:text-sm dshx:text-foreground dshx:outline-none dshx:placeholder:text-muted-foreground"
          />
        </label>
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

      <div className="dshx:flex dshx:h-8 dshx:items-center dshx:border-b dshx:border-border dshx:text-xs dshx:text-muted-foreground">
        <span className="dshx:flex dshx:h-full dshx:w-[230px] dshx:shrink-0 dshx:items-center dshx:gap-1.5 dshx:border-r dshx:border-border dshx:px-4 dshx:@max-pane-compact:w-[188px] dshx:@max-pane-narrow:w-[46%] dshx:@max-pane-narrow:px-3">
          <WorkflowIcon aria-hidden className="dshx:size-3.5" />
          Steps
        </span>
        <div className="dshx:relative dshx:mr-3 dshx:h-full dshx:min-w-0 dshx:flex-1 dshx:overflow-hidden dshx:@max-pane-narrow:mr-2">
          <TimeAxisLabels ticks={ticks} domain={span} format={tick => formatTick(tick + lo)} />
          <Playhead now={now} lo={lo} span={span} header />
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={event => {
          const element = event.currentTarget
          pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < ROW * 1.5
        }}
        className="dshx:relative dshx:max-h-[352px] dshx:min-h-[96px] dshx:overflow-y-auto"
      >
        <div className="dshx:relative">
          <div
            aria-hidden
            className="dshx:pointer-events-none dshx:absolute dshx:inset-y-0 dshx:right-3 dshx:left-[230px] dshx:overflow-hidden dshx:@max-pane-compact:left-[188px] dshx:@max-pane-narrow:right-2 dshx:@max-pane-narrow:left-[46%]"
          >
            <TimeGrid ticks={ticks} domain={span} className="dshx:left-0" />
            {rows.map(row => {
              const step = row.node
              if (step.kind !== 'agent' || step.handoffAt === undefined || step.parentId === undefined || now < step.handoffAt) return null
              const from = rowIndex.get(step.parentId)
              const to = rowIndex.get(step.id)
              if (from === undefined || to === undefined) return null
              const box = place(step.handoffAt, step.start)
              return <Elbow key={step.id} tone={toneOf(step)} top={from * ROW + ROW / 2} height={(to - from) * ROW} left={box.left} width={box.width} />
            })}
            <Playhead now={now} lo={lo} span={span} />
          </div>
          <div role="list" aria-label="Steps" className="dshx:relative dshx:flex dshx:flex-col">
            {rows.map(row => {
              const step = row.node
              const tone = toneOf(step)
              const running = step.end > now
              const isAgent = step.kind === 'agent'
              const visibleEnd = Math.min(step.end, now)
              const cost = isAgent ? subtreeCost(step.id) : step.end <= now ? (step.cost ?? 0) : 0
              const label = `${formatDuration(visibleEnd - step.start)}${cost > 0 ? ` · ${formatCost(cost)}` : ''}`
              const box = place(step.start, visibleEnd)
              // The bar sits in a box that starts at `left`, so its width is relative to what remains.
              const relWidth = box.left >= 100 ? 0 : (box.width / (100 - box.left)) * 100
              const selected = inspected === step.id
              return (
                <GrowRow
                  key={step.id}
                  role="listitem"
                  className={cn(
                    'dshx:group/row dshx:relative dshx:flex dshx:h-8 dshx:items-center dshx:hover:bg-accent/40',
                    isAgent && 'dshx:bg-muted/30',
                    selected && 'dshx:bg-accent/60',
                  )}
                >
                  <div className="dshx:h-full dshx:w-[230px] dshx:shrink-0 dshx:border-r dshx:border-border dshx:pl-3 dshx:@max-pane-compact:w-[188px] dshx:@max-pane-narrow:w-[46%] dshx:@max-pane-narrow:pl-2">
                    <TreeLabel
                      depth={row.depth}
                      name={step.name}
                      detail={step.detail}
                      glyph={step.glyph ? { ...step.glyph, tone: step.glyph.tone ?? tone } : undefined}
                      expandable={row.childCount > 0}
                      collapsed={row.collapsed}
                      hiddenCount={row.descendantCount}
                      onToggle={() => toggle(step.id)}
                      running={running && !isAgent}
                      failed={step.failed === true && !running}
                      strong={isAgent}
                      badge={
                        isAgent ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={zoomId === step.id ? `Zoom out of ${step.name}` : `Zoom into ${step.name}`}
                            onClick={event => {
                              event.stopPropagation()
                              setZoomId(current => (current === step.id ? null : step.id))
                            }}
                            className="dshx:size-5 dshx:opacity-0 dshx:group-hover/row:opacity-100 dshx:focus-visible:opacity-100"
                          >
                            {zoomId === step.id ? <ZoomOutIcon /> : <ZoomInIcon />}
                          </Button>
                        ) : null
                      }
                    />
                  </div>
                  <button
                    type="button"
                    aria-label={`Inspect ${step.name}, ${label}${step.failed ? ', failed' : ''}`}
                    aria-pressed={selected}
                    onClick={() => inspect(selected ? null : step.id)}
                    className="dshx:relative dshx:mr-3 dshx:h-full dshx:min-w-0 dshx:flex-1 dshx:cursor-pointer dshx:@max-pane-narrow:mr-2 dshx:overflow-hidden dshx:text-left dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50 dshx:focus-visible:ring-inset"
                  >
                    <span className="dshx:absolute dshx:inset-y-0 dshx:flex dshx:items-center dshx:gap-1.5" style={{ left: `${box.left}%`, right: 0 }}>
                      {isAgent ? (
                        <AgentBar
                          step={step}
                          steps={steps}
                          tone={tone}
                          now={now}
                          start={Math.max(step.start, lo)}
                          visibleEnd={Math.min(visibleEnd, hi)}
                          width={relWidth}
                        />
                      ) : (
                        <LeafBar step={step} tone={tone} width={relWidth} finished={!running} />
                      )}
                      <span
                        className={cn(
                          'dshx:shrink-0 dshx:text-xs dshx:whitespace-nowrap dshx:tabular-nums dshx:@max-pane-narrow:hidden',
                          step.failed && !running ? 'dshx:text-destructive' : 'dshx:text-muted-foreground',
                        )}
                      >
                        {label}
                      </span>
                      {slowest?.id === step.id ? <SlowestChip /> : null}
                    </span>
                  </button>
                </GrowRow>
              )
            })}
          </div>
        </div>
      </div>

      <footer className="dshx:flex dshx:min-w-0 dshx:items-center dshx:justify-between dshx:gap-3 dshx:border-t dshx:border-border dshx:px-4 dshx:py-2">
        <div className="dshx:flex dshx:items-center dshx:gap-1.5">
          <PlaybackControls playback={playback} speeds={speeds} />
          {zoomed ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setZoomId(null)} aria-label="Reset zoom">
              <ZoomOutIcon />
              <span className="dshx:@max-pane-narrow:sr-only">Fit</span>
            </Button>
          ) : null}
        </div>
        <TraceLegend />
      </footer>

      {inspectedStep ? <Inspector key={inspectedStep.id} step={inspectedStep} now={now} tone={toneOf(inspectedStep)} onClose={() => inspect(null)} /> : null}
    </section>
  )
}

function Playhead({ now, lo, span, header = false }: { readonly now: number; readonly lo: number; readonly span: number; readonly header?: boolean }) {
  const left = ((now - lo) / span) * 100
  if (left < 0 || left > 100) return null
  return (
    <span
      aria-hidden
      className={cn('dshx:pointer-events-none dshx:absolute dshx:w-px dshx:bg-foreground/80', header ? 'dshx:top-1/2 dshx:bottom-0' : 'dshx:inset-y-0')}
      style={{ left: `${left}%` }}
    >
      {header ? <span className="dshx:absolute dshx:-top-1 dshx:-left-[3.5px] dshx:size-2 dshx:rounded-full dshx:bg-foreground" /> : null}
    </span>
  )
}

function useEnterBar(ref: React.RefObject<HTMLElement | null>) {
  React.useLayoutEffect(() => {
    if (ref.current == null) return
    const controls = animate(ref.current, { opacity: [0, 1], transform: ['scaleY(0.3)', 'scaleY(1)'] }, motionSafe(springs.bouncy))
    return () => controls.complete()
  }, [ref])
}

function LeafBar({ step, tone, width, finished }: { readonly step: ReplayStep; readonly tone: TraceTone; readonly width: number; readonly finished: boolean }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  useEnterBar(ref)
  const failed = step.failed === true && finished
  return (
    <span
      ref={ref}
      aria-hidden
      className={cn(
        'dshx:flex dshx:h-4 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:overflow-hidden dshx:rounded-[4px] dshx:text-card',
        step.kind === 'model' && toneSolid[tone],
        step.kind === 'tool' && toneSoft[tone],
        step.kind === 'handoff' && cn('dshx:border dshx:bg-transparent', toneBorder[tone]),
        failed && 'dshx:bg-destructive',
      )}
      style={{ width: `max(4px, ${width}%)` }}
    >
      {failed ? <XIcon className="dshx:size-3" strokeWidth={3} /> : null}
      {step.retry && finished ? <RotateCwIcon className="dshx:size-3" strokeWidth={2.5} /> : null}
    </span>
  )
}

/** An agent's own row: its direct leaf steps as blocks, and the gaps between them hatched as waiting. */
function AgentBar({
  step,
  steps,
  tone,
  now,
  start,
  visibleEnd,
  width,
}: {
  readonly width: number
  readonly step: ReplayStep
  readonly steps: readonly ReplayStep[]
  readonly tone: TraceTone
  readonly now: number
  readonly start: number
  readonly visibleEnd: number
}) {
  const ref = React.useRef<HTMLSpanElement>(null)
  useEnterBar(ref)
  const total = Math.max(visibleEnd - start, 1e-6)
  const children = steps.filter(child => child.parentId === step.id && child.kind !== 'agent' && child.start <= now).sort((a, b) => a.start - b.start)
  const pieces: { key: string; left: number; width: number; kind: 'model' | 'tool' | 'handoff' | 'failed' | 'wait'; retry: boolean }[] = []
  let cursor = start
  for (const child of children) {
    const childEnd = Math.min(child.end, now)
    if (child.start - cursor > 0.05) pieces.push({ key: `wait-${child.id}`, left: cursor, width: child.start - cursor, kind: 'wait', retry: false })
    pieces.push({
      key: child.id,
      left: child.start,
      width: childEnd - child.start,
      kind: child.failed && child.end <= now ? 'failed' : child.kind === 'agent' ? 'tool' : child.kind,
      retry: child.retry === true && child.end <= now,
    })
    cursor = Math.max(cursor, childEnd)
  }
  if (visibleEnd - cursor > 0.05) pieces.push({ key: 'wait-tail', left: cursor, width: visibleEnd - cursor, kind: 'wait', retry: false })
  return (
    <span ref={ref} aria-hidden className="dshx:relative dshx:h-4 dshx:shrink-0 dshx:overflow-hidden" style={{ width: `max(4px, ${width}%)` }}>
      {pieces.map(piece => (
        <span
          key={piece.key}
          className={cn(
            'dshx:absolute dshx:inset-y-0 dshx:flex dshx:items-center dshx:justify-center dshx:overflow-hidden dshx:rounded-[4px] dshx:text-card',
            piece.kind === 'model' && toneSolid[tone],
            piece.kind === 'tool' && toneSoft[tone],
            piece.kind === 'handoff' && cn('dshx:border dshx:bg-transparent', toneBorder[tone]),
            piece.kind === 'failed' && 'dshx:bg-destructive',
            piece.kind === 'wait' && 'dshx:border dshx:border-border dshx:text-muted-foreground/50',
          )}
          style={{
            left: `${((piece.left - start) / total) * 100}%`,
            width: `max(3px, calc(${(piece.width / total) * 100}% - 2px))`,
            backgroundImage: piece.kind === 'wait' ? hatchImage : undefined,
          }}
        >
          {piece.kind === 'failed' ? <XIcon className="dshx:size-3" strokeWidth={3} /> : null}
          {piece.retry ? <RotateCwIcon className="dshx:size-3" strokeWidth={2.5} /> : null}
        </span>
      ))}
    </span>
  )
}

function SlowestChip() {
  const ref = React.useRef<HTMLSpanElement>(null)
  React.useLayoutEffect(() => {
    if (ref.current == null) return
    const controls = animate(ref.current, { opacity: [0, 1], transform: ['scale(0.7)', 'scale(1)'] }, motionSafe(springs.bouncy))
    return () => controls.complete()
  }, [])
  return (
    <span
      ref={ref}
      className="dshx:shrink-0 dshx:rounded-full dshx:bg-warning/15 dshx:px-1.5 dshx:text-[10px] dshx:leading-4 dshx:font-medium dshx:text-warning dshx:@max-pane-narrow:hidden"
    >
      Slowest
    </span>
  )
}

function Elbow({
  tone,
  top,
  height,
  left,
  width,
}: {
  readonly tone: TraceTone
  readonly top: number
  readonly height: number
  readonly left: number
  readonly width: number
}) {
  const ref = React.useRef<HTMLSpanElement>(null)
  React.useLayoutEffect(() => {
    if (ref.current == null) return
    const controls = animate(
      ref.current,
      { clipPath: ['inset(0% calc(100% - 3px) 100% 0%)', 'inset(0% calc(100% - 3px) 0% 0%)', 'inset(0% 0% 0% 0%)'] },
      motionSafe({ duration: 0.5, ease: easings.out }),
    )
    return () => controls.complete()
  }, [])
  return (
    <span
      ref={ref}
      className={cn('dshx:absolute dshx:rounded-bl-md dshx:border-b dshx:border-l', toneBorder[tone])}
      style={{ top, height, left: `${left}%`, width: `max(6px, ${width}%)` }}
    />
  )
}

function Inspector({ step, now, tone, onClose }: { readonly step: ReplayStep; readonly now: number; readonly tone: TraceTone; readonly onClose: () => void }) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    if (ref.current == null) return
    const controls = animate(
      ref.current,
      { opacity: [0, 1], transform: ['translateY(8px) scale(0.97)', 'translateY(0px) scale(1)'] },
      motionSafe(springs.snappy),
    )
    return () => controls.complete()
  }, [])
  const running = step.end > now
  const failed = step.failed === true && !running
  const elapsed = Math.min(step.end, now) - step.start
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`${step.name} details`}
      className="dshx:absolute dshx:right-3 dshx:bottom-14 dshx:z-10 dshx:flex dshx:w-72 dshx:flex-col dshx:gap-3 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-popover dshx:p-3 dshx:text-popover-foreground dshx:shadow-lg dshx:@max-pane-narrow:left-3 dshx:@max-pane-narrow:w-auto"
    >
      <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
        <SpanGlyph glyph={step.glyph ? { ...step.glyph, tone: step.glyph.tone ?? tone } : { letter: step.name, tone }} />
        <span className="dshx:min-w-0 dshx:truncate dshx:text-sm dshx:font-medium">{step.name}</span>
        {running ? (
          <Badge variant="info">Running</Badge>
        ) : failed ? (
          <Badge variant="outline" className="dshx:border-destructive/40 dshx:text-destructive">
            Failed
          </Badge>
        ) : (
          <Badge variant="success">Done</Badge>
        )}
        <Button type="button" variant="ghost" size="icon-xs" className="dshx:ml-auto dshx:rounded-full" aria-label="Close details" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      <dl className="dshx:grid dshx:grid-cols-3 dshx:gap-2 dshx:rounded-md dshx:bg-muted/50 dshx:p-2.5">
        <div className="dshx:min-w-0">
          <dt className="dshx:text-xs dshx:text-muted-foreground">Duration</dt>
          <dd className="dshx:text-sm dshx:tabular-nums">{formatDuration(elapsed)}</dd>
        </div>
        <div className="dshx:min-w-0">
          <dt className="dshx:text-xs dshx:text-muted-foreground">Started</dt>
          <dd className="dshx:text-sm dshx:tabular-nums">+{formatDuration(step.start)}</dd>
        </div>
        <div className="dshx:min-w-0">
          <dt className="dshx:text-xs dshx:text-muted-foreground">Cost</dt>
          <dd className="dshx:text-sm dshx:tabular-nums">{running ? '–' : formatCost(step.cost ?? 0)}</dd>
        </div>
      </dl>
      {failed && step.error ? (
        <p className="dshx:rounded-md dshx:bg-destructive/10 dshx:px-2.5 dshx:py-1.5 dshx:text-xs dshx:text-destructive">{step.error}</p>
      ) : null}
      {step.input ? (
        <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5">
          <span className="dshx:text-xs dshx:text-muted-foreground">Input</span>
          <span className="dshx:truncate dshx:font-mono dshx:text-xs">{step.input}</span>
        </div>
      ) : null}
      <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5">
        <span className="dshx:text-xs dshx:text-muted-foreground">Output</span>
        <span className="dshx:truncate dshx:font-mono dshx:text-xs">{running ? '…' : (step.output ?? '–')}</span>
      </div>
    </div>
  )
}
