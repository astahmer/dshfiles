import * as React from 'react'
import { animate, motionSafe, springs } from '../../motion/index.js'
import { cn } from '../../lib/utils.js'
import { SparklesIcon, TriangleAlertIcon } from '../../icons.js'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group.js'
import { RollingNumber } from './text.js'
import {
  GrowRow,
  useLeavingRows,
  TraceStatusBadge,
  TreeLabel,
  flattenTree,
  formatCost,
  formatDuration,
  formatTokens,
  niceStep,
  useCollapsedSet,
  useSpringNumber,
  useTraceClock,
  type TraceGlyph,
  type TraceTreeNode,
} from './trace-kit.js'

export interface CostStep extends TraceTreeNode {
  readonly name: string
  /** Model or tool target, muted after the name. */
  readonly detail?: string | undefined
  readonly glyph?: TraceGlyph | undefined
  /** Seconds from the run start. */
  readonly start: number
  /** Missing while the step runs. */
  readonly end?: number | undefined
  readonly inputTokens?: number | undefined
  readonly outputTokens?: number | undefined
  /** USD; groups without one sum their children. */
  readonly cost?: number | undefined
  readonly error?: string | undefined
  readonly input?: string | undefined
  readonly output?: string | undefined
}

export type CostMetric = 'cost' | 'tokens'

export interface CostWaterfallProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  readonly subtitle?: string
  readonly steps: readonly CostStep[]
  readonly live: boolean
  /** Epoch ms of the run start, for the ticking time of open steps. */
  readonly startedAt?: number | undefined
  readonly defaultMetric?: CostMetric
  readonly onMetricChange?: ((metric: CostMetric) => void) | undefined
  readonly defaultCollapsed?: readonly string[]
}

interface Totals {
  readonly cost: number
  readonly input: number
  readonly output: number
}

/**
 * What each step of an agent run costs, as a waterfall: every step's bar starts where the previous one's spend ended,
 * so the widest bar is where the money went. Switch between cost and tokens, collapse subagents, open a failed step for
 * its error, input and output. Bars spring to new values, totals roll, the most expensive step gets a TOP chip.
 */
