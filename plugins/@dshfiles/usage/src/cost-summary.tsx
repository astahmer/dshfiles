import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { InfoIcon } from '@dshfiles/plugin-ui/icons'
import { useId, useState, type ReactNode } from 'react'
import type { ChartView } from './api.js'
import { UsageFormattingModel } from './format.js'

type Summary = ChartView['summary']

/** A range with no request has nothing to total: the page says so in one sentence instead of a grid of zeros. */
export const usageIsEmpty = (summary: Pick<Summary, 'requests'>): boolean => summary.requests === 0

const Tile = (props: { readonly label: ReactNode; readonly value: string; readonly detail?: ReactNode }): JSX.Element => (
  <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5 dshx:py-1">
    <span className="dshx:flex dshx:items-center dshx:gap-1 dshx:text-xs dshx:text-muted-foreground">{props.label}</span>
    <span className="dshx:text-base dshx:font-semibold dshx:tabular-nums">{props.value}</span>
    {props.detail === undefined || props.detail === null ? null : <span className="dshx:text-2xs dshx:text-muted-foreground">{props.detail}</span>}
  </div>
)

/** A change against the previous period, or nothing when there is no earlier usage: an absent number needs no caption. */
const Change = (props: { readonly current: number; readonly previous: number }): JSX.Element | null => {
  const ratio = UsageFormattingModel.changeRatio(props.current, props.previous)
  if (ratio === null) return null
  const up = ratio >= 0
  return (
    <span className={up ? 'dshx:text-warning' : 'dshx:text-success'}>
      {up ? '▲' : '▼'} {Math.abs(ratio) >= 10 ? `${String(Math.round(ratio + 1))}×` : UsageFormattingModel.formatPercent(Math.abs(ratio))} vs previous period
    </span>
  )
}

/**
 * The Cost tab's numbers: cost, requests and cache hit lead; the other five open on "More numbers". The estimate's
 * caveat (list price, catalog age) is a tooltip on the cost label.
 */
export const CostSummary = (props: { readonly summary: Summary; readonly days: number; readonly pricingNote: string }): JSX.Element => {
  const [open, setOpen] = useState(false)
  const moreId = useId()
  const { summary } = props
  const tokens = summary.input + summary.cacheRead + summary.cacheWrite + summary.output
  const cacheHit = UsageFormattingModel.cacheHitRatio(summary)
  const change = (current: number, previous: number): JSX.Element | undefined =>
    UsageFormattingModel.changeRatio(current, previous) === null ? undefined : <Change current={current} previous={previous} />
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-2">
      <div className="dshx:grid dshx:grid-cols-3 dshx:gap-2">
        <Tile
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
          detail={change(summary.cost, summary.previous.cost)}
        />
        <Tile label="Requests" value={summary.requests.toLocaleString()} detail={change(summary.requests, summary.previous.requests)} />
        <Tile
          label="Cache hit"
          value={UsageFormattingModel.formatPercent(cacheHit)}
          detail={cacheHit === null ? undefined : `${UsageFormattingModel.formatCount(summary.cacheRead)} cached prompt tokens`}
        />
      </div>
      {open ? (
        <div className="dshx:grid dshx:grid-cols-2 dshx:gap-2 dshx:@min-[48rem]:grid-cols-3 dshx:@min-[80rem]:grid-cols-5" id={moreId}>
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
          <Tile label="Tokens" value={UsageFormattingModel.formatCount(tokens)} detail={change(tokens, summary.previous.tokens)} />
          <Tile
            label="Cache savings (estimate)"
            value={UsageFormattingModel.formatCost(summary.cacheSavings)}
            detail={
              cacheHit === null
                ? undefined
                : `${UsageFormattingModel.formatPercent(cacheHit)} of prompt tokens billed at the cache-read rate${summary.unpriced === 0 ? '' : ' · priced routes only'}`
            }
          />
          <Tile
            label="Cost per turn"
            value={summary.turns === 0 ? '–' : UsageFormattingModel.formatCost(summary.cost / summary.turns)}
            detail={summary.turns === 0 ? undefined : `${summary.turns.toLocaleString()} turns · ${summary.requests.toLocaleString()} requests`}
          />
        </div>
      ) : null}
      <div>
        <Button aria-controls={moreId} aria-expanded={open} onClick={() => setOpen(!open)} size="xs" type="button" variant="ghost">
          {open ? 'Fewer numbers' : 'More numbers'}
        </Button>
      </div>
    </div>
  )
}
