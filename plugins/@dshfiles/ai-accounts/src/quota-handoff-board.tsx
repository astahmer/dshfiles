import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { CSSProperties } from 'react'
import { KIND_LABEL } from './account-labels.js'
import { ProviderGlyph } from './provider-glyph.js'
import type { HandoffPlan, WorkHours } from './quota-coverage-model.js'
import { QuotaForecastFormat as Format } from './quota-forecast-format.js'

const HOUR_MS = 3_600_000
const HATCH: CSSProperties = { backgroundImage: 'repeating-linear-gradient(135deg, currentColor 0 1.5px, transparent 1.5px 5px)' }
/** One tone per account in plan order; a fifth account reuses the last. */
const ACCOUNT_TONES = ['dshx:bg-foreground/70', 'dshx:bg-foreground/45', 'dshx:bg-foreground/28', 'dshx:bg-foreground/16'] as const
const PLAN_STEP_LIMIT = 8
const toneOf = (index: number): string => ACCOUNT_TONES[Math.min(index, ACCOUNT_TONES.length - 1)] ?? ACCOUNT_TONES[0]

const span = (start: number, end: number, now: number): string => `${Format.moment(start, now)} → ${Format.moment(end, now)}`

const DayRuler = (props: { readonly plan: HandoffPlan; readonly now: number }): JSX.Element => {
  const days = Array.from({ length: props.plan.hours }, (_, hour) => props.plan.start + hour * HOUR_MS).filter(
    (at, hour) => hour === 0 || new Date(at).getHours() === 0,
  )
  return (
    <div className="dshx:relative dshx:h-4 dshx:text-xs dshx:text-muted-foreground">
      {days.map(at => (
        <span
          className="dshx:absolute dshx:top-0 dshx:truncate"
          key={at}
          style={{ left: `${String(((at - props.plan.start) / (props.plan.hours * HOUR_MS)) * 100)}%` }}
        >
          {Format.weekday(at === props.plan.start ? props.now : at)}
        </span>
      ))}
    </div>
  )
}

const WorkBand = (props: { readonly plan: HandoffPlan; readonly workHours: WorkHours }): JSX.Element => (
  <div aria-hidden className="dshx:flex dshx:h-1">
    {Array.from({ length: props.plan.hours }, (_, hour) => {
      const date = new Date(props.plan.start + hour * HOUR_MS)
      const work = props.workHours.days.includes(date.getDay()) && date.getHours() >= props.workHours.startHour && date.getHours() < props.workHours.endHour
      return <span className={cn('dshx:flex-1', work && 'dshx:bg-muted-foreground/40')} key={hour} />
    })}
  </div>
)

