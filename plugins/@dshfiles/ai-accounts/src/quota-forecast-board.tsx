import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@dshfiles/plugin-ui/components/ui/table'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useId, type CSSProperties } from 'react'
import { ProviderGlyph } from './provider-glyph.js'
import { KIND_LABEL } from './account-labels.js'
import { QuotaForecastFormat as Format } from './quota-forecast-format.js'
import type { AccountForecast, ForecastBoard, ForecastCell, WindowForecast } from './quota-forecast-model.js'
import { StatusDot } from '@dshfiles/plugin-ui/components/ui/status-dot'

const HOUR_MS = 3_600_000

/** Diagonal stripes in the element's text colour, so the tint comes from a `text-*` class. */
const HATCH: CSSProperties = { backgroundImage: 'repeating-linear-gradient(135deg, currentColor 0 1.5px, transparent 1.5px 5px)' }

const SHADES = ['dshx:bg-foreground/15', 'dshx:bg-foreground/30', 'dshx:bg-foreground/45', 'dshx:bg-foreground/65'] as const
const shadeOf = (used: number): string => SHADES[Math.min(3, Math.floor(used / 25))] ?? SHADES[0]

type Forecasted = Extract<AccountForecast, { status: 'forecast' }>

const runsOutLine = (window: WindowForecast, now: number) => {
  const resets =
    window.resetsAt === null ? 'Reset not reported' : `Resets ${Format.moment(window.resetsAt, now)}${window.resetsAt - now > 7 * 24 * HOUR_MS ? ' →' : ''}`
  if (window.runsOutAt !== null && window.runsOutAt <= now) return { primary: 'Spent now', secondary: resets }
  if (window.runsOutAt !== null) return { primary: `Runs out ${Format.moment(window.runsOutAt, now)}`, secondary: resets }
  if (window.pacePerHour === null) return { primary: `${Format.percent(window.used)} used, pace unknown`, secondary: resets }
  if (window.usedAtReset !== null) return { primary: `~${Format.percent(window.usedAtReset)} at reset`, secondary: resets }
  return { primary: `${Format.percent(window.used)} used`, secondary: resets }
}

const unavailableLine = (reason: Extract<AccountForecast, { status: 'unavailable' }>['reason']): string =>
  reason === 'reconnect' ? 'Reconnect to forecast' : reason === 'unsupported' ? 'Quota not reported' : 'No quota reading yet'

const Cell = (props: { readonly cell: ForecastCell }): JSX.Element => {
  const { cell } = props
  return (
    <div
      className={cn(
        'dshx:relative dshx:h-full dshx:rounded-[3px]',
        cell.kind === 'projected' && shadeOf(cell.used),
        cell.kind === 'runs-out' && 'dshx:bg-destructive/30',
        cell.kind === 'locked' && 'dshx:bg-destructive/10 dshx:text-destructive/60',
        cell.kind === 'fresh' && 'dshx:border dshx:border-dashed dshx:border-border',
      )}
      style={cell.kind === 'locked' ? HATCH : undefined}
    >
      {cell.runsOutOffset === null ? null : (
        <span
          className="dshx:absolute dshx:top-1/2 dshx:z-10 dshx:size-2.5 dshx:-translate-x-1/2 dshx:-translate-y-1/2 dshx:rounded-full dshx:bg-destructive dshx:ring-2 dshx:ring-background"
          style={{ left: `${String(cell.runsOutOffset * 100)}%` }}
        />
      )}
      {cell.resetOffset === null ? null : (
        <span className="dshx:absolute dshx:-inset-y-1 dshx:z-10 dshx:w-0.5 dshx:bg-foreground" style={{ left: `${String(cell.resetOffset * 100)}%` }}>
          <span className="dshx:absolute dshx:top-1/2 dshx:left-1.5 dshx:-translate-y-1/2 dshx:text-[10px] dshx:text-muted-foreground">reset</span>
        </span>
      )}
    </div>
  )
}

