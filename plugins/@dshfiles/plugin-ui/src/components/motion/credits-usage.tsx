import * as React from 'react'
import { animate, drawStroke, motionSafe, springs, staggers, durations, easings } from '../../motion/index.js'
import { useEnter, type ReplayKey } from '../../motion/react.js'
import { cn } from '../../lib/utils.js'
import { Button } from '../ui/button.js'
import { Progress } from '../ui/progress.js'
import { RollingNumber } from './text.js'

export type CreditTone = 'violet' | 'info' | 'warning' | 'teal' | 'success' | 'destructive'
export type CreditChart = 'stems' | 'area' | 'bars'

export interface CreditCategory {
  readonly id: string
  readonly label: string
  readonly icon?: React.ReactNode
  readonly tone: CreditTone
  readonly total: number
  /** Unit after the total; defaults to "credits", an empty string shows none. */
  readonly unit?: string
  /** Formats the total, e.g. `75% left`; defaults to a rounded integer. */
  readonly formatTotal?: (value: number) => string
  readonly caption: string
  readonly chart: CreditChart
  /** One value per x label (a week, a sprint). Empty: the card has no chart. */
  readonly series: readonly number[]
  readonly axisLabels?: readonly string[]
  /** A tone-coloured bar under the total; `label` names the progressbar. */
  readonly meter?: { readonly percent: number; readonly label: string }
}

export interface CreditOption {
  readonly id: string
  readonly label: string
  readonly hint: string
  readonly price: string
}

interface CreditsTopUpProps {
  readonly budgetLabel: string
  readonly limit: number
  readonly options: readonly CreditOption[]
  readonly selectedOptionId: string | null
  readonly onSelectOption: (id: string) => void
  readonly confirmLabel: React.ReactNode
  readonly onConfirm?: () => void
  readonly onCancel?: () => void
}

type WithoutTopUp = { readonly [Key in keyof CreditsTopUpProps]?: undefined }

/** Without the top-up fields (`options` and the rest) it shows only the category cards, then `children`. */
export type CreditsUsageProps = Omit<React.HTMLAttributes<HTMLElement>, 'title'> & {
  readonly categories: readonly CreditCategory[]
  readonly heading?: string
  /** One or two sentences about the pace ("This week your agents used 84 credits a day…"). */
  readonly summary?: React.ReactNode
} & (CreditsTopUpProps | WithoutTopUp)

const toneText = {
  violet: 'dshx:text-violet',
  info: 'dshx:text-info',
  warning: 'dshx:text-warning',
  teal: 'dshx:text-teal',
  success: 'dshx:text-success',
  destructive: 'dshx:text-destructive',
} as const satisfies Record<CreditTone, string>
const toneBg = {
  violet: 'dshx:bg-violet',
  info: 'dshx:bg-info',
  warning: 'dshx:bg-warning',
  teal: 'dshx:bg-teal',
  success: 'dshx:bg-success',
  destructive: 'dshx:bg-destructive',
} as const satisfies Record<CreditTone, string>
const toneProgress = {
  violet: 'dshx:*:data-[slot=progress-indicator]:bg-violet',
  info: 'dshx:*:data-[slot=progress-indicator]:bg-info',
  warning: 'dshx:*:data-[slot=progress-indicator]:bg-warning',
  teal: 'dshx:*:data-[slot=progress-indicator]:bg-teal',
  success: 'dshx:*:data-[slot=progress-indicator]:bg-success',
  destructive: 'dshx:*:data-[slot=progress-indicator]:bg-destructive',
} as const satisfies Record<CreditTone, string>
const toneStem = {
  violet: 'dshx:bg-violet/35',
  info: 'dshx:bg-info/35',
  warning: 'dshx:bg-warning/35',
  teal: 'dshx:bg-teal/35',
  success: 'dshx:bg-success/35',
  destructive: 'dshx:bg-destructive/35',
} as const satisfies Record<CreditTone, string>

