import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useId, useState, type ReactNode } from 'react'
import type { UsageHistoryPoint } from './api.js'
import { KIND_LABEL } from './account-labels.js'
import { ProviderGlyph } from './provider-glyph.js'
import { QuotaForecastFormat as Format } from './quota-forecast-format.js'
import { QuotaPaceModel, type PaceAccount, type PacePoint, type PastWindow } from './quota-pace-model.js'

type Mode = 'current' | 'past'

const WIDTH = 640
const HEIGHT = 440
const PAD = { left: 44, right: 16, top: 34, bottom: 30 }
const x = (value: number): number => PAD.left + value * (WIDTH - PAD.left - PAD.right)
const y = (used: number): number => PAD.top + (1 - used / 100) * (HEIGHT - PAD.top - PAD.bottom)
const path = (points: readonly PacePoint[]): string =>
  points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.x).toFixed(1)},${y(point.used).toFixed(1)}`).join(' ')

const windowName = (lengthMs: number): string => {
  const days = Math.round(lengthMs / 86_400_000)
  return days >= 1 ? `${String(days)}-day window` : `${Format.duration(lengthMs)} window`
}

const atReset = (account: PaceAccount): string => (account.usedAtReset === null ? '–' : `~${Format.percent(account.usedAtReset)} at reset`)

const Frame = (props: { readonly patternId: string; readonly children: ReactNode }): JSX.Element => (
  <>
    <defs>
      <pattern height="6" id={props.patternId} patternTransform="rotate(45)" patternUnits="userSpaceOnUse" width="6">
        <line className="dshx:stroke-destructive" strokeWidth="2" x1="0" x2="0" y1="0" y2="6" />
      </pattern>
      <pattern height="8" id={`${props.patternId}-ahead`} patternTransform="rotate(45)" patternUnits="userSpaceOnUse" width="8">
        <line className="dshx:stroke-foreground/5" strokeWidth="1" x1="0" x2="0" y1="0" y2="8" />
      </pattern>
    </defs>
    <path
      d={`M${String(x(0))},${String(y(0))} L${String(x(1))},${String(y(100))} L${String(x(0))},${String(y(100))} Z`}
      fill={`url(#${props.patternId}-ahead)`}
    />
    {[0, 25, 50, 75, 100].map(tick => (
      <g key={tick}>
        <line className="dshx:stroke-border" strokeDasharray={tick === 0 || tick === 100 ? undefined : '2 4'} x1={x(0)} x2={x(1)} y1={y(tick)} y2={y(tick)} />
        <text className="dshx:fill-muted-foreground" fontSize="11" textAnchor="end" x={PAD.left - 8} y={y(tick) + 4}>
          {tick}%
        </text>
      </g>
    ))}
    {[0.25, 0.5, 0.75].map(tick => (
      <line className="dshx:stroke-border" key={tick} strokeDasharray="2 4" x1={x(tick)} x2={x(tick)} y1={y(100)} y2={y(0)} />
    ))}
    <line className="dshx:stroke-muted-foreground" strokeWidth="1.5" x1={x(1)} x2={x(1)} y1={y(100)} y2={y(0)} />
    <line className="dshx:stroke-muted-foreground/70" x1={x(0)} x2={x(1)} y1={y(0)} y2={y(100)} />
    <text
      className="dshx:fill-muted-foreground"
      fontSize="12"
      textAnchor="middle"
      transform={`rotate(${String((-Math.atan((y(0) - y(100)) / (x(1) - x(0))) * 180) / Math.PI)} ${String(x(0.82))} ${String(y(82) - 8)})`}
      x={x(0.82)}
      y={y(82) - 8}
    >
      Even pace
    </text>
    <text className="dshx:fill-muted-foreground" fontSize="11" x={x(0) + 10} y={y(100) + 18}>
      Ahead of even pace
    </text>
    <text className="dshx:fill-muted-foreground" fontSize="11" textAnchor="end" x={x(1) - 10} y={y(0) - 10}>
      Behind
    </text>
    <text className="dshx:fill-muted-foreground" fontSize="11" x={x(0)} y={HEIGHT - 8}>
      Window start
    </text>
    {(['¼', '½', '¾'] as const).map((label, index) => (
      <text className="dshx:fill-muted-foreground" fontSize="11" key={label} textAnchor="middle" x={x((index + 1) / 4)} y={HEIGHT - 8}>
        {label}
      </text>
    ))}
    <text className="dshx:fill-foreground" fontSize="11" textAnchor="end" x={x(1)} y={HEIGHT - 8}>
      Reset
    </text>
    {props.children}
  </>
)

