import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useId, type CSSProperties } from 'react'
import { KIND_LABEL } from './account-labels.js'
import { ProviderGlyph } from './provider-glyph.js'
import type { CoverageCell, CoverageGroup, CoverageReport, CoverageWeek, FreeCell, WorkHours } from './quota-coverage-model.js'
import { QuotaForecastFormat as Format } from './quota-forecast-format.js'

const HOUR_MS = 3_600_000
const HATCH: CSSProperties = { backgroundImage: 'repeating-linear-gradient(135deg, currentColor 0 1.5px, transparent 1.5px 5px)' }
const SHADES = ['dshx:bg-foreground/15', 'dshx:bg-foreground/30', 'dshx:bg-foreground/45', 'dshx:bg-foreground/65'] as const
const shadeOf = (used: number): string => SHADES[Math.min(3, Math.floor(used / 25))] ?? SHADES[0]
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

type Pool = Extract<CoverageGroup, { status: 'pool' }>

export interface CoverageSelection {
  readonly kind: string
  readonly weekStart: number
}

const totalNoneFree = (week: CoverageWeek): number => week.noneFreeWorkHours + week.projectedNoneFreeWorkHours

const LaneCell = (props: { readonly cell: CoverageCell }): JSX.Element => {
  const { cell } = props
  return (
    <span
      className={cn(
        'dshx:relative dshx:h-full dshx:rounded-[2px]',
        cell.kind === 'missing' && 'dshx:border dshx:border-dashed dshx:border-border/70',
        cell.kind === 'use' && !cell.projected && shadeOf(cell.used),
        cell.kind === 'use' && cell.projected && 'dshx:border dshx:border-dashed dshx:border-muted-foreground/40',
        cell.kind === 'runs-out' && 'dshx:bg-destructive/30',
        cell.kind === 'locked' && 'dshx:bg-destructive/10 dshx:text-destructive/60',
      )}
      style={cell.kind === 'locked' ? HATCH : undefined}
    >
      {cell.kind === 'runs-out' ? (
        <span
          className={cn(
            'dshx:absolute dshx:top-1/2 dshx:left-1/2 dshx:z-10 dshx:size-2 dshx:-translate-x-1/2 dshx:-translate-y-1/2 dshx:rounded-full',
            cell.projected ? 'dshx:border dshx:border-destructive dshx:bg-background' : 'dshx:bg-destructive',
          )}
        />
      ) : null}
      {cell.reset ? <span className="dshx:absolute dshx:-inset-y-0.5 dshx:right-0 dshx:z-10 dshx:w-0.5 dshx:bg-foreground" /> : null}
    </span>
  )
}

const FreeLaneCell = (props: { readonly cell: FreeCell }): JSX.Element => {
  const { cell } = props
  if (cell.projected && (cell.kind === 'none' || cell.kind === 'none-work')) {
    return <span className="dshx:h-full dshx:rounded-[2px] dshx:border dshx:border-dashed dshx:border-destructive" />
  }
  return (
    <span
      className={cn(
        'dshx:h-full dshx:rounded-[2px]',
        cell.kind === 'missing' && 'dshx:border dshx:border-dashed dshx:border-border/70',
        cell.kind === 'all' && 'dshx:bg-foreground/10',
        cell.kind === 'some' && 'dshx:bg-foreground/35',
        cell.kind === 'none' && 'dshx:bg-destructive/40',
        cell.kind === 'none-work' && 'dshx:bg-destructive/80',
        cell.projected && cell.kind !== 'missing' && 'dshx:opacity-50',
      )}
    />
  )
}

const CellStrip = (props: { readonly children: JSX.Element[] }): JSX.Element => (
  <span className="dshx:grid dshx:h-2.5 dshx:grid-cols-[repeat(28,minmax(0,1fr))] dshx:gap-[2px]">{props.children}</span>
)

