import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ChevronDownIcon, InfoIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useId, useState, type ReactNode } from 'react'
import type { ChartView } from './api.js'
import { UsageFormattingModel } from './format.js'

type Summary = ChartView['summary']

/** A range with no request has nothing to total: the page says so in one sentence instead of a grid of zeros. */
export const usageIsEmpty = (summary: Pick<Summary, 'requests'>): boolean => summary.requests === 0

const Tile = (props: { readonly label: ReactNode; readonly value: string; readonly detail?: ReactNode }): JSX.Element => (
  <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5">
    <span className="dshx:flex dshx:items-center dshx:gap-1 dshx:text-xs dshx:text-muted-foreground">{props.label}</span>
    <span className="dshx:text-base dshx:font-semibold dshx:tabular-nums">{props.value}</span>
    {props.detail === undefined || props.detail === null ? null : <span className="dshx:text-2xs dshx:text-muted-foreground">{props.detail}</span>}
  </div>
)

/**
 * A lead number: 22/650 tabular figures in neutral ink, the page title's step (council round 5, D1). No series dot:
 * none of these measures is a series on screen, so a coloured dot would key nothing (council round 2, D1). Every lead
 * number has the same two lines, label and value; a change against the previous period sits beside the value on its
 * baseline, never as a sub-line only some of the three carry (council round 8, D1).
 */
const LeadTile = (props: { readonly label: ReactNode; readonly value: string; readonly change?: ReactNode }): JSX.Element => (
  <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1 dshx:px-4 dshx:pt-2 dshx:pb-3 dshx:@max-pane-narrow:px-3">
    <span className="dshx:flex dshx:items-center dshx:gap-1 dshx:text-xs dshx:text-muted-foreground">{props.label}</span>
    <span className="dshx:flex dshx:min-w-0 dshx:items-baseline dshx:gap-2" data-kpi-line>
      <span className="dshx:min-w-0 dshx:truncate dshx:text-title dshx:font-title dshx:tabular-nums" data-kpi-value>
        {props.value}
      </span>
      {props.change}
    </span>
  </div>
)

/** A change against the previous period, or nothing when there is no earlier usage: an absent number needs no caption. */
const Change = (props: { readonly current: number; readonly previous: number; readonly className?: string }): JSX.Element | null => {
  const ratio = UsageFormattingModel.changeRatio(props.current, props.previous)
  if (ratio === null) return null
  const up = ratio >= 0
  return (
    <span className={cn(up ? 'dshx:text-warning' : 'dshx:text-success', props.className)}>
      {up ? '▲' : '▼'} {Math.abs(ratio) >= 10 ? `${String(Math.round(ratio + 1))}×` : UsageFormattingModel.formatPercent(Math.abs(ratio))}{' '}
      <span className="dshx:@max-pane-compact:sr-only">vs previous period</span>
    </span>
  )
}

/** The lead row's change: 12 px beside the value, never wrapping under it. */
const LEAD_CHANGE = 'dshx:shrink-0 dshx:whitespace-nowrap dshx:text-xs dshx:font-medium'

/**
 * The Overview tab's numbers: cost, tokens and requests lead (tokens is the chart's default measure), in one hairline
 * card split by two dividers; the other five, cache hit among them, open under a hairline inside the same card. The card
 * has a small header line like the cards below it, "Totals" with "More numbers" at its end, so the link sits in no stat
 * cell and needs no footer row (council round 6, D1; round 7, D3; round 9, D1). The estimate's caveat (list price,
 * catalog age) is a tooltip on the cost label.
 */