const CurrentChart = (props: { readonly accounts: readonly PaceAccount[]; readonly selectedId: string; readonly now: number }): JSX.Element => {
  const patternId = `pace-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const selected = props.accounts.find(account => account.instanceId === props.selectedId)
  const ordered = [...props.accounts].sort((left, right) => Number(left.instanceId === props.selectedId) - Number(right.instanceId === props.selectedId))
  return (
    <svg
      aria-label="Use of every account across its current window"
      className="dshx:h-auto dshx:w-full dshx:text-foreground"
      role="img"
      viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
    >
      <Frame patternId={patternId}>
        {selected?.runsOutAt === null || selected === undefined ? null : (
          <g>
            <rect
              fill={`url(#${patternId})`}
              height="8"
              width={Math.max(2, x(1) - x(selected.projection[1]?.x ?? 1))}
              x={x(selected.projection[1]?.x ?? 1)}
              y={y(100) - 8}
            />
            <text className="dshx:fill-destructive" fontSize="12" textAnchor="end" x={x(1)} y={y(100) - 14}>
              Locked {selected.lockedMs === null ? '' : Format.duration(selected.lockedMs)}
            </text>
            <text className="dshx:fill-destructive" fontSize="12" textAnchor="middle" x={x(selected.projection[1]?.x ?? 1)} y={y(100) - 14}>
              Runs out {Format.moment(selected.runsOutAt, props.now)}
            </text>
          </g>
        )}
        {ordered.map(account => {
          const active = account.instanceId === props.selectedId
          const end = account.projection.at(-1)
          return (
            <g className={active ? 'dshx:text-foreground' : 'dshx:text-muted-foreground'} key={account.instanceId}>
              <path d={path(account.curve)} fill="none" stroke="currentColor" strokeOpacity={active ? 1 : 0.55} strokeWidth={active ? 2.5 : 1.25} />
              <path
                d={path(account.projection)}
                fill="none"
                stroke="currentColor"
                strokeDasharray="4 4"
                strokeOpacity={active ? 0.9 : 0.45}
                strokeWidth={active ? 1.75 : 1}
              />
              {end === undefined ? null : (
                <circle className="dshx:fill-background" cx={x(end.x)} cy={y(end.used)} r="3.5" stroke="currentColor" strokeOpacity="0.6" />
              )}
              {account.runsOutAt === null ? null : (
                <circle
                  className={cn(active ? 'dshx:fill-destructive' : 'dshx:fill-destructive/50')}
                  cx={x(account.projection[1]?.x ?? 1)}
                  cy={y(100)}
                  r={active ? 6 : 3.5}
                />
              )}
              <circle className="dshx:fill-background" cx={x(account.x)} cy={y(account.used)} r={active ? 7 : 5} stroke="currentColor" strokeWidth="1.5" />
              <circle cx={x(account.x)} cy={y(account.used)} fill="currentColor" r={active ? 3 : 2} />
              <foreignObject height="20" width="72" x={x(account.x) + 10} y={y(account.used) - 10}>
                <span
                  className={cn(
                    'dshx:flex dshx:items-center dshx:gap-1 dshx:rounded dshx:bg-background/80 dshx:px-1 dshx:text-[12px] dshx:tabular-nums',
                    active ? 'dshx:text-foreground' : 'dshx:text-muted-foreground',
                  )}
                >
                  <ProviderGlyph className="dshx:size-3" kind={account.kind} />
                  {Format.percent(account.used)}
                </span>
              </foreignObject>
            </g>
          )
        })}
      </Frame>
    </svg>
  )
}