const weekSummary = (week: CoverageWeek) => {
  const total = totalNoneFree(week)
  const span = week.longestNoneFree
  if (!week.hasData) return { primary: 'No readings', secondary: '', alarm: false }
  if (total === 0 && span === null) {
    const peaks = week.lanes.map(lane => (lane.peak === null ? '–' : `${String(lane.peak)}%`)).join(', ')
    return { primary: 'Covered', secondary: `Peaks ${peaks}`, alarm: false }
  }
  const prefix = week.projectedNoneFreeWorkHours > 0 ? '~' : ''
  const secondary =
    span === null
      ? ''
      : `${week.projectedNoneFreeWorkHours > 0 ? 'On pace ' : ''}${Format.weekday(span.start)} ${Format.clock(span.start)} → ${Format.weekday(span.end)} ${Format.clock(span.end)}`
  return { primary: total === 0 ? 'Covered in work hours' : `${prefix}${String(total)} h none free`, secondary, alarm: total > 0 }
}

const WeekRow = (props: { readonly week: CoverageWeek; readonly selected: boolean; readonly onSelect: () => void }): JSX.Element => {
  const { week } = props
  const summary = weekSummary(week)
  return (
    <button
      aria-pressed={props.selected}
      className={cn(
        'dshx:grid dshx:w-full dshx:grid-cols-[6.5rem_minmax(0,1fr)_minmax(8rem,11rem)] dshx:items-center dshx:gap-3 dshx:border-b dshx:border-border/60 dshx:px-2 dshx:py-2 dshx:text-left dshx:hover:bg-muted/40 dshx:focus-visible:outline-2 dshx:focus-visible:outline-ring dshx:@max-pane-compact:grid-cols-[minmax(0,1fr)]',
        props.selected && 'dshx:bg-muted/60',
      )}
      onClick={props.onSelect}
      type="button"
    >
      <span className="dshx:flex dshx:flex-col dshx:text-sm">
        <span className={cn(props.selected && 'dshx:font-medium')}>{Format.day(week.start)}</span>
        <span className="dshx:text-xs dshx:text-muted-foreground">
          {week.current ? 'this week' : week.dataFrom === null ? '' : `from ${Format.weekday(week.dataFrom)} ${Format.clock(week.dataFrom)}`}
        </span>
      </span>
      <span className="dshx:flex dshx:flex-col dshx:gap-[3px]">
        {week.lanes.map(lane => (
          <CellStrip key={lane.instanceId}>
            {lane.cells.map(cell => (
              <LaneCell cell={cell} key={cell.start} />
            ))}
          </CellStrip>
        ))}
        <CellStrip>
          {week.free.map(cell => (
            <FreeLaneCell cell={cell} key={cell.start} />
          ))}
        </CellStrip>
      </span>
      <span className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:text-sm">
        <span className={cn('dshx:truncate', summary.alarm && 'dshx:font-medium')}>{summary.primary}</span>
        <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">{summary.secondary}</span>
      </span>
    </button>
  )
}

const LaneKey = (props: { readonly names: readonly string[] }): JSX.Element => (
  <span className="dshx:flex dshx:flex-wrap dshx:gap-x-3 dshx:text-xs dshx:text-muted-foreground">
    {[...props.names, 'Accounts free'].map((name, index) => (
      <span className="dshx:flex dshx:items-center dshx:gap-1" key={name}>
        <span aria-hidden className="dshx:flex dshx:flex-col dshx:gap-[1px]">
          {[...props.names, 'free'].map((_, row) => (
            <span className={cn('dshx:h-[2px] dshx:w-2.5', row === index ? 'dshx:bg-foreground' : 'dshx:bg-muted-foreground/40')} key={row} />
          ))}
        </span>
        {name}
      </span>
    ))}
  </span>
)