export const CostSummary = (props: {
  readonly summary: Summary
  readonly days: number
  readonly pricingNote: string
  /** Opens with the other five numbers showing. */
  readonly defaultOpen?: boolean
}): JSX.Element => {
  const [open, setOpen] = useState(props.defaultOpen === true)
  const moreId = useId()
  const { summary } = props
  const tokens = summary.input + summary.cacheRead + summary.cacheWrite + summary.output
  const cacheHit = UsageFormattingModel.cacheHitRatio(summary)
  const leadChange = (current: number, previous: number): JSX.Element | undefined =>
    UsageFormattingModel.changeRatio(current, previous) === null ? undefined : <Change className={LEAD_CHANGE} current={current} previous={previous} />
  return (
    <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
      <div
        data-usage-stats
        className="dshx:@container dshx:flex dshx:min-w-0 dshx:flex-col dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card"
      >
        <div
          className="dshx:flex dshx:min-w-0 dshx:items-center dshx:justify-between dshx:gap-3 dshx:px-4 dshx:pt-3 dshx:@max-pane-narrow:px-3"
          data-usage-stats-header
        >
          <span className="dshx:text-sm dshx:font-semibold dshx:text-foreground">Totals</span>
          <Button aria-controls={moreId} aria-expanded={open} className={STATS_MORE_LINK} onClick={() => setOpen(!open)} type="button" variant="link">
            {open ? 'Fewer numbers' : 'More numbers'}
            <ChevronDownIcon
              aria-hidden
              className={cn('dshx:size-3.5 dshx:transition-transform dshx:duration-(--dshx-duration-fade) dshx:ease-enter', open && 'dshx:rotate-180')}
            />
          </Button>
        </div>
        <div className="dshx:grid dshx:min-w-0 dshx:grid-cols-3 dshx:divide-x dshx:divide-border" data-usage-stats-row>
          <LeadTile
            label={
              <>
                Cost (estimate)
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button aria-label="About this estimate" className="dshx:inline-flex dshx:rounded-sm dshx:text-muted-foreground" type="button">
                        <InfoIcon aria-hidden className="dshx:size-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="dshx-root dshx:max-w-64">{props.pricingNote}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </>
            }
            value={UsageFormattingModel.formatCost(summary.cost)}
            change={leadChange(summary.cost, summary.previous.cost)}
          />
          <LeadTile label="Tokens" value={UsageFormattingModel.formatCount(tokens)} change={leadChange(tokens, summary.previous.tokens)} />
          <LeadTile label="Requests" value={summary.requests.toLocaleString()} change={leadChange(summary.requests, summary.previous.requests)} />
        </div>
        {open ? (
          <div
            className="dshx:grid dshx:grid-cols-2 dshx:gap-x-4 dshx:gap-y-3 dshx:border-t dshx:border-border dshx:px-4 dshx:py-3 dshx:@min-[42rem]:grid-cols-3 dshx:@min-[64rem]:grid-cols-5 dshx:@max-pane-narrow:px-3"
            id={moreId}
          >
            <Tile
              label="Per day"
              value={UsageFormattingModel.formatCost(summary.cost / props.days)}
              detail={summary.unpriced === 0 ? undefined : `${summary.unpriced.toLocaleString()} requests unpriced`}
            />
            <Tile
              label="Failed / aborted"
              value={`${summary.failed.toLocaleString()} / ${summary.aborted.toLocaleString()}`}
              detail={summary.failed === 0 ? undefined : UsageFormattingModel.formatPercent(summary.failed / summary.requests)}
            />
            <Tile label="Cache hit" value={UsageFormattingModel.formatPercent(cacheHit)} />
            <Tile
              label="Cache savings (estimate)"
              value={UsageFormattingModel.formatCost(summary.cacheSavings)}
              detail={
                cacheHit === null
                  ? undefined
                  : `${UsageFormattingModel.formatCount(summary.cacheRead)} cached prompt tokens at the cache-read rate${summary.unpriced === 0 ? '' : ' · priced routes only'}`
              }
            />
            <Tile
              label="Cost per turn"
              value={summary.turns === 0 ? '–' : UsageFormattingModel.formatCost(summary.cost / summary.turns)}
              detail={summary.turns === 0 ? undefined : `${summary.turns.toLocaleString()} turns · ${summary.requests.toLocaleString()} requests`}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * "More numbers": a 13 px ink link, 20 px tall, at the end of the card's header line. Under a coarse pointer it takes a
 * 44 px target whose extra height overhangs the line (negative block margin), so the header does not grow.
 */
export const STATS_MORE_LINK =
  'dshx:h-5 dshx:gap-1 dshx:px-0 dshx:text-sm dshx:has-[>svg]:px-0 dshx:pointer-coarse:h-11 dshx:pointer-coarse:-my-3 dshx:pointer-coarse:min-w-11'