/** A label per day, spanning the cells until the next midnight, so a partial first day never overlaps the next. */
const DayHeader = (props: { readonly cellStarts: readonly number[]; readonly now: number }): JSX.Element => {
  const starts = props.cellStarts.flatMap((start, index) => (index === 0 || new Date(start).getHours() === 0 ? [index] : []))
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-0.5 dshx:text-xs">
      <span className="dshx:text-[11px] dshx:font-medium">Now</span>
      <div className="dshx:grid dshx:grid-cols-[repeat(28,minmax(0,1fr))] dshx:text-muted-foreground">
        {starts.map((index, position) => {
          const span = (starts[position + 1] ?? props.cellStarts.length) - index
          const start = props.cellStarts[index] ?? props.now
          return (
            <span className="dshx:truncate" key={start} style={{ gridColumn: `${String(index + 1)} / span ${String(span)}` }}>
              {span < 2 ? '' : Format.weekday(index === 0 ? props.now : start)}
            </span>
          )
        })}
      </div>
    </div>
  )
}

const BoardRow = (props: {
  readonly account: AccountForecast
  readonly now: number
  readonly selected: boolean
  readonly onSelect: () => void
}): JSX.Element => {
  const { account } = props
  const line = account.status === 'forecast' ? runsOutLine(account.window, props.now) : null
  return (
    <button
      aria-pressed={props.selected}
      className={cn(
        'dshx:grid dshx:min-h-14 dshx:w-full dshx:grid-cols-[minmax(7rem,10rem)_minmax(0,1fr)_minmax(8rem,12rem)] dshx:items-center dshx:gap-3 dshx:border-b dshx:border-border/60 dshx:px-2 dshx:py-2 dshx:text-left dshx:hover:bg-muted/40 dshx:focus-visible:outline-2 dshx:focus-visible:outline-ring dshx:@max-pane-compact:grid-cols-[minmax(0,1fr)] dshx:@max-pane-compact:gap-1.5',
        props.selected && 'dshx:bg-muted/60',
        account.status === 'unavailable' && 'dshx:opacity-60',
      )}
      onClick={props.onSelect}
      type="button"
    >
      <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:text-sm">
        <ProviderGlyph kind={account.kind} />
        <span className="dshx:min-w-0 dshx:truncate">{account.displayName}</span>
      </span>
      <span className="dshx:relative dshx:grid dshx:h-8 dshx:grid-cols-[repeat(28,minmax(0,1fr))] dshx:gap-[3px]">
        <span aria-hidden className="dshx:absolute dshx:-inset-y-2 dshx:left-0 dshx:border-l dshx:border-dashed dshx:border-muted-foreground/60" />
        {account.status === 'forecast'
          ? account.cells.map(cell => <Cell cell={cell} key={cell.start} />)
          : Array.from({ length: 28 }, (_, index) => <span className="dshx:rounded-[3px] dshx:border dshx:border-dashed dshx:border-border/70" key={index} />)}
      </span>
      <span className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:text-sm">
        {line === null ? (
          <span className="dshx:truncate dshx:text-muted-foreground">{account.status === 'unavailable' ? unavailableLine(account.reason) : ''}</span>
        ) : (
          <>
            <span
              className={cn(
                'dshx:truncate dshx:font-medium',
                props.account.status === 'forecast' && props.account.window.runsOutAt !== null && 'dshx:text-foreground',
              )}
            >
              {line.primary}
            </span>
            <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">{line.secondary}</span>
          </>
        )}
      </span>
    </button>
  )
}

const LegendSwatch = (props: { readonly className?: string; readonly style?: CSSProperties }): JSX.Element => (
  <span aria-hidden className={cn('dshx:inline-block dshx:h-2.5 dshx:w-4 dshx:rounded-[2px]', props.className)} style={props.style} />
)