const PoolSection = (props: {
  readonly pool: Pool
  readonly selection: CoverageSelection | null
  readonly onSelect: (selection: CoverageSelection) => void
}): JSX.Element => (
  <section className="dshx:flex dshx:flex-col">
    <header className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-x-6 dshx:gap-y-1 dshx:border-b dshx:border-border/60 dshx:px-2 dshx:pb-2">
      <span className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-base dshx:font-medium">
        <ProviderGlyph className="dshx:size-5" kind={props.pool.kind} />
        {KIND_LABEL[props.pool.kind]}
      </span>
      <LaneKey names={props.pool.accounts.map(account => account.displayName)} />
    </header>
    {props.pool.weeks.map(week => (
      <WeekRow
        key={week.start}
        onSelect={() => props.onSelect({ kind: props.pool.kind, weekStart: week.start })}
        selected={props.selection?.kind === props.pool.kind && props.selection.weekStart === week.start}
        week={week}
      />
    ))}
  </section>
)

const SingleRow = (props: { readonly group: Extract<CoverageGroup, { status: 'single' }> }): JSX.Element => (
  <div className="dshx:grid dshx:grid-cols-[minmax(6.5rem,10rem)_minmax(0,1fr)_minmax(8rem,11rem)] dshx:items-center dshx:gap-3 dshx:border-b dshx:border-border/60 dshx:px-2 dshx:py-2 dshx:text-sm dshx:text-muted-foreground dshx:@max-pane-compact:grid-cols-[minmax(0,1fr)]">
    <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
      <ProviderGlyph kind={props.group.kind} />
      <span className="dshx:truncate">{props.group.displayName}</span>
    </span>
    <span className="dshx:truncate">
      One account, no cover.{' '}
      {props.group.spentEpisodes === 0 ? 'Never ran out' : `Ran out ${String(props.group.spentEpisodes)} time${props.group.spentEpisodes === 1 ? '' : 's'}`}
    </span>
    <span className="dshx:flex dshx:flex-col dshx:text-xs">
      <span>One account</span>
      <span>No cover</span>
    </span>
  </div>
)