export function CostWaterfall({
  subtitle,
  steps,
  live,
  startedAt,
  defaultMetric = 'cost',
  onMetricChange,
  defaultCollapsed,
  className,
  ...props
}: CostWaterfallProps) {
  const settled = steps.reduce((max, step) => Math.max(max, step.end ?? step.start), 0)
  const now = useTraceClock(live, startedAt, settled)
  const [metric, setMetric] = React.useState<CostMetric>(defaultMetric)
  const [collapsed, toggle] = useCollapsedSet(defaultCollapsed)
  const [openId, setOpenId] = React.useState<string | null>(null)

  const children = new Map<string | undefined, CostStep[]>()
  for (const step of steps) {
    const list = children.get(step.parentId) ?? []
    list.push(step)
    children.set(step.parentId, list)
  }
  const totalsOf = (step: CostStep): Totals => {
    const kids = children.get(step.id) ?? []
    if (kids.length === 0 || step.cost !== undefined) return { cost: step.cost ?? 0, input: step.inputTokens ?? 0, output: step.outputTokens ?? 0 }
    return kids.reduce<Totals>(
      (acc, kid) => {
        const t = totalsOf(kid)
        return { cost: acc.cost + t.cost, input: acc.input + t.input, output: acc.output + t.output }
      },
      { cost: 0, input: 0, output: 0 },
    )
  }
  const valueOf = (step: CostStep) => {
    const t = totalsOf(step)
    return metric === 'cost' ? t.cost : t.input + t.output
  }
  // Waterfall offsets: siblings accumulate; children start at their parent's offset.
  const offsets = new Map<string, number>()
  const assign = (parent: string | undefined, start: number) => {
    let cursor = start
    for (const step of children.get(parent) ?? []) {
      offsets.set(step.id, cursor)
      assign(step.id, cursor)
      cursor += valueOf(step)
    }
  }
  assign(undefined, 0)

  const roots = children.get(undefined) ?? []
  const grand = roots.reduce<Totals>(
    (acc, step) => {
      const t = totalsOf(step)
      return { cost: acc.cost + t.cost, input: acc.input + t.input, output: acc.output + t.output }
    },
    { cost: 0, input: 0, output: 0 },
  )
  const leaves = steps.filter(step => (children.get(step.id) ?? []).length === 0 && (step.cost ?? 0) > 0)
  const top = leaves.length > 0 ? leaves.reduce((a, b) => ((b.cost ?? 0) > (a.cost ?? 0) ? b : a)) : undefined
  const total = metric === 'cost' ? grand.cost : grand.input + grand.output

  const step = niceStep(Math.max(total, metric === 'cost' ? 0.05 : 1000) * 1.1, 2)
  const domain = useSpringNumber(Math.max(Math.ceil((Math.max(total, 1e-6) * 1.08) / step) * step, step), springs.gentle)
  const ticks: number[] = []
  for (let tick = 0; tick <= domain + 1e-9; tick += step) ticks.push(tick)
  const formatValue = metric === 'cost' ? formatCost : formatTokens
  const failed = steps.some(item => item.error !== undefined)

  // Rows hidden by a collapse fold away instead of vanishing, so the rows below slide up.
  const { rows, drop } = useLeavingRows(flattenTree(steps, collapsed), row => row.node.id)
  const items: React.ReactNode[] = []
  for (const { item: row, leaving } of rows) {
    const item = row.node
    const t = totalsOf(item)
    const running = item.end === undefined && live
    const isOpen = openId === item.id
    const hasDetails = item.error !== undefined || item.input !== undefined
    const offset = offsets.get(item.id) ?? 0
    items.push(
      <GrowRow
        key={item.id}
        leaving={leaving}
        onLeft={() => drop(item.id)}
        role="row"
        aria-expanded={hasDetails ? isOpen : undefined}
        tabIndex={hasDetails ? 0 : undefined}
        onClick={hasDetails ? () => setOpenId(isOpen ? null : item.id) : undefined}
        onKeyDown={
          hasDetails
            ? event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setOpenId(isOpen ? null : item.id)
                }
              }
            : undefined
        }
        className={cn(
          'dshx:flex dshx:h-9 dshx:items-center dshx:text-sm dshx:outline-none dshx:focus-visible:bg-accent/50',
          hasDetails && 'dshx:cursor-pointer dshx:hover:bg-accent/40',
          isOpen && 'dshx:bg-accent/50',
        )}
      >
        <div
          role="cell"
          className="dshx:h-full dshx:w-[220px] dshx:shrink-0 dshx:border-r dshx:border-border dshx:pl-3 dshx:@max-pane-compact:w-[184px] dshx:@max-pane-narrow:w-[46%]"
        >
          <TreeLabel
            depth={row.depth}
            name={item.name}
            detail={item.detail}
            glyph={item.glyph}
            expandable={row.childCount > 0}
            collapsed={row.collapsed}
            hiddenCount={row.descendantCount}
            onToggle={() => toggle(item.id)}
            running={running}
            failed={item.error !== undefined}
            strong={row.childCount > 0}
            badge={top?.id === item.id ? <TopChip /> : null}
          />
        </div>
        <div role="cell" className="dshx:relative dshx:h-full dshx:min-w-0 dshx:flex-1 dshx:overflow-hidden">
          <CostBar
            offset={offset}
            value={valueOf(item)}
            domain={domain}
            empty={t.cost === 0 && t.input + t.output === 0}
            failed={item.error !== undefined}
            running={running}
          />
        </div>
        <div
          role="cell"
          className="dshx:w-14 dshx:shrink-0 dshx:pr-2 dshx:text-right dshx:text-muted-foreground dshx:tabular-nums dshx:@max-pane-compact:hidden"
        >
          {t.input > 0 ? formatTokens(t.input) : '–'}
        </div>
        <div
          role="cell"
          className="dshx:w-14 dshx:shrink-0 dshx:pr-2 dshx:text-right dshx:text-muted-foreground dshx:tabular-nums dshx:@max-pane-compact:hidden"
        >
          {t.output > 0 ? formatTokens(t.output) : '–'}
        </div>
        <div role="cell" className="dshx:w-16 dshx:shrink-0 dshx:pr-2 dshx:text-right dshx:@max-pane-narrow:pr-3 dshx:font-medium dshx:tabular-nums">
          {t.cost > 0 ? <RollingNumber value={t.cost} format={formatCost} /> : '–'}
        </div>
        <div
          role="cell"
          className={cn(
            'dshx:w-16 dshx:shrink-0 dshx:pr-4 dshx:text-right dshx:tabular-nums dshx:@max-pane-narrow:hidden',
            item.error !== undefined ? 'dshx:text-destructive' : 'dshx:text-muted-foreground',
          )}
        >
          {formatDuration((item.end ?? now) - item.start)}
        </div>
      </GrowRow>,
    )
    if (isOpen && hasDetails && !leaving) {
      items.push(
        <GrowRow
          key={`${item.id}:details`}
          role="row"
          className="dshx:flex dshx:flex-col dshx:gap-2 dshx:bg-accent/30 dshx:px-4 dshx:pt-1 dshx:pb-3 dshx:@max-pane-narrow:px-3"
        >
          {item.error ? (
            <p
              role="alert"
              className="dshx:flex dshx:items-start dshx:gap-2 dshx:rounded-md dshx:bg-destructive/12 dshx:px-3 dshx:py-2 dshx:text-sm dshx:text-destructive"
            >
              <TriangleAlertIcon aria-hidden className="dshx:mt-0.5 dshx:size-3.5 dshx:shrink-0" />
              <span className="dshx:min-w-0">{item.error}</span>
            </p>
          ) : null}
          <div className="dshx:grid dshx:grid-cols-2 dshx:gap-2 dshx:@max-pane-narrow:grid-cols-1">
            <DetailBox label="Input" value={item.input} />
            <DetailBox label="Output" value={item.output} />
          </div>
        </GrowRow>,
      )
    }
  }

  return (
    <section
      aria-label={subtitle ? `Run cost: ${subtitle}` : 'Run cost'}
      className={cn(
        'dshx-root dshx:@container dshx:flex dshx:flex-col dshx:overflow-hidden dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card dshx:text-card-foreground',
        className,
      )}
      {...props}
    >
      <header className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-x-2 dshx:gap-y-2 dshx:border-b dshx:border-border dshx:px-4 dshx:py-2.5 dshx:@max-pane-narrow:px-3">
        <SparklesIcon aria-hidden className="dshx:size-4 dshx:shrink-0 dshx:text-info" />
        <h3 className="dshx:shrink-0 dshx:text-sm dshx:font-medium">Run cost</h3>
        {subtitle ? (
          <p className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">{subtitle}</p>
        ) : null}
        <span aria-hidden className={cn('dshx:flex-1', subtitle ? 'dshx:hidden dshx:@max-pane-narrow:block' : undefined)} />
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label="Measure"
          value={metric}
          onValueChange={value => {
            if (value !== 'cost' && value !== 'tokens') return
            setMetric(value)
            onMetricChange?.(value)
          }}
        >
          <ToggleGroupItem value="cost" className="dshx:text-xs">
            Cost
          </ToggleGroupItem>
          <ToggleGroupItem value="tokens" className="dshx:text-xs">
            Tokens
          </ToggleGroupItem>
        </ToggleGroup>
        <TraceStatusBadge state={live ? 'live' : failed ? 'failed' : 'done'} />
      </header>

      <dl className="dshx:grid dshx:grid-cols-3 dshx:divide-x dshx:divide-border dshx:border-b dshx:border-border dshx:px-4 dshx:py-2.5 dshx:@max-pane-narrow:grid-cols-2 dshx:@max-pane-narrow:px-3">
        <Summary label="Total cost">
          <RollingNumber value={grand.cost} format={formatCost} />
        </Summary>
        <Summary label="Total tokens" hint={`${formatTokens(grand.input)} in · ${formatTokens(grand.output)} out`}>
          <RollingNumber value={grand.input + grand.output} format={formatTokens} />
        </Summary>
        <Summary label="Most expensive" hint={top ? formatCost(top.cost ?? 0) : undefined} className="dshx:@max-pane-narrow:hidden">
          <MostExpensive name={top?.name ?? '–'} />
        </Summary>
      </dl>

      <div role="table" aria-label="Steps" className="dshx:relative dshx:min-w-0">
        <div
          role="row"
          className="dshx:flex dshx:h-8 dshx:items-center dshx:border-b dshx:border-border dshx:text-[10px] dshx:font-medium dshx:tracking-wider dshx:text-muted-foreground dshx:uppercase"
        >
          <span
            role="columnheader"
            className="dshx:w-[220px] dshx:shrink-0 dshx:border-r dshx:border-border dshx:px-4 dshx:leading-8 dshx:@max-pane-compact:w-[184px] dshx:@max-pane-narrow:w-[46%]"
          >
            Step
          </span>
          <span role="columnheader" className="dshx:relative dshx:h-full dshx:min-w-0 dshx:flex-1 dshx:overflow-hidden dshx:normal-case dshx:tracking-normal">
            <span className="dshx:sr-only">{metric === 'cost' ? 'Cost waterfall' : 'Token waterfall'}</span>
            {ticks.map(tick => {
              const left = (tick / domain) * 100
              return left > 90 ? null : (
                <span
                  key={tick}
                  aria-hidden
                  className="dshx:absolute dshx:inset-y-0 dshx:flex dshx:items-center dshx:border-l dshx:border-border dshx:pl-1.5 dshx:text-xs dshx:whitespace-nowrap dshx:text-muted-foreground dshx:tabular-nums dshx:@max-pane-narrow:hidden"
                  style={{ left: `${left}%` }}
                >
                  {formatValue(tick)}
                </span>
              )
            })}
          </span>
          <span role="columnheader" className="dshx:w-14 dshx:shrink-0 dshx:pr-2 dshx:text-right dshx:@max-pane-compact:hidden">
            In
          </span>
          <span role="columnheader" className="dshx:w-14 dshx:shrink-0 dshx:pr-2 dshx:text-right dshx:@max-pane-compact:hidden">
            Out
          </span>
          <span role="columnheader" className="dshx:w-16 dshx:shrink-0 dshx:pr-2 dshx:text-right dshx:@max-pane-narrow:pr-3">
            Cost
          </span>
          <span role="columnheader" className="dshx:w-16 dshx:shrink-0 dshx:pr-4 dshx:text-right dshx:@max-pane-narrow:hidden">
            Time
          </span>
        </div>
        <div role="rowgroup" className="dshx:flex dshx:flex-col dshx:py-1">
          {items}
        </div>
      </div>
    </section>
  )
}