const PlanSection = (props: { readonly plan: HandoffPlan; readonly now: number; readonly workHours: WorkHours }): JSX.Element => {
  const { plan, now } = props
  const order = plan.lanes.map(lane => lane.instanceId)
  const nameOf = (instanceId: string | null): string => plan.lanes.find(lane => lane.instanceId === instanceId)?.displayName ?? 'No account free'
  const total = plan.hours * HOUR_MS
  const widthOf = (segment: { readonly start: number; readonly end: number }): string => `${String(((segment.end - segment.start) / total) * 100)}%`
  return (
    <TooltipProvider delayDuration={500}>
      <section className="dshx:flex dshx:flex-col dshx:gap-3 dshx:border-b dshx:border-border/60 dshx:pb-5">
        <header className="dshx:flex dshx:flex-wrap dshx:items-baseline dshx:justify-between dshx:gap-2">
          <span className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-base dshx:font-medium">
            <ProviderGlyph className="dshx:size-5" kind={plan.kind} />
            {KIND_LABEL[plan.kind]}
          </span>
          <span className={cn('dshx:text-sm', plan.noneFreeWorkHours > 0 ? 'dshx:font-medium' : 'dshx:text-muted-foreground')}>
            {plan.lanes.length === 0
              ? 'No forecast'
              : plan.noneFreeHours === 0
                ? 'An account free all week'
                : `~${String(plan.noneFreeWorkHours)} work h none free · ${Format.duration(plan.noneFreeHours * HOUR_MS)} in all`}
          </span>
        </header>

        {plan.lanes.length === 0 ? (
          <p className="dshx:text-sm dshx:text-muted-foreground">No account of this kind has a forecast yet, so there is no hand-off to plan.</p>
        ) : (
          <div className="dshx:flex dshx:flex-col dshx:gap-1">
            <DayRuler now={now} plan={plan} />
            <div
              className="dshx:flex dshx:h-7 dshx:overflow-hidden dshx:rounded-md"
              role="img"
              aria-label={`Who serves ${KIND_LABEL[plan.kind]} over the next seven days`}
            >
              {plan.segments.map(segment => (
                <Tooltip key={segment.start}>
                  <TooltipTrigger asChild>
                    <span
                      className={cn(
                        'dshx:border-r dshx:border-background dshx:last:border-r-0',
                        segment.instanceId === null ? 'dshx:bg-destructive/15 dshx:text-destructive/70' : toneOf(order.indexOf(segment.instanceId)),
                      )}
                      style={segment.instanceId === null ? { ...HATCH, width: widthOf(segment) } : { width: widthOf(segment) }}
                    />
                  </TooltipTrigger>
                  <TooltipContent>{`${nameOf(segment.instanceId)} · ${span(segment.start, segment.end, now)}`}</TooltipContent>
                </Tooltip>
              ))}
            </div>
            <WorkBand plan={plan} workHours={props.workHours} />
            {plan.lanes.map((lane, index) => (
              <div className="dshx:grid dshx:grid-cols-[minmax(6rem,9rem)_minmax(0,1fr)] dshx:items-center dshx:gap-2" key={lane.instanceId}>
                <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:text-xs dshx:text-muted-foreground">
                  <span aria-hidden className={cn('dshx:size-2.5 dshx:shrink-0 dshx:rounded-[2px]', toneOf(index))} />
                  <span className="dshx:truncate">{lane.displayName}</span>
                </span>
                <span className="dshx:flex dshx:h-1.5">
                  {lane.free.map((free, hour) => (
                    <span className={cn('dshx:flex-1', free ? 'dshx:bg-muted-foreground/25' : 'dshx:bg-destructive/60')} key={hour} />
                  ))}
                </span>
              </div>
            ))}
          </div>
        )}

        <ol className="dshx:flex dshx:flex-col dshx:gap-1.5 dshx:text-sm">
          {plan.segments.slice(0, PLAN_STEP_LIMIT).map((segment, index) => (
            <li className="dshx:grid dshx:grid-cols-[1.5rem_minmax(0,1fr)_auto] dshx:items-baseline dshx:gap-2" key={segment.start}>
              <span className="dshx:text-xs dshx:tabular-nums dshx:text-muted-foreground">{String(index + 1)}</span>
              <span className={cn('dshx:min-w-0 dshx:truncate', segment.instanceId === null && 'dshx:text-destructive')}>
                {segment.instanceId === null
                  ? 'No account free'
                  : index === 0
                    ? `Work on ${nameOf(segment.instanceId)}`
                    : `Hand off to ${nameOf(segment.instanceId)}`}
                {segment.instanceId === null && segment.workHours > 0 ? ` · ${String(segment.workHours)} work h` : ''}
              </span>
              <span className="dshx:text-xs dshx:tabular-nums dshx:text-muted-foreground">
                {index === 0 ? `now → ${Format.moment(segment.end, now)}` : span(segment.start, segment.end, now)}
              </span>
            </li>
          ))}
        </ol>
        {plan.segments.length > PLAN_STEP_LIMIT ? (
          <p className="dshx:text-xs dshx:text-muted-foreground">{String(plan.segments.length - PLAN_STEP_LIMIT)} later hand-offs on the bar above.</p>
        ) : null}
        {plan.unread.length === 0 ? null : <p className="dshx:text-xs dshx:text-muted-foreground">Left out without a forecast: {plan.unread.join(', ')}.</p>}
      </section>
    </TooltipProvider>
  )
}

export class HandoffBoardView {
  static headline = (plans: readonly HandoffPlan[], now: number) => {
    const driest = plans.find(plan => plan.lanes.length > 0)
    if (driest === undefined) return { title: 'No provider has a stand-in account', subtitle: 'Add a second account of a kind to plan hand-offs between them.' }
    const gap = driest.segments.find(segment => segment.instanceId === null)
    if (gap === undefined)
      return { title: 'Every provider keeps an account free this week', subtitle: 'At the current pace, a stand-in is ready before each account runs out.' }
    return {
      title: `${KIND_LABEL[driest.kind]} runs dry ${Format.moment(gap.start, now)} for ${Format.duration(gap.end - gap.start)}`,
      subtitle: `Work on the account that resets soonest, hand off when it runs out. ${String(driest.noneFreeWorkHours)} work hour${driest.noneFreeWorkHours === 1 ? '' : 's'} with no ${KIND_LABEL[driest.kind]} account at this pace.`,
    }
  }

  static Board = (props: { readonly plans: readonly HandoffPlan[]; readonly now: number; readonly workHours: WorkHours }): JSX.Element => (
    <div className="dshx:flex dshx:max-w-5xl dshx:flex-col dshx:gap-5">
      {props.plans.length === 0 ? (
        <p className="dshx:text-sm dshx:text-muted-foreground">Hand-offs need two or more accounts of one provider kind.</p>
      ) : (
        props.plans.map(plan => <PlanSection key={plan.kind} now={props.now} plan={plan} workHours={props.workHours} />)
      )}
      <p className="dshx:text-xs dshx:text-muted-foreground">
        Each hour goes to the free account whose window resets soonest, since quota left at a reset is lost. Every account keeps its own current pace. Thin
        lanes: red while the account is spent. Under the bar: work hours ({Format.workHours(props.workHours)}).
      </p>
    </div>
  )
}