const WeekChart = (props: { readonly week: CoverageWeek; readonly workHours: WorkHours }): JSX.Element => {
  const patternId = `cover-hatch-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const { week } = props
  const width = 560
  const height = 230
  const pad = { left: 40, right: 12, top: 26, bottom: 24 }
  const end = week.start + 168 * HOUR_MS
  const x = (at: number): number => pad.left + ((at - week.start) / (end - week.start)) * (width - pad.left - pad.right)
  const y = (used: number): number => pad.top + (1 - used / 100) * (height - pad.top - pad.bottom)
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(week.start)
    date.setDate(date.getDate() + index)
    return date.getTime()
  })
  const span = week.longestNoneFree
  return (
    <svg
      aria-label="Use per account over the week"
      className="dshx:h-auto dshx:w-full dshx:text-foreground"
      role="img"
      viewBox={`0 0 ${String(width)} ${String(height)}`}
    >
      <defs>
        <pattern height="6" id={patternId} patternTransform="rotate(45)" patternUnits="userSpaceOnUse" width="6">
          <line className="dshx:stroke-destructive" strokeWidth="2" x1="0" x2="0" y1="0" y2="6" />
        </pattern>
      </defs>
      {days.map(day => {
        const date = new Date(day)
        if (!props.workHours.days.includes(date.getDay())) return null
        const from = day + props.workHours.startHour * HOUR_MS
        const to = day + props.workHours.endHour * HOUR_MS
        return <rect className="dshx:fill-muted/60" height={y(0) - y(100)} key={day} width={x(to) - x(from)} x={x(from)} y={y(100)} />
      })}
      {[0, 50, 100].map(tick => (
        <g key={tick}>
          <line
            className="dshx:stroke-border"
            strokeDasharray={tick === 100 ? '3 4' : undefined}
            x1={pad.left}
            x2={width - pad.right}
            y1={y(tick)}
            y2={y(tick)}
          />
          <text className="dshx:fill-muted-foreground" fontSize="11" textAnchor="end" x={pad.left - 6} y={y(tick) + 4}>
            {tick}%
          </text>
        </g>
      ))}
      {span === null ? null : (
        <g>
          <rect
            fill={`url(#${patternId})`}
            height={y(0) - y(100)}
            opacity="0.6"
            width={Math.max(2, x(span.end) - x(span.start))}
            x={x(span.start)}
            y={y(100)}
          />
          <text className="dshx:fill-destructive" fontSize="12" textAnchor="middle" x={(x(span.start) + x(span.end)) / 2} y={(y(100) + y(0)) / 2}>
            No account free
          </text>
          <text className="dshx:fill-destructive" fontSize="12" textAnchor="middle" x={(x(span.start) + x(span.end)) / 2} y={(y(100) + y(0)) / 2 + 15}>
            {Format.duration(span.end - span.start)}
          </text>
        </g>
      )}
      {week.lanes.map((lane, laneIndex) => {
        const segments: string[] = []
        let pen = 'M'
        for (const hour of lane.hours) {
          if (!hour.known) {
            pen = 'M'
            continue
          }
          segments.push(`${pen}${x(hour.at + HOUR_MS / 2).toFixed(1)},${y(hour.used).toFixed(1)}`)
          pen = 'L'
        }
        const labelHour = lane.hours.find(hour => hour.known)
        return (
          <g key={lane.instanceId}>
            <path
              className={laneIndex === 0 ? 'dshx:stroke-foreground' : 'dshx:stroke-muted-foreground'}
              d={segments.join(' ')}
              fill="none"
              strokeWidth={laneIndex === 0 ? 2 : 1.5}
            />
            {labelHour === undefined ? null : (
              <text className="dshx:fill-muted-foreground" fontSize="11" x={x(labelHour.at) + 4} y={y(labelHour.used) - 6}>
                {lane.displayName}
              </text>
            )}
            {lane.firstSpentAt === null ? null : (
              <g>
                <circle className="dshx:fill-destructive" cx={x(lane.firstSpentAt + HOUR_MS / 2)} cy={y(100)} r="4.5" />
                <text className="dshx:fill-foreground" fontSize="11" textAnchor="middle" x={x(lane.firstSpentAt + HOUR_MS / 2)} y={pad.top - 10}>
                  {Format.weekday(lane.firstSpentAt)} {Format.clock(lane.firstSpentAt)}
                </text>
              </g>
            )}
          </g>
        )
      })}
      {days.map((day, index) => (
        <text className="dshx:fill-muted-foreground" fontSize="11" key={day} textAnchor="middle" x={x(day + 12 * HOUR_MS)} y={height - 6}>
          {WEEKDAYS[index]}
        </text>
      ))}
    </svg>
  )
}

const handoffStory = (week: CoverageWeek): string => {
  const order = week.lanes.filter(lane => lane.firstSpentAt !== null).sort((left, right) => (left.firstSpentAt ?? 0) - (right.firstSpentAt ?? 0))
  const first = order[0]
  if (first === undefined || first.firstSpentAt === null) return 'No account ran out this week.'
  const standIns = week.lanes.filter(lane => lane !== first)
  const last = order.at(-1)
  const span = week.longestNoneFree
  const names = standIns.map(lane => lane.displayName).join(' and ')
  if (span === null || last === undefined || last.firstSpentAt === null || order.length < week.lanes.length) {
    return `${first.displayName} ran out ${Format.weekday(first.firstSpentAt)} ${Format.clock(first.firstSpentAt)}; ${names} kept an account free.`
  }
  return `${names} took over at ${Format.weekday(first.firstSpentAt)} ${Format.clock(first.firstSpentAt)} and lasted ${Format.duration(last.firstSpentAt - first.firstSpentAt)}. Then no account was free until ${Format.weekday(span.end)} ${Format.clock(span.end)}.`
}