const BoardLegend = (): JSX.Element => (
  <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-x-4 dshx:gap-y-1.5 dshx:text-xs dshx:text-muted-foreground">
    <span className="dshx:flex dshx:items-center dshx:gap-1.5">
      Projected use
      {SHADES.map(shade => (
        <LegendSwatch className={shade} key={shade} />
      ))}
      under 25, 50, 75, 100%
    </span>
    <span className="dshx:flex dshx:items-center dshx:gap-1.5">
      <LegendSwatch className="dshx:bg-destructive/30" />
      Runs out
    </span>
    <span className="dshx:flex dshx:items-center dshx:gap-1.5">
      <LegendSwatch className="dshx:bg-destructive/10 dshx:text-destructive/60" style={HATCH} />
      Locked until reset
    </span>
    <span className="dshx:flex dshx:items-center dshx:gap-1.5">
      <span aria-hidden className="dshx:h-3 dshx:w-0.5 dshx:bg-foreground" />
      Reset
    </span>
    <span className="dshx:flex dshx:items-center dshx:gap-1.5">
      <LegendSwatch className="dshx:border dshx:border-dashed dshx:border-border" />
      New window, no forecast
    </span>
    <span>Assumes the pace holds. Select a row for detail.</span>
  </div>
)

const PaceChart = (props: { readonly window: WindowForecast; readonly now: number }): JSX.Element => {
  const patternId = `hatch-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const { window, now } = props
  const width = 560
  const height = 220
  const pad = { left: 40, right: 12, top: 24, bottom: 24 }
  const start = window.startsAt ?? window.series[0]?.at ?? now - 24 * HOUR_MS
  const end = window.resetsAt ?? Math.max(window.runsOutAt ?? 0, now + 7 * 24 * HOUR_MS)
  const x = (at: number): number => pad.left + ((Math.min(end, Math.max(start, at)) - start) / Math.max(1, end - start)) * (width - pad.left - pad.right)
  const y = (used: number): number => pad.top + (1 - used / 100) * (height - pad.top - pad.bottom)
  const line = window.series.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.at).toFixed(1)},${y(point.used).toFixed(1)}`).join(' ')
  const first = window.series[0]
  const area = first === undefined ? '' : `${line} L${x(now).toFixed(1)},${y(0).toFixed(1)} L${x(first.at).toFixed(1)},${y(0).toFixed(1)} Z`
  const paceEnd = window.runsOutAt ?? end
  const paceEndUsed = window.runsOutAt === null ? Math.min(100, window.used + (window.pacePerHour ?? 0) * ((end - now) / HOUR_MS)) : 100
  return (
    <svg
      aria-label={`${window.label} used over the window`}
      className="dshx:h-auto dshx:w-full dshx:text-foreground"
      role="img"
      viewBox={`0 0 ${String(width)} ${String(height)}`}
    >
      <defs>
        <pattern height="6" id={patternId} patternTransform="rotate(45)" patternUnits="userSpaceOnUse" width="6">
          <line className="dshx:stroke-destructive" strokeWidth="2" x1="0" x2="0" y1="0" y2="6" />
        </pattern>
      </defs>
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
      {window.runsOutAt !== null && window.resetsAt !== null ? (
        <rect
          fill={`url(#${patternId})`}
          height={y(0) - y(100)}
          opacity="0.7"
          width={Math.max(2, x(window.resetsAt) - x(window.runsOutAt))}
          x={x(window.runsOutAt)}
          y={y(100)}
        />
      ) : null}
      {area === '' ? null : <path className="dshx:fill-foreground/10" d={area} />}
      <path d={line} fill="none" stroke="currentColor" strokeWidth="2" />
      {window.startsAt !== null && window.resetsAt !== null ? (
        <line
          className="dshx:stroke-muted-foreground"
          strokeDasharray="1 4"
          strokeLinecap="round"
          strokeWidth="1.5"
          x1={x(window.startsAt)}
          x2={x(window.resetsAt)}
          y1={y(0)}
          y2={y(100)}
        />
      ) : null}
      {window.pacePerHour === null ? null : (
        <line stroke="currentColor" strokeDasharray="5 4" strokeWidth="1.5" x1={x(now)} x2={x(paceEnd)} y1={y(window.used)} y2={y(paceEndUsed)} />
      )}
      <line className="dshx:stroke-muted-foreground/60" strokeDasharray="2 3" x1={x(now)} x2={x(now)} y1={y(100)} y2={y(0)} />
      <circle cx={x(now)} cy={y(window.used)} fill="currentColor" r="3.5" />
      {window.runsOutAt === null ? null : (
        <g>
          <circle className="dshx:fill-destructive" cx={x(window.runsOutAt)} cy={y(100)} r="5" />
          <text className="dshx:fill-foreground" fontSize="12" textAnchor="end" x={x(window.runsOutAt)} y={pad.top - 8}>
            {Format.moment(window.runsOutAt, now)}
          </text>
        </g>
      )}
      <text className="dshx:fill-muted-foreground" fontSize="11" x={pad.left} y={height - 6}>
        {Format.day(start)}
      </text>
      <text className="dshx:fill-muted-foreground" fontSize="11" textAnchor="end" x={width - pad.right} y={height - 6}>
        {window.resetsAt === null ? Format.day(end) : `Reset ${Format.day(window.resetsAt)}`}
      </text>
    </svg>
  )
}