const PastChart = (props: { readonly windows: readonly PastWindow[]; readonly current: PaceAccount }): JSX.Element => {
  const patternId = `past-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  return (
    <svg
      aria-label={`${props.current.displayName}: past windows against this one`}
      className="dshx:h-auto dshx:w-full dshx:text-foreground"
      role="img"
      viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
    >
      <Frame patternId={patternId}>
        {props.windows.map((window, index) => (
          <g className="dshx:text-muted-foreground" key={window.resetsAt}>
            <path d={path(window.curve)} fill="none" stroke="currentColor" strokeOpacity={0.75 - index * 0.1} strokeWidth="1.25" />
            {window.ranOutX === null ? null : <circle className="dshx:fill-destructive/60" cx={x(window.ranOutX)} cy={y(100)} r="3.5" />}
          </g>
        ))}
        <path d={path(props.current.curve)} fill="none" stroke="currentColor" strokeWidth="2.5" />
        <path d={path(props.current.projection)} fill="none" stroke="currentColor" strokeDasharray="4 4" strokeWidth="1.5" />
        <circle className="dshx:fill-background" cx={x(props.current.x)} cy={y(props.current.used)} r="7" stroke="currentColor" strokeWidth="1.5" />
        <circle cx={x(props.current.x)} cy={y(props.current.used)} fill="currentColor" r="3" />
      </Frame>
    </svg>
  )
}

const Stat = (props: { readonly label: string; readonly value: string; readonly alarm?: boolean }): JSX.Element => (
  <div className="dshx:flex dshx:flex-col dshx:gap-1">
    <span className="dshx:text-xs dshx:text-muted-foreground">{props.label}</span>
    <span className={cn('dshx:text-lg dshx:font-medium dshx:tabular-nums', props.alarm === true && 'dshx:text-destructive')}>{props.value}</span>
  </div>
)

const AccountList = (props: {
  readonly accounts: readonly PaceAccount[]
  readonly selectedId: string
  readonly now: number
  readonly onSelect: (instanceId: string) => void
}): JSX.Element => (
  <section className="dshx:flex dshx:flex-col dshx:gap-1 dshx:border-t dshx:pt-4">
    <h3 className="dshx:px-2 dshx:pb-1 dshx:text-sm">
      <span className="dshx:font-medium">All accounts</span>
      <span className="dshx:text-muted-foreground"> · fastest first</span>
    </h3>
    {props.accounts.map(account => (
      <button
        aria-pressed={account.instanceId === props.selectedId}
        className={cn(
          'dshx:grid dshx:grid-cols-[minmax(0,1fr)_3rem_minmax(6rem,auto)] dshx:items-center dshx:gap-3 dshx:rounded-md dshx:px-2 dshx:py-1.5 dshx:text-left dshx:text-sm dshx:hover:bg-muted/40 dshx:focus-visible:outline-2 dshx:focus-visible:outline-ring',
          account.instanceId === props.selectedId && 'dshx:bg-muted/60',
        )}
        key={account.instanceId}
        onClick={() => props.onSelect(account.instanceId)}
        type="button"
      >
        <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
          <ProviderGlyph kind={account.kind} />
          <span className="dshx:truncate">{account.displayName}</span>
        </span>
        <span className="dshx:text-right dshx:tabular-nums">{account.ratio.toFixed(1)}x</span>
        <span
          className={cn('dshx:text-right dshx:text-xs dshx:tabular-nums', account.runsOutAt === null ? 'dshx:text-muted-foreground' : 'dshx:text-destructive')}
        >
          {account.runsOutAt === null ? atReset(account) : Format.moment(account.runsOutAt, props.now)}
        </span>
      </button>
    ))}
  </section>
)

export class PaceBoardView {
  static headline = (accounts: readonly PaceAccount[], now: number) => {
    const fastest = accounts[0]
    if (fastest === undefined) return { title: 'No window to compare yet', subtitle: 'Pace needs an account whose window start and reset are known.' }
    const others = accounts.length - 1
    const behind = accounts.slice(1).filter(account => account.ratio < 1).length
    const rest =
      others === 0 ? '' : behind === others ? ` The other ${String(others)} ${others === 1 ? 'is' : 'are'} behind.` : ` ${String(others - behind)} more ahead.`
    if (fastest.ratio <= 1)
      return { title: 'Every account is at or behind even pace', subtitle: `${fastest.displayName} is closest, at ${fastest.ratio.toFixed(1)}x.` }
    return {
      title: `${fastest.displayName} is ${fastest.ratio.toFixed(1)}x ahead of even pace`,
      subtitle: `${fastest.runsOutAt === null ? `~${Format.percent(fastest.usedAtReset ?? fastest.used)} used at reset` : `Runs out ${Format.moment(fastest.runsOutAt, now)}`} if the pace holds.${rest}`,
    }
  }

  static Board = (props: {
    readonly accounts: readonly PaceAccount[]
    readonly pointsById: ReadonlyMap<string, readonly UsageHistoryPoint[]>
    readonly now: number
  }): JSX.Element => {
    const [mode, setMode] = useState<Mode>('current')
    const [chosenId, setChosenId] = useState<string | null>(null)
    const selected = props.accounts.find(account => account.instanceId === chosenId) ?? props.accounts[0]
    if (selected === undefined) return <p className="dshx:text-sm dshx:text-muted-foreground">No account reports both a window start and a reset yet.</p>
    const past = QuotaPaceModel.pastWindows({
      points: props.pointsById.get(selected.instanceId) ?? [],
      label: selected.label,
      lengthMs: selected.lengthMs,
      now: props.now,
    })
    const ranOut = past.filter(window => window.ranOutX !== null).length
    return (
      <div className="dshx:grid dshx:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)] dshx:gap-6 dshx:@max-5xl:grid-cols-1">
        <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3">
          <ToggleGroup
            className="dshx:self-start"
            onValueChange={value => setMode(value === 'past' ? 'past' : 'current')}
            size="sm"
            type="single"
            value={mode}
            variant="outline"
          >
            <ToggleGroupItem value="current">This window</ToggleGroupItem>
            <ToggleGroupItem value="past">Past windows</ToggleGroupItem>
          </ToggleGroup>
          {mode === 'current' ? (
            <CurrentChart accounts={props.accounts} now={props.now} selectedId={selected.instanceId} />
          ) : past.length === 0 ? (
            <p className="dshx:text-sm dshx:text-muted-foreground">
              No finished {selected.label} window for {selected.displayName} in the stored history yet.
            </p>
          ) : (
            <PastChart current={selected} windows={past} />
          )}
          <div className="dshx:flex dshx:flex-wrap dshx:gap-x-4 dshx:gap-y-1 dshx:text-xs dshx:text-muted-foreground">
            <span>— {mode === 'current' ? 'Used so far' : 'This window'}</span>
            <span>- - If the pace holds</span>
            {mode === 'past' ? <span className="dshx:opacity-70">— Past windows, newest brightest</span> : null}
            <span className="dshx:flex dshx:items-center dshx:gap-1.5">
              <span aria-hidden className="dshx:size-2 dshx:rounded-full dshx:bg-destructive" />
              {mode === 'current' ? 'Runs out' : 'Ran out'}
            </span>
          </div>
        </div>
        <aside className="dshx:flex dshx:flex-col dshx:gap-4 dshx:border-l dshx:pl-6 dshx:@max-5xl:max-w-2xl dshx:@max-5xl:border-t dshx:@max-5xl:border-l-0 dshx:@max-5xl:pt-4 dshx:@max-5xl:pl-0">
          <header className="dshx:flex dshx:items-start dshx:gap-3">
            <ProviderGlyph className="dshx:mt-1 dshx:size-6" kind={selected.kind} />
            <div className="dshx:flex dshx:min-w-0 dshx:flex-col">
              <h2 className="dshx:truncate dshx:text-base dshx:font-medium">{selected.displayName}</h2>
              <p className="dshx:truncate dshx:text-sm dshx:text-muted-foreground">
                {KIND_LABEL[selected.kind]} · {windowName(selected.lengthMs)} · resets {Format.moment(selected.resetsAt, props.now)}
              </p>
            </div>
          </header>
          <p className="dshx:flex dshx:items-baseline dshx:gap-3">
            <span className="dshx:text-4xl dshx:font-medium dshx:tabular-nums">{selected.ratio.toFixed(1)}x</span>
            <span className="dshx:text-muted-foreground">even pace</span>
          </p>
          {mode === 'current' ? (
            <>
              <div className="dshx:grid dshx:grid-cols-2 dshx:gap-3">
                <Stat label="Used now" value={Format.percent(selected.used)} />
                <Stat label="Even pace by now" value={Format.percent(selected.evenNow)} />
              </div>
              <span className="dshx:text-sm dshx:text-muted-foreground">If the pace holds</span>
              <div className="dshx:grid dshx:grid-cols-2 dshx:gap-3">
                <Stat
                  alarm={selected.runsOutAt !== null}
                  label="Runs out"
                  value={selected.runsOutAt === null ? 'Not before reset' : Format.moment(selected.runsOutAt, props.now)}
                />
                <Stat
                  label={selected.runsOutAt === null ? 'Used at reset' : 'Locked before reset'}
                  value={
                    selected.runsOutAt === null
                      ? `~${Format.percent(selected.usedAtReset ?? selected.used)}`
                      : selected.lockedMs === null
                        ? '–'
                        : Format.duration(selected.lockedMs)
                  }
                />
              </div>
            </>
          ) : (
            <>
              <p className="dshx:text-sm">
                {past.length === 0
                  ? 'No finished window yet.'
                  : `Ran out in ${String(ranOut)} of its last ${String(past.length)} window${past.length === 1 ? '' : 's'}; ended them at ${Format.percent(past.reduce((total, window) => total + window.finalUsed, 0) / past.length)} on average.`}
              </p>
              <ul className="dshx:flex dshx:flex-col dshx:gap-1 dshx:text-sm">
                {past.map(window => (
                  <li className="dshx:flex dshx:justify-between dshx:gap-3" key={window.resetsAt}>
                    <span className="dshx:text-muted-foreground">
                      {Format.day(window.startsAt)} → {Format.day(window.resetsAt)}
                    </span>
                    <span className={cn('dshx:tabular-nums', window.ranOutX !== null && 'dshx:text-destructive')}>
                      {window.ranOutX === null
                        ? Format.percent(window.finalUsed)
                        : `ran out, locked ${window.lockedMs === null ? '' : Format.duration(window.lockedMs)}`}
                      {window.endedEarly ? ' · reset early' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <AccountList accounts={props.accounts} now={props.now} onSelect={setChosenId} selectedId={selected.instanceId} />
        </aside>
      </div>
    )
  }
}