const WeeklyBars = (props: { readonly pool: Pool; readonly selectedWeek: number }): JSX.Element => {
  const top = Math.max(1, ...props.pool.weeks.map(week => totalNoneFree(week) + week.coveredWorkHours)) * 1.15
  return (
    <section className="dshx:flex dshx:flex-col dshx:gap-2 dshx:border-t dshx:pt-4">
      <div className="dshx:flex dshx:flex-col dshx:gap-0.5">
        <h3 className="dshx:text-sm">
          <span className="dshx:font-medium">Work hours with no {KIND_LABEL[props.pool.kind]} account</span>
          <span className="dshx:text-muted-foreground"> · per week</span>
        </h3>
        <p className="dshx:text-xs dshx:text-muted-foreground">
          Goal 0. By week: {props.pool.weeks.map(week => `${week.projectedNoneFreeWorkHours > 0 ? '~' : ''}${String(totalNoneFree(week))}`).join(', ')} h.
        </p>
      </div>
      <div className="dshx:grid dshx:h-32 dshx:grid-cols-5 dshx:items-end dshx:gap-4 dshx:border-b dshx:border-border">
        {props.pool.weeks.map(week => {
          const none = totalNoneFree(week)
          return (
            <div
              className={cn(
                'dshx:flex dshx:h-full dshx:flex-col dshx:items-center dshx:justify-end dshx:rounded-t-md',
                week.start === props.selectedWeek && 'dshx:bg-muted/50',
              )}
              key={week.start}
            >
              <span className="dshx:text-[11px] dshx:tabular-nums dshx:text-destructive">
                {week.projectedNoneFreeWorkHours > 0 ? '~' : ''}
                {String(none)}
              </span>
              <span
                className={cn(
                  'dshx:w-full dshx:max-w-9 dshx:rounded-t-[3px]',
                  week.projectedNoneFreeWorkHours > 0
                    ? 'dshx:border dshx:border-dashed dshx:border-destructive dshx:bg-destructive/20'
                    : 'dshx:bg-destructive/70',
                )}
                style={{ height: `${String((none / top) * 100)}%` }}
              />
              <span className="dshx:w-full dshx:max-w-9 dshx:bg-muted-foreground/45" style={{ height: `${String((week.coveredWorkHours / top) * 100)}%` }} />
            </div>
          )
        })}
      </div>
      <div className="dshx:grid dshx:grid-cols-5 dshx:gap-4 dshx:text-center dshx:text-xs dshx:text-muted-foreground">
        {props.pool.weeks.map(week => (
          <span className={cn(week.start === props.selectedWeek && 'dshx:font-medium dshx:text-foreground')} key={week.start}>
            {week.current ? 'This wk' : Format.day(week.start)}
          </span>
        ))}
      </div>
      <div className="dshx:flex dshx:flex-wrap dshx:gap-x-4 dshx:gap-y-1 dshx:text-xs dshx:text-muted-foreground">
        <span className="dshx:flex dshx:items-center dshx:gap-1.5">
          <span aria-hidden className="dshx:h-2.5 dshx:w-4 dshx:rounded-[2px] dshx:bg-muted-foreground/45" />
          Covered by a stand-in
        </span>
        <span className="dshx:flex dshx:items-center dshx:gap-1.5">
          <span aria-hidden className="dshx:h-2.5 dshx:w-4 dshx:rounded-[2px] dshx:bg-destructive/70" />
          None free
        </span>
        <span className="dshx:flex dshx:items-center dshx:gap-1.5">
          <span aria-hidden className="dshx:h-2.5 dshx:w-4 dshx:rounded-[2px] dshx:border dshx:border-dashed dshx:border-destructive" />
          On pace
        </span>
      </div>
    </section>
  )
}