const RecentPace = (props: { readonly window: WindowForecast; readonly now: number }): JSX.Element | null => {
  const { daily, allowedPerDay } = props.window
  if (daily.every(day => day.used === 0)) return null
  const top = Math.max(allowedPerDay ?? 0, ...daily.map(day => day.used)) * 1.15 || 1
  return (
    <section className="dshx:flex dshx:flex-col dshx:gap-2 dshx:border-t dshx:pt-4">
      <div className="dshx:flex dshx:flex-col dshx:gap-0.5">
        <h3 className="dshx:text-sm">
          <span className="dshx:font-medium">Recent pace</span>
          <span className="dshx:text-muted-foreground"> · points used per day</span>
        </h3>
        {allowedPerDay === null ? null : <p className="dshx:text-xs dshx:text-muted-foreground">Allowed: {allowedPerDay.toFixed(1)} a day</p>}
      </div>
      <div className="dshx:relative dshx:grid dshx:h-32 dshx:grid-cols-7 dshx:items-end dshx:gap-3 dshx:border-b dshx:border-border">
        {allowedPerDay === null ? null : (
          <span
            aria-hidden
            className="dshx:absolute dshx:inset-x-0 dshx:border-t dshx:border-dashed dshx:border-muted-foreground"
            style={{ bottom: `${String((allowedPerDay / top) * 100)}%` }}
          />
        )}
        {daily.map(day => {
          const over = allowedPerDay !== null && day.used > allowedPerDay
          return (
            <div className="dshx:flex dshx:h-full dshx:flex-col dshx:items-center dshx:justify-end dshx:gap-1" key={day.day}>
              <span className="dshx:text-[11px] dshx:tabular-nums dshx:text-muted-foreground">{Math.round(day.used)}</span>
              <span
                className={cn('dshx:w-full dshx:max-w-8 dshx:rounded-t-[3px]', over ? 'dshx:bg-warning' : 'dshx:bg-muted-foreground/50')}
                style={{ height: `${String((day.used / top) * 100)}%` }}
              />
            </div>
          )
        })}
      </div>
      <div className="dshx:grid dshx:grid-cols-7 dshx:gap-3 dshx:text-center dshx:text-xs dshx:text-muted-foreground">
        {daily.map((day, index) => (
          <span key={day.day}>{index === daily.length - 1 ? 'Today' : Format.weekday(day.day)}</span>
        ))}
      </div>
      <div className="dshx:flex dshx:flex-wrap dshx:gap-x-4 dshx:gap-y-1 dshx:text-xs dshx:text-muted-foreground">
        <span className="dshx:flex dshx:items-center dshx:gap-1.5">
          <LegendSwatch className="dshx:bg-muted-foreground/50" />
          Within allowance
        </span>
        <span className="dshx:flex dshx:items-center dshx:gap-1.5">
          <LegendSwatch className="dshx:bg-warning" />
          Over
        </span>
        {allowedPerDay === null ? null : <span>--- Allowed per day</span>}
      </div>
    </section>
  )
}

const Stat = (props: { readonly label: string; readonly value: string }): JSX.Element => (
  <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
    <span className="dshx:text-xs dshx:text-muted-foreground">{props.label}</span>
    <span className="dshx:text-base dshx:font-medium dshx:tabular-nums">{props.value}</span>
  </div>
)