function Summary({
  label,
  hint,
  className,
  children,
}: {
  readonly label: string
  readonly hint?: string | undefined
  readonly className?: string
  readonly children: React.ReactNode
}) {
  return (
    <div className={cn('dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5 dshx:px-3 dshx:first:pl-0', className)}>
      <dt className="dshx:truncate dshx:text-[10px] dshx:font-medium dshx:tracking-wider dshx:text-muted-foreground dshx:uppercase">{label}</dt>
      <dd className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-baseline dshx:gap-x-1.5 dshx:text-base dshx:font-medium dshx:tabular-nums">
        {children}
        {hint ? (
          <span className="dshx:min-w-0 dshx:truncate dshx:text-xs dshx:font-normal dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">{hint}</span>
        ) : null}
      </dd>
    </div>
  )
}

function MostExpensive({ name }: { readonly name: string }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  React.useLayoutEffect(() => {
    if (ref.current == null) return
    const controls = animate(
      ref.current,
      { opacity: [0, 1], transform: ['translateY(-6px)', 'translateY(0px)'], filter: ['blur(4px)', 'blur(0px)'] },
      motionSafe(springs.smooth),
    )
    return () => controls.complete()
  }, [name])
  return (
    <span ref={ref} className="dshx:min-w-0 dshx:truncate">
      {name}
    </span>
  )
}