const CoverageDetail = (props: { readonly pool: Pool; readonly week: CoverageWeek; readonly workHours: WorkHours }): JSX.Element => {
  const { pool, week } = props
  const span = week.longestNoneFree
  return (
    <aside className="dshx:flex dshx:flex-col dshx:gap-4">
      <header className="dshx:flex dshx:items-start dshx:gap-3">
        <ProviderGlyph className="dshx:mt-1 dshx:size-6" kind={pool.kind} />
        <div className="dshx:flex dshx:min-w-0 dshx:flex-col">
          <h2 className="dshx:text-base dshx:font-medium">{KIND_LABEL[pool.kind]}</h2>
          <p className="dshx:truncate dshx:text-sm dshx:text-muted-foreground">
            {pool.accounts.map(account => account.displayName).join(' and ')} · week of {Format.day(week.start)}
          </p>
        </div>
      </header>
      <p className="dshx:text-sm">{handoffStory(week)}</p>
      <WeekChart week={week} workHours={props.workHours} />
      <div className="dshx:grid dshx:grid-cols-3 dshx:gap-3">
        <div className="dshx:flex dshx:flex-col dshx:gap-1">
          <span className="dshx:text-xs dshx:text-muted-foreground">No account free</span>
          <span className="dshx:text-base dshx:font-medium dshx:tabular-nums">
            {week.projectedNoneFreeWorkHours > 0 ? '~' : ''}
            {String(totalNoneFree(week))} work h
          </span>
        </div>
        <div className="dshx:flex dshx:flex-col dshx:gap-1">
          <span className="dshx:text-xs dshx:text-muted-foreground">Stand-in covered</span>
          <span className="dshx:text-base dshx:font-medium dshx:tabular-nums">{String(week.coveredWorkHours)} work h</span>
        </div>
        <div className="dshx:flex dshx:flex-col dshx:gap-1">
          <span className="dshx:text-xs dshx:text-muted-foreground">Longest gap</span>
          <span className="dshx:text-base dshx:font-medium dshx:tabular-nums">{span === null ? '–' : Format.duration(span.end - span.start)}</span>
        </div>
      </div>
      <WeeklyBars pool={pool} selectedWeek={week.start} />
    </aside>
  )
}

const CoverageLegend = (props: { readonly workHours: WorkHours }): JSX.Element => (
  <div className="dshx:flex dshx:flex-col dshx:gap-1.5 dshx:text-xs dshx:text-muted-foreground">
    <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-x-4 dshx:gap-y-1">
      <span className="dshx:flex dshx:items-center dshx:gap-1.5">
        Use
        {SHADES.map(shade => (
          <span aria-hidden className={cn('dshx:h-2.5 dshx:w-4 dshx:rounded-[2px]', shade)} key={shade} />
        ))}
        under 25, 50, 75, 100%
      </span>
      <span className="dshx:flex dshx:items-center dshx:gap-1.5">
        <span aria-hidden className="dshx:h-2.5 dshx:w-4 dshx:rounded-[2px] dshx:bg-destructive/30" />
        Runs out
      </span>
      <span className="dshx:flex dshx:items-center dshx:gap-1.5">
        <span aria-hidden className="dshx:h-2.5 dshx:w-4 dshx:rounded-[2px] dshx:text-destructive/60" style={HATCH} />
        Locked
      </span>
      <span className="dshx:flex dshx:items-center dshx:gap-1.5">
        <span aria-hidden className="dshx:h-3 dshx:w-0.5 dshx:bg-foreground" />
        Reset
      </span>
    </div>
    <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-x-4 dshx:gap-y-1">
      Accounts free
      {(
        [
          ['dshx:bg-foreground/10', 'all'],
          ['dshx:bg-foreground/35', 'some'],
          ['dshx:bg-destructive/40', 'none'],
          ['dshx:bg-destructive/80', 'none, work hours'],
        ] as const
      ).map(([className, label]) => (
        <span className="dshx:flex dshx:items-center dshx:gap-1.5" key={label}>
          <span aria-hidden className={cn('dshx:h-2.5 dshx:w-4 dshx:rounded-[2px]', className)} />
          {label}
        </span>
      ))}
      <span className="dshx:flex dshx:items-center dshx:gap-1.5">
        <span aria-hidden className="dshx:size-2.5 dshx:rounded-full dshx:border dshx:border-destructive" />
        On pace
      </span>
      <span className="dshx:flex dshx:items-center dshx:gap-1.5">
        <span aria-hidden className="dshx:h-2.5 dshx:w-4 dshx:rounded-[2px] dshx:border dshx:border-dashed dshx:border-border" />
        No reading or not yet
      </span>
    </div>
    <span>One row per week, Monday to Sunday, 6 h cells. Work hours: {Format.workHours(props.workHours)}. Select a row for detail.</span>
  </div>
)