const ForecastDetail = (props: { readonly account: AccountForecast; readonly now: number }): JSX.Element => {
  const { account, now } = props
  const header = (
    <header className="dshx:flex dshx:items-start dshx:gap-3">
      <ProviderGlyph className="dshx:mt-1 dshx:size-6" kind={account.kind} />
      <div className="dshx:flex dshx:min-w-0 dshx:flex-col">
        <h2 className="dshx:truncate dshx:text-base dshx:font-medium">{account.displayName}</h2>
        <p className="dshx:truncate dshx:text-sm dshx:text-muted-foreground">
          {KIND_LABEL[account.kind]}
          {account.status === 'forecast' ? ` · ${account.window.label}` : ''}
        </p>
      </div>
    </header>
  )
  if (account.status === 'unavailable') {
    return (
      <aside className="dshx:flex dshx:flex-col dshx:gap-4">
        {header}
        <p className="dshx:text-sm dshx:text-muted-foreground">{unavailableLine(account.reason)}.</p>
      </aside>
    )
  }
  const { window } = account
  const ratio = window.pacePerHour !== null && window.evenPerHour !== null && window.evenPerHour > 0 ? window.pacePerHour / window.evenPerHour : null
  return (
    <aside className="dshx:flex dshx:flex-col dshx:gap-4">
      {header}
      <p className="dshx:text-sm">
        {window.elapsedFraction === null
          ? `Used ${Format.percent(window.used)} of the window`
          : `Used ${Format.percent(window.used)} in ${Format.percent(window.elapsedFraction * 100)} of the window`}
      </p>
      <PaceChart now={now} window={window} />
      <div className="dshx:flex dshx:flex-wrap dshx:gap-x-4 dshx:gap-y-1 dshx:text-xs dshx:text-muted-foreground">
        <span>— Used</span>
        <span>- - Current pace</span>
        <span>····· Even pace</span>
        <span className="dshx:flex dshx:items-center dshx:gap-1.5">
          <StatusDot tone="destructive" />
          Runs out
        </span>
        <span className="dshx:flex dshx:items-center dshx:gap-1.5">
          <LegendSwatch className="dshx:text-destructive/60" style={HATCH} />
          Locked until reset
        </span>
      </div>
      <div className="dshx:grid dshx:grid-cols-3 dshx:gap-3">
        <Stat
          label="Pace"
          value={ratio === null ? (window.pacePerHour === null ? 'Unknown' : `${window.pacePerHour.toFixed(1)} pt/h`) : `${ratio.toFixed(1)}x even`}
        />
        <Stat label="Runs out" value={window.runsOutAt === null ? 'Not before reset' : Format.moment(window.runsOutAt, now)} />
        <Stat label="Locked before reset" value={window.lockedMs === null ? '–' : Format.duration(window.lockedMs)} />
      </div>
      {account.others.length === 0 ? null : (
        <p className="dshx:text-xs dshx:text-muted-foreground">
          Also tracked:{' '}
          {account.others
            .map(other => `${other.label} ${Format.percent(other.used)}${other.runsOutAt === null ? '' : `, runs out ${Format.moment(other.runsOutAt, now)}`}`)
            .join(' · ')}
        </p>
      )}
      <RecentPace now={now} window={window} />
    </aside>
  )
}

export class ForecastBoardView {
  static headline = (board: ForecastBoard) => {
    const first = board.accounts.find((account): account is Forecasted => account.status === 'forecast' && account.window.runsOutAt !== null)
    if (first === undefined) return { title: 'No account runs out before reset', subtitle: 'At the current pace, every limit lasts until it resets.' }
    const count = board.runsOutCount
    const runsOutAt = first.window.runsOutAt ?? board.now
    return {
      title: `${String(count)} account${count === 1 ? ' runs' : 's run'} out before reset`,
      subtitle: `${first.displayName} first, ${Format.moment(runsOutAt, board.now)}${first.window.lockedMs === null ? '' : `, then locked ${Format.duration(first.window.lockedMs)}`}`,
    }
  }