function TopChip() {
  const ref = React.useRef<HTMLSpanElement>(null)
  React.useLayoutEffect(() => {
    if (ref.current == null) return
    const controls = animate(ref.current, { opacity: [0, 1], transform: ['scale(0.6)', 'scale(1)'] }, motionSafe(springs.bouncy))
    return () => controls.complete()
  }, [])
  return (
    <span
      ref={ref}
      className="dshx:shrink-0 dshx:rounded-sm dshx:bg-warning/15 dshx:px-1 dshx:text-[10px] dshx:font-semibold dshx:tracking-wider dshx:text-warning"
    >
      TOP
    </span>
  )
}

function CostBar({
  offset,
  value,
  domain,
  empty,
  failed,
  running,
}: {
  readonly offset: number
  readonly value: number
  readonly domain: number
  readonly empty: boolean
  readonly failed: boolean
  readonly running: boolean
}) {
  const left = useSpringNumber((offset / domain) * 100)
  const width = useSpringNumber((value / domain) * 100)
  if (empty)
    return (
      <span
        aria-hidden
        className={cn(
          'dshx:absolute dshx:top-1/2 dshx:h-4 dshx:w-[2px] dshx:-translate-y-1/2 dshx:rounded-full',
          failed ? 'dshx:bg-destructive' : running ? 'dshx:bg-info/50' : 'dshx:bg-teal/60',
        )}
        style={{ left: `${Math.min(99, left)}%` }}
      />
    )
  return (
    <span
      aria-hidden
      className={cn(
        'dshx:absolute dshx:top-1/2 dshx:h-4 dshx:-translate-y-1/2 dshx:rounded-[5px] dshx:border',
        failed ? 'dshx:border-destructive/45 dshx:bg-destructive/15' : 'dshx:border-violet/35 dshx:bg-violet/15',
      )}
      style={{ left: `${left}%`, width: `max(4px, ${Math.max(0, width)}%)` }}
    />
  )
}

function DetailBox({ label, value }: { readonly label: string; readonly value: string | undefined }) {
  return (
    <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1 dshx:rounded-md dshx:border dshx:border-border dshx:bg-card dshx:px-3 dshx:py-2">
      <span className="dshx:text-[10px] dshx:font-medium dshx:tracking-wider dshx:text-muted-foreground dshx:uppercase">{label}</span>
      <span className="dshx:truncate dshx:font-mono dshx:text-xs">{value ?? '–'}</span>
    </div>
  )
}