export class CoverageBoardView {
  static headline = (report: CoverageReport) => {
    const pools = report.groups.filter((group): group is Pool => group.status === 'pool')
    if (pools.length === 0)
      return { title: 'No provider has a stand-in account', subtitle: 'Add a second account of a kind to see when it covers for the first.' }
    const lastWeek = (pool: Pool): CoverageWeek | undefined => pool.weeks.at(-2)
    const worst = [...pools].sort((left, right) => (lastWeek(right)?.noneFreeWorkHours ?? 0) - (lastWeek(left)?.noneFreeWorkHours ?? 0))[0]
    const worstWeek = worst === undefined ? undefined : lastWeek(worst)
    const covered = pools.filter(pool => pool !== worst || (lastWeek(pool)?.noneFreeWorkHours ?? 0) === 0).map(pool => KIND_LABEL[pool.kind])
    if (worst === undefined || worstWeek === undefined || worstWeek.noneFreeWorkHours === 0) {
      return { title: 'Every provider kept an account free last week', subtitle: `${covered.join(', ')} always had a stand-in ready.` }
    }
    const order = worstWeek.lanes
      .filter(lane => lane.firstSpentAt !== null)
      .sort((left, right) => (left.firstSpentAt ?? 0) - (right.firstSpentAt ?? 0))
      .map(lane => lane.displayName)
    const span = worstWeek.longestNoneFree
    const when = span === null ? '' : `${Format.weekday(span.start, 'long')} from ${Format.clock(span.start)}, `
    const others = covered.length === 0 ? '' : ` ${covered.join(', ')} always had an account free.`
    return {
      title: `${KIND_LABEL[worst.kind]} had no account free for ${String(worstWeek.noneFreeWorkHours)} working hour${worstWeek.noneFreeWorkHours === 1 ? '' : 's'} last week`,
      subtitle: `${when}after ${order.join(' and then ')} ran out.${others}`,
    }
  }

  static Board = (props: {
    readonly report: CoverageReport
    readonly workHours: WorkHours
    readonly selection: CoverageSelection | null
    readonly onSelect: (selection: CoverageSelection) => void
  }): JSX.Element => {
    const pools = props.report.groups.filter((group): group is Pool => group.status === 'pool')
    const pool = pools.find(group => group.kind === props.selection?.kind) ?? pools[0]
    const week = pool?.weeks.find(candidate => candidate.start === props.selection?.weekStart) ?? pool?.weeks.at(-2)
    return (
      <div className="dshx:grid dshx:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)] dshx:gap-6 dshx:@max-5xl:grid-cols-1">
        <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-4">
          <div className="dshx:grid dshx:grid-cols-[6.5rem_minmax(0,1fr)_minmax(8rem,11rem)] dshx:gap-3 dshx:px-2 dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-compact:hidden">
            <span>Week of</span>
            <span className="dshx:grid dshx:grid-cols-7">
              {WEEKDAYS.map(day => (
                <span key={day}>{day}</span>
              ))}
            </span>
            <span>Work hours</span>
          </div>
          {pools.map(group => (
            <PoolSection
              key={group.kind}
              onSelect={props.onSelect}
              pool={group}
              selection={pool === undefined || week === undefined ? null : { kind: pool.kind, weekStart: week.start }}
            />
          ))}
          {props.report.groups
            .filter(group => group.status === 'single')
            .map(group => (
              <SingleRow group={group} key={group.kind} />
            ))}
          <CoverageLegend workHours={props.workHours} />
        </div>
        {pool === undefined || week === undefined ? null : (
          <div className="dshx:border-l dshx:pl-6 dshx:@max-5xl:max-w-2xl dshx:@max-5xl:border-t dshx:@max-5xl:border-l-0 dshx:@max-5xl:pt-4 dshx:@max-5xl:pl-0">
            <CoverageDetail pool={pool} week={week} workHours={props.workHours} />
          </div>
        )}
      </div>
    )
  }
}
