import * as React from 'react'
import { animate, drawStroke, easings, everyFrame, motionSafe, presets, springs } from '../../motion/index.js'
import { usePrefersReducedMotion } from '../../motion/react.js'
import { cn } from '../../lib/utils.js'
import { ClockIcon, MessageSquareTextIcon, WaypointsIcon } from '../../icons.js'
import { Badge } from '../ui/badge.js'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip.js'
import { RollingNumber, ShimmerText } from './text.js'
import { SpanGlyph, formatCost, type TraceGlyph } from './trace-kit.js'

/** `next` is the waiting attempt that runs if the current one fails; `skipped` was never needed. */
export type FallbackAttemptStatus = 'waiting' | 'next' | 'trying' | 'failed' | 'answered' | 'skipped'

export interface FallbackAttempt {
  readonly id: string
  readonly model: string
  readonly provider: string
  readonly glyph?: TraceGlyph | undefined
  /** Replaces the glyph tile, e.g. a brand mark. */
  readonly mark?: React.ReactNode
  readonly status: FallbackAttemptStatus
  /** Replaces the status text and badge label, e.g. "Serving now". */
  readonly statusLabel?: string | undefined
  /** Replaces the provider text beside the model: account badges, effort, quota. */
  readonly meta?: React.ReactNode
  /** Controls at the end of the card, e.g. a remove button. */
  readonly actions?: React.ReactNode
  /** Accessible name of the card; defaults to position, model, provider and status. */
  readonly label?: string | undefined
  /** Why it failed: "Rate limited · 429", "Timed out". */
  readonly reason?: string | undefined
  /** Epoch ms the attempt started; the card ticks from it while trying. */
  readonly startedAt?: number | undefined
  /** Final duration once it settled. */
  readonly elapsedMs?: number | undefined
  /** Budget before the router gives up on it; the meter fills toward it. Without it the card has no meter. */
  readonly timeoutMs?: number | undefined
  readonly cost?: number | undefined
  readonly tokens?: number | undefined
  /** "$1.25 / $10 per 1M" */
  readonly price?: string | undefined
  readonly region?: string | undefined
}

export interface FallbackChainProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  readonly heading: string
  /** The route the request asked for, e.g. `auto` or `router/default`. */
  readonly route: string
  readonly attempts: readonly FallbackAttempt[]
  /** Epoch ms the request started; the header clock counts from it. */
  readonly startedAt?: number | undefined
  /** Epoch ms the request settled; stops the header clock. */
  readonly endedAt?: number | undefined
  /** Replaces the header's attempt status, e.g. for a configured chain that is not running. */
  readonly summary?: React.ReactNode
  /** Controls at the end of the header. */
  readonly actions?: React.ReactNode
  /** `compact` drops the Request and Response nodes and tightens the cards, for pickers and popovers. */
  readonly density?: 'comfortable' | 'compact'
  /** Makes the cards draggable and Alt+Arrow movable; called with the moved card's index and its new index. */
  readonly onReorder?: ((from: number, to: number) => void) | undefined
  readonly reorderDisabled?: boolean
}

const SQUARES = 28

const formatMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`)

/** Wall-clock now while `active`, refreshed every frame (four times a second under reduced motion). */
function useNow(active: boolean): number {
  const reduced = usePrefersReducedMotion()
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!active) {
      setNow(Date.now())
      return
    }
    let bucket = -1
    return everyFrame(elapsed => {
      if (reduced) {
        const next = Math.floor(elapsed * 4)
        if (next === bucket) return
        bucket = next
      }
      setNow(Date.now())
    })
  }, [active, reduced])
  return now
}

interface Geometry {
  readonly width: number
  readonly height: number
  readonly left: readonly string[]
  readonly right: readonly string[]
}

const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const mx = (x1 + x2) / 2
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
}

/**
 * Which model answered a request: the router's ordered fallbacks as cards between a Request and a Response node.
 * The live attempt glows and fills its timeout meter, failures turn red with their reason, the next one says "Up
 * next", and the winning path draws through to a Response that pops in. Hover or focus a card for its provider,
 * time, cost and price.
 */
export function FallbackChain({
  heading,
  route,
  attempts,
  startedAt,
  endedAt,
  summary,
  actions,
  density = 'comfortable',
  onReorder,
  reorderDisabled = false,
  className,
  ...props
}: FallbackChainProps) {
  const compact = density === 'compact'
  const trying = attempts.findIndex(attempt => attempt.status === 'trying')
  const answered = attempts.find(attempt => attempt.status === 'answered')
  const settled = answered !== undefined || attempts.every(attempt => attempt.status === 'failed' || attempt.status === 'skipped')
  const now = useNow(!settled && trying >= 0)
  const elapsedOf = (attempt: FallbackAttempt) =>
    attempt.status === 'trying' && attempt.startedAt !== undefined ? Math.max(0, now - attempt.startedAt) : (attempt.elapsedMs ?? 0)
  const total = startedAt === undefined ? 0 : Math.max(0, (endedAt ?? (settled ? startedAt : now)) - startedAt)
  const cost = attempts.reduce((sum, attempt) => sum + (attempt.cost ?? 0), 0)
  const priced = attempts.some(attempt => attempt.cost !== undefined)
  const [dragging, setDragging] = React.useState<number | null>(null)
  const [dragOver, setDragOver] = React.useState<number | null>(null)
  const reorder = onReorder === undefined || reorderDisabled ? undefined : onReorder

  const canvasRef = React.useRef<HTMLDivElement>(null)
  const requestRef = React.useRef<HTMLDivElement>(null)
  const responseRef = React.useRef<HTMLDivElement>(null)
  const cardRefs = React.useRef(new Map<string, HTMLElement>())
  const [geometry, setGeometry] = React.useState<Geometry | null>(null)
  const ids = attempts.map(attempt => attempt.id).join('|')

  const measure = React.useCallback(() => {
    const canvas = canvasRef.current
    const request = requestRef.current
    const response = responseRef.current
    if (canvas == null || request == null || response == null) {
      setGeometry(null)
      return
    }
    const origin = canvas.getBoundingClientRect()
    const req = request.getBoundingClientRect()
    const res = response.getBoundingClientRect()
    if (req.width === 0) {
      setGeometry(null)
      return
    }
    const left: string[] = []
    const right: string[] = []
    for (const id of ids.split('|')) {
      const card = cardRefs.current.get(id)?.getBoundingClientRect()
      if (card === undefined) continue
      const cy = card.top + card.height / 2 - origin.top
      left.push(curve(req.right - origin.left, req.top + req.height / 2 - origin.top, card.left - origin.left, cy))
      right.push(curve(card.right - origin.left, cy, res.left - origin.left, res.top + res.height / 2 - origin.top))
    }
    setGeometry(previous => {
      const next = { width: origin.width, height: origin.height, left, right }
      return previous &&
        previous.width === next.width &&
        previous.height === next.height &&
        previous.left.join() === next.left.join() &&
        previous.right.join() === next.right.join()
        ? previous
        : next
    })
  }, [ids])

  React.useLayoutEffect(() => {
    measure()
    const canvas = canvasRef.current
    if (canvas == null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure())
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [measure])

  const headerState = answered ? 'answered' : settled ? 'failed' : 'running'

  return (
    <section
      aria-label={heading}
      className={cn('dshx-root dshx:@container dshx:flex dshx:flex-col', compact ? 'dshx:gap-1.5' : 'dshx:gap-3', className)}
      {...props}
    >
      <header className={cn('dshx:flex dshx:min-w-0 dshx:items-center', compact ? 'dshx:gap-1.5 dshx:text-[11px]' : 'dshx:gap-3 dshx:text-sm')}>
        <h3 className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:font-medium">{heading}</h3>
        {summary !== undefined ? (
          <span className="dshx:flex dshx:min-w-0 dshx:shrink dshx:items-center dshx:gap-1.5 dshx:text-muted-foreground">{summary}</span>
        ) : (
          <span className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1.5" aria-live="polite">
            <span
              aria-hidden
              className={cn(
                'dshx:size-1.5 dshx:rounded-full',
                headerState === 'answered' ? 'dshx:bg-success' : headerState === 'failed' ? 'dshx:bg-destructive' : 'dshx:bg-info',
              )}
            />
            {headerState === 'answered' ? (
              <span className="dshx:text-success">Answered</span>
            ) : headerState === 'failed' ? (
              <span className="dshx:text-destructive">All attempts failed</span>
            ) : (
              <span className="dshx:text-muted-foreground">
                Attempt <span className="dshx:font-medium dshx:text-foreground dshx:tabular-nums">{Math.max(trying, 0) + 1}</span> of {attempts.length}
              </span>
            )}
          </span>
        )}
        {startedAt === undefined ? null : (
          <>
            <span aria-hidden className="dshx:h-4 dshx:w-px dshx:bg-border dshx:@max-pane-narrow:hidden" />
            <span className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:tabular-nums dshx:@max-pane-narrow:hidden">
              <ClockIcon aria-hidden className="dshx:size-3.5 dshx:text-muted-foreground" />
              {formatMs(total)}
            </span>
          </>
        )}
        {priced ? (
          <>
            <span aria-hidden className="dshx:h-4 dshx:w-px dshx:bg-border" />
            <RollingNumber value={cost} format={formatCost} className="dshx:shrink-0" />
          </>
        ) : null}
        {actions}
      </header>

      <div
        ref={canvasRef}
        className={cn(
          'dshx:relative dshx:grid dshx:items-center dshx:overflow-hidden',
          compact
            ? 'dshx:grid-cols-1'
            : 'dshx:grid-cols-[auto_minmax(0,1fr)_auto] dshx:gap-x-12 dshx:rounded-xl dshx:border dshx:border-border dshx:bg-muted/30 dshx:p-4 dshx:@max-pane-compact:gap-x-7 dshx:@max-pane-narrow:grid-cols-1 dshx:@max-pane-narrow:p-3',
        )}
      >
        {compact ? null : (
          <div
            aria-hidden
            className="dshx:pointer-events-none dshx:absolute dshx:inset-0 dshx:text-border"
            style={{ backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)', backgroundSize: '14px 14px' }}
          />
        )}
        {geometry ? (
          <svg
            aria-hidden
            className="dshx:pointer-events-none dshx:absolute dshx:inset-0 dshx:@max-pane-narrow:hidden"
            width={geometry.width}
            height={geometry.height}
            fill="none"
          >
            {attempts.map((attempt, index) => {
              const left = geometry.left[index]
              const right = geometry.right[index]
              return (
                <React.Fragment key={attempt.id}>
                  {left ? <FlowPath key={`l-${attempt.id}-${leftKind(attempt.status)}`} d={left} kind={leftKind(attempt.status)} /> : null}
                  {right ? (
                    <FlowPath
                      key={`r-${attempt.id}-${attempt.status === 'answered' ? 'win' : 'idle'}`}
                      d={right}
                      kind={attempt.status === 'answered' ? 'win' : 'idle'}
                    />
                  ) : null}
                </React.Fragment>
              )
            })}
          </svg>
        ) : null}

        {compact ? null : (
          <div
            ref={requestRef}
            className="dshx:relative dshx:flex dshx:w-[140px] dshx:min-w-0 dshx:items-center dshx:gap-2.5 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card dshx:p-2.5 dshx:shadow-xs dshx:@max-pane-compact:w-[112px] dshx:@max-pane-narrow:hidden"
          >
            <span
              aria-hidden
              className="dshx:inline-flex dshx:size-7 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-md dshx:bg-info/12 dshx:text-info"
            >
              <WaypointsIcon className="dshx:size-4" />
            </span>
            <span className="dshx:flex dshx:min-w-0 dshx:flex-col">
              <span className="dshx:text-sm dshx:font-medium">Request</span>
              <span className="dshx:truncate dshx:font-mono dshx:text-[11px] dshx:text-muted-foreground">{route}</span>
            </span>
          </div>
        )}

        {attempts.length === 0 ? null : (
          <TooltipProvider delayDuration={150}>
            <ol aria-label="Fallback order" className={cn('dshx:relative dshx:flex dshx:min-w-0 dshx:flex-col', compact ? 'dshx:gap-1' : 'dshx:gap-2')}>
              {attempts.map((attempt, index) => (
                <AttemptCard
                  key={attempt.id}
                  ref={element => {
                    if (element) cardRefs.current.set(attempt.id, element)
                    else cardRefs.current.delete(attempt.id)
                  }}
                  attempt={attempt}
                  index={index}
                  elapsed={elapsedOf(attempt)}
                  compact={compact}
                  reorder={
                    reorder === undefined
                      ? undefined
                      : {
                          dragging: dragging === index,
                          over: dragOver === index && dragging !== index,
                          onDragStart: () => setDragging(index),
                          onDragOver: () => setDragOver(index),
                          onDragEnd: () => {
                            setDragging(null)
                            setDragOver(null)
                          },
                          onDrop: () => {
                            if (dragging !== null && dragging !== index) reorder(dragging, index)
                            setDragging(null)
                            setDragOver(null)
                          },
                          onMove: delta => {
                            const target = index + delta
                            if (target >= 0 && target < attempts.length) reorder(index, target)
                          },
                        }
                  }
                />
              ))}
            </ol>
          </TooltipProvider>
        )}

        {compact ? null : <ResponseNode ref={responseRef} answered={answered} failed={headerState === 'failed'} />}
      </div>
    </section>
  )
}

type PathKind = 'idle' | 'live' | 'failed' | 'win'

const pathKindByStatus = {
  trying: 'live',
  next: 'idle',
  waiting: 'idle',
  skipped: 'idle',
  failed: 'failed',
  answered: 'win',
} as const satisfies Record<FallbackAttemptStatus, PathKind>

const leftKind = (status: FallbackAttemptStatus): PathKind => pathKindByStatus[status]

function FlowPath({ d, kind }: { readonly d: string; readonly kind: PathKind }) {
  const ref = React.useRef<SVGPathElement>(null)
  React.useLayoutEffect(() => {
    const path = ref.current
    if (path == null || (kind !== 'live' && kind !== 'win')) return
    const controls = drawStroke(path, { duration: 0.6 })
    void controls.finished.then(() => {
      path.style.strokeDasharray = ''
      path.style.strokeDashoffset = ''
    })
    return () => controls.complete()
  }, [kind])
  return (
    <path
      ref={ref}
      d={d}
      strokeLinecap="round"
      strokeWidth={kind === 'idle' ? 1 : 1.75}
      strokeDasharray={kind === 'idle' || kind === 'failed' ? '3 4' : undefined}
      className={cn(
        kind === 'idle' && 'dshx:stroke-muted-foreground/40',
        kind === 'live' && 'dshx:stroke-info',
        kind === 'failed' && 'dshx:stroke-destructive/60',
        kind === 'win' && 'dshx:stroke-success',
      )}
    />
  )
}

const badgeVariant = {
  trying: 'info',
  next: 'muted',
  waiting: 'muted',
  skipped: 'muted',
  failed: 'outline',
  answered: 'success',
} as const satisfies Record<FallbackAttemptStatus, string>

const badgeLabel = {
  trying: 'Trying',
  next: 'Queued',
  waiting: 'Queued',
  skipped: 'Skipped',
  failed: 'Failed',
  answered: 'Answered',
} as const satisfies Record<FallbackAttemptStatus, string>

interface CardReorder {
  readonly dragging: boolean
  readonly over: boolean
  readonly onDragStart: () => void
  readonly onDragOver: () => void
  readonly onDragEnd: () => void
  readonly onDrop: () => void
  readonly onMove: (delta: -1 | 1) => void
}

const AttemptCard = React.forwardRef<
  HTMLLIElement,
  {
    readonly attempt: FallbackAttempt
    readonly index: number
    readonly elapsed: number
    readonly compact: boolean
    readonly reorder: CardReorder | undefined
  }
>(function AttemptCard({ attempt, index, elapsed, compact, reorder }, ref) {
  const cardRef = React.useRef<HTMLLIElement | null>(null)
  const statusRef = React.useRef<HTMLSpanElement>(null)
  const { status } = attempt
  React.useLayoutEffect(() => {
    if (statusRef.current == null) return
    const controls = animate(statusRef.current, presets.dropIn, motionSafe(springs.snappy))
    return () => controls.complete()
  }, [status])
  React.useLayoutEffect(() => {
    if (cardRef.current == null || (status !== 'answered' && status !== 'trying')) return
    const controls = animate(cardRef.current, { transform: ['scale(1)', 'scale(1.025)', 'scale(1)'] }, motionSafe({ duration: 0.45, ease: easings.out }))
    return () => controls.complete()
  }, [status])
  const timeoutMs = attempt.timeoutMs
  const filled =
    timeoutMs === undefined || status === 'waiting' || status === 'next' || status === 'skipped'
      ? 0
      : Math.min(SQUARES, Math.round((elapsed / timeoutMs) * SQUARES))
  const showTime = timeoutMs !== undefined && (status === 'trying' || status === 'failed' || status === 'answered')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <li
          ref={element => {
            cardRef.current = element
            if (typeof ref === 'function') ref(element)
            else if (ref) ref.current = element
          }}
          tabIndex={0}
          aria-label={attempt.label ?? `${index + 1}. ${attempt.model} on ${attempt.provider}: ${statusText(attempt)}`}
          draggable={reorder === undefined ? undefined : true}
          onDragStart={reorder?.onDragStart}
          onDragEnter={reorder?.onDragOver}
          onDragOver={
            reorder === undefined
              ? undefined
              : event => {
                  event.preventDefault()
                  reorder.onDragOver()
                }
          }
          onDragEnd={reorder?.onDragEnd}
          onDrop={
            reorder === undefined
              ? undefined
              : event => {
                  event.preventDefault()
                  reorder.onDrop()
                }
          }
          onKeyDown={
            reorder === undefined
              ? undefined
              : event => {
                  if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
                  event.preventDefault()
                  reorder.onMove(event.key === 'ArrowUp' ? -1 : 1)
                }
          }
          className={cn(
            'dshx:relative dshx:flex dshx:min-w-0 dshx:items-center dshx:rounded-lg dshx:border dshx:bg-card dshx:shadow-xs dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50 dshx:motion-safe:transition-[border-color,box-shadow,opacity] dshx:motion-safe:duration-300',
            compact ? 'dshx:gap-2 dshx:px-2 dshx:py-1.5' : 'dshx:gap-3 dshx:px-3 dshx:py-2.5',
            reorder !== undefined && 'dshx:cursor-grab',
            status === 'trying' && 'dshx:border-info/60 dshx:ring-[3px] dshx:ring-info/15',
            status === 'answered' && 'dshx:border-success/60 dshx:ring-[3px] dshx:ring-success/15',
            status !== 'trying' && status !== 'answered' && 'dshx:border-border',
            status === 'skipped' && 'dshx:opacity-50',
            status === 'waiting' && 'dshx:opacity-80',
            reorder?.dragging && 'dshx:opacity-40',
            reorder?.over && 'dshx:bg-info/10 dshx:ring-1 dshx:ring-info/60',
          )}
        >
          <span className="dshx:relative dshx:shrink-0">
            {attempt.mark ?? <SpanGlyph glyph={attempt.glyph ?? { letter: attempt.model }} size={compact ? 'sm' : 'md'} />}
            <span
              aria-hidden
              className={cn(
                'dshx:absolute dshx:-right-1.5 dshx:-bottom-1.5 dshx:inline-flex dshx:size-4 dshx:items-center dshx:justify-center dshx:rounded-full dshx:text-[10px] dshx:font-semibold dshx:ring-2 dshx:ring-card dshx:tabular-nums',
                status === 'trying' && 'dshx:bg-info dshx:text-background',
                status === 'failed' && 'dshx:bg-destructive dshx:text-background',
                status === 'answered' && 'dshx:bg-success dshx:text-background',
                (status === 'waiting' || status === 'next' || status === 'skipped') && 'dshx:bg-muted dshx:text-muted-foreground',
              )}
            >
              {index + 1}
            </span>
          </span>
          <span className={cn('dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col', compact ? 'dshx:gap-0.5' : 'dshx:gap-1')}>
            <span className={cn('dshx:flex dshx:min-w-0 dshx:items-baseline', compact ? 'dshx:gap-1 dshx:text-[11px]' : 'dshx:gap-2 dshx:text-sm')}>
              <span className={cn('dshx:font-medium', attempt.meta === undefined ? 'dshx:shrink-0' : 'dshx:min-w-0 dshx:truncate')}>{attempt.model}</span>
              {attempt.meta === undefined ? (
                <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-compact:hidden">
                  {attempt.provider}
                </span>
              ) : (
                <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:justify-end dshx:gap-1">{attempt.meta}</span>
              )}
              {timeoutMs === undefined ? null : (
                <span className="dshx:ml-auto dshx:shrink-0 dshx:text-sm dshx:tabular-nums">
                  {showTime ? formatMs(elapsed) : <span className="dshx:text-muted-foreground">–</span>}
                </span>
              )}
            </span>
            <span className={cn('dshx:flex dshx:min-w-0 dshx:items-baseline dshx:gap-2', compact ? 'dshx:text-[10px]' : 'dshx:text-sm')}>
              <span ref={statusRef} className={cn('dshx:min-w-0 dshx:flex-1 dshx:truncate', statusTone(status))}>
                {status === 'trying' && attempt.statusLabel === undefined ? <ShimmerText className="dshx:text-info">Trying…</ShimmerText> : statusText(attempt)}
              </span>
              {showTime ? (
                <span className="dshx:shrink-0 dshx:text-sm dshx:text-muted-foreground dshx:tabular-nums">{formatCost(attempt.cost ?? 0)}</span>
              ) : null}
            </span>
            {timeoutMs === undefined ? null : (
              <span aria-hidden className="dshx:flex dshx:gap-[3px] dshx:overflow-hidden dshx:pt-0.5">
                {Array.from({ length: SQUARES }, (_, square) => (
                  <span
                    key={square}
                    className={cn(
                      'dshx:size-[5px] dshx:shrink-0 dshx:rounded-[1px]',
                      square >= filled && 'dshx:bg-muted-foreground/15',
                      square < filled && status === 'trying' && 'dshx:bg-info',
                      square < filled && status === 'failed' && 'dshx:bg-destructive/70',
                      square < filled && status === 'answered' && 'dshx:bg-success',
                    )}
                  />
                ))}
              </span>
            )}
          </span>
          {attempt.actions}
        </li>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="dshx:w-64 dshx:border dshx:border-border dshx:bg-popover dshx:p-3 dshx:text-popover-foreground dshx:shadow-lg dshx:[&>span]:hidden"
      >
        <div className="dshx:flex dshx:flex-col dshx:gap-2.5">
          <div className="dshx:flex dshx:items-center dshx:gap-2">
            <SpanGlyph glyph={attempt.glyph ?? { letter: attempt.provider }} />
            <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
              <span className="dshx:truncate dshx:text-sm dshx:font-medium">{attempt.provider}</span>
              {attempt.region ? <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">{attempt.region}</span> : null}
            </span>
            <Badge variant={badgeVariant[status]} className={status === 'failed' ? 'dshx:text-destructive' : undefined}>
              {attempt.statusLabel ?? badgeLabel[status]}
            </Badge>
          </div>
          <dl className="dshx:grid dshx:grid-cols-[auto_1fr] dshx:gap-x-4 dshx:gap-y-1 dshx:text-xs">
            <dt className="dshx:text-muted-foreground">Model</dt>
            <dd className="dshx:text-right">{attempt.model}</dd>
            {timeoutMs === undefined ? null : (
              <>
                <dt className="dshx:text-muted-foreground">Time</dt>
                <dd className="dshx:text-right dshx:tabular-nums">
                  {formatMs(elapsed)} of {formatMs(timeoutMs)}
                </dd>
              </>
            )}
            {attempt.cost === undefined && timeoutMs === undefined ? null : (
              <>
                <dt className="dshx:text-muted-foreground">Cost</dt>
                <dd className="dshx:text-right dshx:tabular-nums">{formatCost(attempt.cost ?? 0)}</dd>
              </>
            )}
            {attempt.price ? (
              <>
                <dt className="dshx:text-muted-foreground">Price</dt>
                <dd className="dshx:text-right dshx:tabular-nums">{attempt.price}</dd>
              </>
            ) : null}
          </dl>
        </div>
      </TooltipContent>
    </Tooltip>
  )
})

const statusText = (attempt: FallbackAttempt): string => {
  if (attempt.statusLabel !== undefined) return attempt.statusLabel
  switch (attempt.status) {
    case 'trying':
      return 'Trying…'
    case 'next':
      return 'Up next'
    case 'waiting':
      return 'Waiting'
    case 'skipped':
      return 'Not needed'
    case 'failed':
      return attempt.reason ?? 'Failed'
    case 'answered':
      return attempt.tokens === undefined ? 'Answered' : `Answered · ${attempt.tokens.toLocaleString()} tokens`
  }
}

const statusToneByStatus = {
  trying: 'dshx:text-info',
  next: 'dshx:text-muted-foreground',
  waiting: 'dshx:text-muted-foreground',
  skipped: 'dshx:text-muted-foreground',
  failed: 'dshx:text-destructive',
  answered: 'dshx:text-success',
} as const satisfies Record<FallbackAttemptStatus, string>

const statusTone = (status: FallbackAttemptStatus): string => statusToneByStatus[status]

const ResponseNode = React.forwardRef<HTMLDivElement, { readonly answered: FallbackAttempt | undefined; readonly failed: boolean }>(function ResponseNode(
  { answered, failed },
  ref,
) {
  const innerRef = React.useRef<HTMLDivElement | null>(null)
  const won = answered !== undefined
  React.useLayoutEffect(() => {
    if (!won || innerRef.current == null) return
    const controls = animate(innerRef.current, { transform: ['scale(0.92)', 'scale(1)'], opacity: [0.6, 1] }, motionSafe(springs.bouncy))
    return () => controls.complete()
  }, [won])
  return (
    <div
      ref={element => {
        innerRef.current = element
        if (typeof ref === 'function') ref(element)
        else if (ref) ref.current = element
      }}
      aria-live="polite"
      className={cn(
        'dshx:relative dshx:flex dshx:w-[140px] dshx:min-w-0 dshx:items-center dshx:gap-2.5 dshx:rounded-lg dshx:border dshx:p-2.5 dshx:@max-pane-compact:w-[112px] dshx:@max-pane-narrow:hidden dshx:motion-safe:transition-colors dshx:motion-safe:duration-300',
        won ? 'dshx:border-success/50 dshx:bg-card dshx:shadow-md' : failed ? 'dshx:border-destructive/40 dshx:bg-card' : 'dshx:border-border dshx:bg-card/60',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'dshx:inline-flex dshx:size-7 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-md',
          won ? 'dshx:bg-success/15 dshx:text-success' : failed ? 'dshx:bg-destructive/10 dshx:text-destructive' : 'dshx:bg-muted dshx:text-muted-foreground',
        )}
      >
        <MessageSquareTextIcon className="dshx:size-4" />
      </span>
      <span className="dshx:flex dshx:min-w-0 dshx:flex-col">
        <span className={cn('dshx:text-sm dshx:font-medium', won ? 'dshx:text-foreground' : 'dshx:text-muted-foreground')}>Response</span>
        <span className={cn('dshx:truncate dshx:text-xs', won ? 'dshx:text-success' : failed ? 'dshx:text-destructive' : 'dshx:text-muted-foreground')}>
          {won ? (answered.tokens === undefined ? answered.model : `${answered.tokens.toLocaleString()} tokens`) : failed ? 'No response' : 'Waiting…'}
        </span>
      </span>
    </div>
  )
})