const formatInt = (value: number) => Math.round(value).toLocaleString('en-US')

/**
 * Usage per agent category with a mini chart each (stems, an area that draws itself, bars that grow), beside a
 * top-up panel: the month's credits split in a stacked bar whose segments sweep in, and plan options whose selection
 * ring glides between cards. Agent and subagent spend against a monthly budget.
 */
export function CreditsUsage(allProps: CreditsUsageProps) {
  const {
    categories,
    heading = 'Add credits',
    summary,
    budgetLabel,
    limit,
    options,
    selectedOptionId,
    onSelectOption,
    confirmLabel,
    onConfirm,
    onCancel,
    className,
    children,
    ...props
  } = allProps
  const used = categories.reduce((sum, category) => sum + category.total, 0)
  const cardsRef = React.useRef<HTMLDivElement>(null)
  useEnter(cardsRef, 'riseIn', { children: true, stagger: staggers.loose })

  if (options === undefined || onSelectOption === undefined || budgetLabel === undefined || limit === undefined)
    return (
      <section aria-label={heading} className={cn('dshx:@container dshx:flex dshx:w-full dshx:min-w-0 dshx:flex-col dshx:gap-2', className)} {...props}>
        <div ref={cardsRef} className="dshx:grid dshx:grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] dshx:gap-2">
          {categories.map((category, index) => (
            <CategoryCard key={category.id} category={category} delay={0.15 + index * staggers.loose} />
          ))}
        </div>
        {children}
      </section>
    )

  return (
    <section
      aria-label={heading}
      className={cn('dshx:@container dshx:w-full dshx:min-w-0 dshx:rounded-2xl dshx:border dshx:border-border dshx:bg-card dshx:p-2.5', className)}
      {...props}
    >
      <div className="dshx:grid dshx:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] dshx:gap-4 dshx:@max-pane-compact:grid-cols-1">
        <div ref={cardsRef} className="dshx:flex dshx:flex-col dshx:gap-2">
          {categories.map((category, index) => (
            <CategoryCard key={category.id} category={category} delay={0.15 + index * staggers.loose} />
          ))}
        </div>
        <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3 dshx:py-1.5 dshx:pr-1.5 dshx:@max-pane-compact:px-1.5">
          <div className="dshx:flex dshx:flex-col dshx:gap-1">
            <h3 className="dshx:text-sm dshx:font-semibold dshx:text-foreground">{heading}</h3>
            {summary ? (
              <p className="dshx:text-xs dshx:leading-relaxed dshx:text-muted-foreground dshx:[&_strong]:font-medium dshx:[&_strong]:text-foreground">
                {summary}
              </p>
            ) : null}
          </div>
          <BudgetBar categories={categories} used={used} limit={limit} label={budgetLabel} />
          <OptionCards options={options} selectedId={selectedOptionId ?? null} onSelect={onSelectOption} />
          <div className="dshx:mt-auto dshx:grid dshx:grid-cols-2 dshx:gap-2 dshx:pt-2">
            <Button variant="outline" className="dshx:h-9" onClick={onCancel}>
              Cancel
            </Button>
            <ConfirmButton onClick={onConfirm} disabled={selectedOptionId === null} replayKey={selectedOptionId ?? null}>
              {confirmLabel}
            </ConfirmButton>
          </div>
        </div>
      </div>
      {children}
    </section>
  )
}

function ConfirmButton({ children, replayKey, ...props }: React.ComponentProps<typeof Button> & { readonly replayKey: ReplayKey }) {
  const labelRef = React.useRef<HTMLSpanElement>(null)
  useEnter(labelRef, 'blurIn', { duration: durations.base, ease: easings.out }, replayKey)
  return (
    <Button className="dshx:h-9 dshx:min-w-0" {...props}>
      <span ref={labelRef} className="dshx:truncate">
        {children}
      </span>
    </Button>
  )
}