  static Board = (props: {
    readonly board: ForecastBoard
    readonly selectedId: string | null
    readonly onSelect: (instanceId: string) => void
  }): JSX.Element => {
    const { board } = props
    const selected = board.accounts.find(account => account.instanceId === props.selectedId) ?? board.accounts[0]
    return (
      <div className="dshx:grid dshx:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)] dshx:gap-6 dshx:@max-5xl:grid-cols-1">
        <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3">
          <div className="dshx:grid dshx:grid-cols-[minmax(7rem,10rem)_minmax(0,1fr)_minmax(8rem,12rem)] dshx:gap-3 dshx:px-2 dshx:@max-pane-compact:grid-cols-1">
            <span className="dshx:@max-pane-compact:hidden" />
            <DayHeader cellStarts={board.cellStarts} now={board.now} />
          </div>
          <div className="dshx:flex dshx:flex-col">
            {board.accounts.map(account => (
              <BoardRow
                account={account}
                key={account.instanceId}
                now={board.now}
                onSelect={() => props.onSelect(account.instanceId)}
                selected={account.instanceId === selected?.instanceId}
              />
            ))}
          </div>
          <BoardLegend />
        </div>
        {selected === undefined ? null : (
          <div className="dshx:border-l dshx:pl-6 dshx:@max-5xl:max-w-2xl dshx:@max-5xl:border-t dshx:@max-5xl:border-l-0 dshx:@max-5xl:pt-4 dshx:@max-5xl:pl-0">
            <ForecastDetail account={selected} now={board.now} />
          </div>
        )}
      </div>
    )
  }

  static Table = (props: { readonly board: ForecastBoard }): JSX.Element => {
    const { board } = props
    return (
      <Table className="dshx:text-sm">
        <TableHeader>
          <TableRow>
            <TableHead>Account</TableHead>
            <TableHead>Window</TableHead>
            <TableHead className="dshx:text-right">Used</TableHead>
            <TableHead className="dshx:text-right">Pace</TableHead>
            <TableHead>Runs out</TableHead>
            <TableHead>Resets</TableHead>
            <TableHead className="dshx:text-right">Locked</TableHead>
            <TableHead className="dshx:text-right">At reset</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {board.accounts.map(account => (
            <TableRow key={account.instanceId}>
              <TableCell>
                <span className="dshx:flex dshx:items-center dshx:gap-2">
                  <ProviderGlyph kind={account.kind} />
                  {account.displayName}
                </span>
              </TableCell>
              {account.status === 'unavailable' ? (
                <TableCell className="dshx:text-muted-foreground" colSpan={7}>
                  {unavailableLine(account.reason)}
                </TableCell>
              ) : (
                <>
                  <TableCell className="dshx:text-muted-foreground">{account.window.label}</TableCell>
                  <TableCell className="dshx:text-right dshx:tabular-nums">{Format.percent(account.window.used)}</TableCell>
                  <TableCell className="dshx:text-right dshx:tabular-nums">
                    {account.window.pacePerHour === null
                      ? '–'
                      : account.window.evenPerHour === null || account.window.evenPerHour === 0
                        ? `${account.window.pacePerHour.toFixed(1)} pt/h`
                        : `${(account.window.pacePerHour / account.window.evenPerHour).toFixed(1)}x`}
                  </TableCell>
                  <TableCell className={cn(account.window.runsOutAt !== null && 'dshx:text-destructive')}>
                    {account.window.runsOutAt === null ? '–' : Format.moment(account.window.runsOutAt, board.now)}
                  </TableCell>
                  <TableCell>{account.window.resetsAt === null ? 'Not reported' : Format.moment(account.window.resetsAt, board.now)}</TableCell>
                  <TableCell className="dshx:text-right dshx:tabular-nums">
                    {account.window.lockedMs === null ? '–' : Format.duration(account.window.lockedMs)}
                  </TableCell>
                  <TableCell className="dshx:text-right dshx:tabular-nums">
                    {account.window.usedAtReset === null || account.window.runsOutAt !== null ? '–' : `~${Format.percent(account.window.usedAtReset)}`}
                  </TableCell>
                </>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }
}