function CategoryCard({ category, delay }: { readonly category: CreditCategory; readonly delay: number }) {
  const max = niceMax(Math.max(1, ...category.series))
  const unit = category.unit ?? 'credits'
  const formatTotal = category.formatTotal ?? formatInt
  const charted = category.series.length > 0
  return (
    <article
      aria-label={`${category.label}: ${[formatTotal(category.total), unit].filter(Boolean).join(' ')}`}
      className={cn(
        'dshx:grid dshx:gap-3 dshx:rounded-xl dshx:bg-muted/60 dshx:p-3',
        charted
          ? 'dshx:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] dshx:@max-pane-narrow:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] dshx:@max-pane-narrow:gap-2'
          : 'dshx:grid-cols-1',
      )}
    >
      <div className="dshx:flex dshx:min-w-0 dshx:flex-col">
        <span className={cn('dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-xs dshx:font-medium dshx:[&_svg]:size-3.5', toneText[category.tone])}>
          {category.icon}
          <span className="dshx:min-w-0 dshx:truncate">{category.label}</span>
        </span>
        <span className="dshx:mt-auto dshx:flex dshx:items-baseline dshx:gap-1 dshx:pt-4">
          <RollingNumber value={category.total} format={formatTotal} className="dshx:text-2xl dshx:font-medium dshx:tracking-tight dshx:text-foreground" />
          {unit === '' ? null : <span className="dshx:text-xs dshx:text-muted-foreground">{unit}</span>}
        </span>
        {category.meter === undefined ? null : (
          <Progress
            aria-label={category.meter.label}
            className={cn('dshx:my-1.5 dshx:h-1.5 dshx:bg-muted', toneProgress[category.tone])}
            value={Math.max(0, Math.min(100, category.meter.percent))}
          />
        )}
        <span className="dshx:line-clamp-2 dshx:text-[11px] dshx:leading-snug dshx:text-muted-foreground">{category.caption}</span>
      </div>
      {charted ? <MiniChart category={category} max={max} delay={delay} /> : null}
    </article>
  )
}

function MiniChart({ category, max, delay }: { readonly category: CreditCategory; readonly max: number; readonly delay: number }) {
  const labels = category.axisLabels ?? category.series.map(() => '')
  return (
    <div aria-hidden className="dshx:grid dshx:grid-cols-[auto_minmax(0,1fr)] dshx:grid-rows-[minmax(0,1fr)_auto] dshx:gap-x-1.5 dshx:gap-y-1">
      <div className="dshx:flex dshx:flex-col dshx:justify-between dshx:text-right dshx:text-[9px] dshx:leading-none dshx:text-muted-foreground/70 dshx:tabular-nums">
        <span>{max}</span>
        <span>{max / 2}</span>
        <span>0</span>
      </div>
      <div className="dshx:relative dshx:h-[72px]">
        <span className="dshx:absolute dshx:inset-x-0 dshx:top-[4px] dshx:border-t dshx:border-dashed dshx:border-border" />
        <span className="dshx:absolute dshx:inset-x-0 dshx:top-1/2 dshx:border-t dshx:border-dashed dshx:border-border" />
        <span className="dshx:absolute dshx:inset-x-0 dshx:bottom-0 dshx:border-t dshx:border-border" />
        {category.chart === 'area' ? (
          <AreaPlot series={category.series} max={max} tone={category.tone} delay={delay} />
        ) : (
          <ColumnPlot series={category.series} max={max} tone={category.tone} kind={category.chart} delay={delay} />
        )}
      </div>
      <span />
      <div className="dshx:flex dshx:justify-around dshx:text-[9px] dshx:leading-none dshx:text-muted-foreground/70">
        {labels.map((label, index) => (
          <span key={index} className="dshx:w-0 dshx:flex-1 dshx:text-center">
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Bars grow up from the baseline; stems grow and their heads drop in, one column after another. */
function ColumnPlot({
  series,
  max,
  tone,
  kind,
  delay,
}: {
  readonly series: readonly number[]
  readonly max: number
  readonly tone: CreditTone
  readonly kind: 'stems' | 'bars'
  readonly delay: number
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    const root = ref.current
    if (root == null) return
    const columns = Array.from(root.querySelectorAll<HTMLElement>('[data-column]'))
    const heads = Array.from(root.querySelectorAll<HTMLElement>('[data-head]'))
    const a = animate(
      columns,
      { transform: ['scaleY(0)', 'scaleY(1)'] },
      motionSafe({ ...springs.smooth, delay: (index: number) => delay + index * staggers.base }),
    )
    const b =
      heads.length > 0
        ? animate(
            heads,
            { opacity: [0, 1], transform: ['translateY(-8px) scale(0.4)', 'translateY(0px) scale(1)'] },
            motionSafe({ ...springs.bouncy, delay: (index: number) => delay + 0.12 + index * staggers.base }),
          )
        : null
    return () => {
      a.complete()
      b?.complete()
    }
  }, [delay])
  return (
    <div ref={ref} className="dshx:absolute dshx:inset-x-0 dshx:top-[4px] dshx:bottom-0 dshx:flex dshx:items-end dshx:justify-around">
      {series.map((value, index) => (
        <div key={index} className="dshx:relative dshx:flex dshx:h-full dshx:w-0 dshx:flex-1 dshx:items-end dshx:justify-center">
          <div
            data-column
            style={{ height: `${Math.min(100, (value / max) * 100)}%` }}
            className={cn(
              'dshx:relative dshx:origin-bottom dshx:transition-[height] dshx:duration-500',
              kind === 'bars' ? cn('dshx:w-[55%] dshx:max-w-3 dshx:rounded-t-[3px]', toneBg[tone]) : cn('dshx:w-px', toneStem[tone]),
            )}
          />
          {kind === 'stems' ? (
            <span
              data-head
              style={{ bottom: `calc(${Math.min(100, (value / max) * 100)}% - 4px)` }}
              className={cn('dshx:absolute dshx:left-1/2 dshx:-ml-1 dshx:size-2 dshx:rounded-full dshx:transition-[bottom] dshx:duration-500', toneBg[tone])}
            />
          ) : null}
        </div>
      ))}
    </div>
  )
}

/** A cumulative line that draws itself, its fill fading in underneath and its points popping along. */
function AreaPlot({
  series,
  max,
  tone,
  delay,
}: {
  readonly series: readonly number[]
  readonly max: number
  readonly tone: CreditTone
  readonly delay: number
}) {
  const lineRef = React.useRef<SVGPolylineElement>(null)
  const fillRef = React.useRef<SVGPolygonElement>(null)
  const dotsRef = React.useRef<SVGGElement>(null)
  const width = 120
  const height = 72
  const step = series.length > 1 ? width / series.length : width
  const points = series.map((value, index) => [step / 2 + index * step, height - (Math.min(value, max) / max) * (height - 4)] as const)
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const first = points[0]
  const last = points[points.length - 1]
  const area = first && last ? `${first[0].toFixed(1)},${height} ${line} ${last[0].toFixed(1)},${height}` : ''
  React.useLayoutEffect(() => {
    const path = lineRef.current
    const fill = fillRef.current
    const dots = dotsRef.current
    if (path == null || fill == null || dots == null) return
    const a = drawStroke(path, { duration: durations.slower + 0.3, delay })
    const b = animate(fill, { opacity: [0, 1] }, motionSafe({ duration: durations.slower, delay: delay + 0.3 }))
    const c = animate(
      Array.from(dots.children),
      { opacity: [0, 1], transform: ['scale(0)', 'scale(1)'] },
      motionSafe({ ...springs.bouncy, delay: (index: number) => delay + index * 0.12 }),
    )
    return () => {
      a.complete()
      b.complete()
      c.complete()
    }
  }, [delay])
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn('dshx:absolute dshx:inset-x-0 dshx:top-0 dshx:bottom-0 dshx:size-full dshx:overflow-visible', toneText[tone])}
    >
      <polygon ref={fillRef} points={area} fill="currentColor" fillOpacity={0.16} />
      <polyline ref={lineRef} points={line} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <g ref={dotsRef}>
        {points.map(([x, y], index) => (
          <circle key={index} cx={x} cy={y} r={1.8} fill="currentColor" style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
        ))}
      </g>
    </svg>
  )
}

function BudgetBar({
  categories,
  used,
  limit,
  label,
}: {
  readonly categories: readonly CreditCategory[]
  readonly used: number
  readonly limit: number
  readonly label: string
}) {
  const barRef = React.useRef<HTMLDivElement>(null)
  const widths = categories.map(category => (limit > 0 ? (category.total / limit) * 100 : 0))
  const mounted = React.useRef(false)
  React.useLayoutEffect(() => {
    const bar = barRef.current
    if (bar == null) return
    const segments = Array.from(bar.querySelectorAll<HTMLElement>('[data-segment]'))
    const controls = segments.map((segment, index) =>
      animate(
        segment,
        { width: mounted.current ? `${widths[index] ?? 0}%` : ['0%', `${widths[index] ?? 0}%`] },
        motionSafe({ duration: durations.slower, ease: easings.emphasized, delay: mounted.current ? 0 : 0.2 + index * 0.12 }),
      ),
    )
    mounted.current = true
    return () => {
      for (const control of controls) control.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widths.join(',')])
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-2">
      <div className="dshx:flex dshx:items-baseline dshx:justify-between dshx:gap-2 dshx:text-xs">
        <span className="dshx:truncate dshx:text-muted-foreground">{label}</span>
        <span className="dshx:flex dshx:shrink-0 dshx:items-baseline dshx:gap-1 dshx:text-muted-foreground">
          <RollingNumber value={used} format={formatInt} className="dshx:font-medium dshx:text-foreground" />
          of {formatInt(limit)}
        </span>
      </div>
      <div
        ref={barRef}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
        className="dshx:flex dshx:h-1.5 dshx:gap-0.5 dshx:overflow-hidden dshx:rounded-full dshx:bg-muted"
      >
        {categories.map(category => (
          <span
            key={category.id}
            data-segment
            style={{ width: 0 }}
            className={cn('dshx:h-full dshx:shrink-0 dshx:first:rounded-l-full', toneBg[category.tone])}
          />
        ))}
      </div>
      <ul className="dshx:flex dshx:flex-wrap dshx:gap-x-3 dshx:gap-y-1 dshx:text-[11px] dshx:text-muted-foreground">
        {categories.map(category => (
          <li key={category.id} className="dshx:flex dshx:items-center dshx:gap-1">
            <span aria-hidden className={cn('dshx:size-1.5 dshx:rounded-full', toneBg[category.tone])} />
            {category.label}
            <RollingNumber value={category.total} format={formatInt} className="dshx:font-medium dshx:text-foreground" />
          </li>
        ))}
        <li className="dshx:flex dshx:items-center dshx:gap-1">
          <span aria-hidden className="dshx:size-1.5 dshx:rounded-full dshx:bg-muted-foreground/40" />
          Left
          <RollingNumber value={Math.max(0, limit - used)} format={formatInt} className="dshx:font-medium dshx:text-foreground" />
        </li>
      </ul>
    </div>
  )
}

/** Plan cards as a radio group; one outline glides to the chosen card and its radio dot pops. */
function OptionCards({
  options,
  selectedId,
  onSelect,
}: {
  readonly options: readonly CreditOption[]
  readonly selectedId: string | null
  readonly onSelect: (id: string) => void
}) {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const ringRef = React.useRef<HTMLSpanElement>(null)
  const cards = React.useRef(new Map<string, HTMLButtonElement>())
  const placed = React.useRef(false)

  const place = React.useCallback(
    (animated: boolean) => {
      const ring = ringRef.current
      const card = selectedId === null ? undefined : cards.current.get(selectedId)
      if (ring == null) return null
      if (card === undefined) {
        ring.style.opacity = '0'
        return null
      }
      const frame = { top: `${card.offsetTop}px`, height: `${card.offsetHeight}px`, opacity: 1 }
      if (!animated || !placed.current) {
        Object.assign(ring.style, { top: frame.top, height: frame.height, opacity: '1' })
        placed.current = true
        return null
      }
      return animate(ring, frame, motionSafe(springs.snappy))
    },
    [selectedId],
  )
  React.useLayoutEffect(() => {
    const controls = place(true)
    return () => controls?.stop()
  }, [place])
  React.useEffect(() => {
    const root = rootRef.current
    if (root == null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => place(false))
    observer.observe(root)
    return () => observer.disconnect()
  }, [place])

  const move = (delta: number) => {
    const index = options.findIndex(option => option.id === selectedId)
    const next = options[(index + delta + options.length) % options.length]
    if (next === undefined) return
    onSelect(next.id)
    cards.current.get(next.id)?.focus()
  }

  return (
    <div
      ref={rootRef}
      role="radiogroup"
      aria-label="Top-up"
      className="dshx:relative dshx:flex dshx:flex-col dshx:gap-2"
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
          event.preventDefault()
          move(1)
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
          event.preventDefault()
          move(-1)
        }
      }}
    >
      <span
        ref={ringRef}
        aria-hidden
        style={{ opacity: 0 }}
        className="dshx:pointer-events-none dshx:absolute dshx:inset-x-0 dshx:z-10 dshx:rounded-xl dshx:ring-[1.5px] dshx:ring-foreground"
      />
      {options.map((option, index) => {
        const checked = option.id === selectedId
        return (
          <button
            key={option.id}
            ref={element => {
              if (element) cards.current.set(option.id, element)
              else cards.current.delete(option.id)
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked || (selectedId === null && index === 0) ? 0 : -1}
            onClick={() => onSelect(option.id)}
            className="dshx:flex dshx:items-center dshx:gap-3 dshx:rounded-xl dshx:border dshx:border-border dshx:bg-background dshx:px-3 dshx:py-2.5 dshx:text-left dshx:outline-none dshx:transition-colors dshx:hover:bg-accent/50 dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50"
          >
            <RadioDot checked={checked} />
            <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
              <span className="dshx:truncate dshx:text-sm dshx:font-medium dshx:text-foreground">{option.label}</span>
              <span className="dshx:truncate dshx:text-[11px] dshx:text-muted-foreground">{option.hint}</span>
            </span>
            <span className="dshx:shrink-0 dshx:text-sm dshx:font-medium dshx:text-foreground dshx:tabular-nums">{option.price}</span>
          </button>
        )
      })}
    </div>
  )
}

function RadioDot({ checked }: { readonly checked: boolean }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  React.useLayoutEffect(() => {
    if (!checked || ref.current == null) return
    const controls = animate(ref.current, { transform: ['scale(0)', 'scale(1)'] }, motionSafe(springs.bouncy))
    return () => controls.complete()
  }, [checked])
  return (
    <span
      aria-hidden
      className={cn(
        'dshx:grid dshx:size-4 dshx:shrink-0 dshx:place-items-center dshx:rounded-full dshx:border dshx:transition-colors',
        checked ? 'dshx:border-foreground dshx:bg-foreground' : 'dshx:border-muted-foreground/50',
      )}
    >
      {checked ? <span ref={ref} className="dshx:size-1.5 dshx:rounded-full dshx:bg-background" /> : null}
    </span>
  )
}

/** Round the axis maximum up to 1, 2, 2.5 or 5 × 10ⁿ so labels read cleanly. */
function niceMax(value: number): number {
  const exponent = 10 ** Math.floor(Math.log10(value))
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= step * exponent) return step * exponent
  }
  return 10 * exponent
}
