import { CreditsUsage, type CreditCategory, type CreditTone } from '@dshfiles/plugin-ui/components/motion/credits-usage'
import type { UsageCard, UsageHistoryPoint } from './api.js'
import { ExtraUsageMeter } from './extra-usage-view.js'
import { quotaTone, type QuotaTone } from './quota-tone.js'
import { QuotaHistoryAnalysis } from './usage-history-analysis.js'
import { UsageOverviewModel } from './usage-overview-model.js'

const SPARKLINE_POINTS = 12

const creditTone = { ok: 'success', low: 'warning', critical: 'destructive' } as const satisfies Record<QuotaTone, CreditTone>

const formatLeft = (percent: number): string => `${String(Math.round(percent))}% left`

/** The current reset cycle of one window, newest points last; empty under two points, which draw no line. */
const recentPercents = (history: readonly UsageHistoryPoint[], label: string): readonly number[] => {
  const cycle = QuotaHistoryAnalysis.quotaHistoryCycles(history, label).at(-1) ?? []
  const percents = cycle.slice(-SPARKLINE_POINTS).flatMap(point => {
    const percent = point.windows[label]
    return percent === undefined ? [] : [Math.max(0, Math.min(100, percent))]
  })
  return percents.length < 2 ? [] : percents
}

/** One card per quota window: what is left, a tone-coloured bar, when it resets and its trend this cycle. */
export const quotaWindowCategories = (input: {
  readonly windows: UsageCard['windows']
  readonly now: number
  readonly history: readonly UsageHistoryPoint[]
}): readonly CreditCategory[] =>
  UsageOverviewModel.sortWindows(input.windows).map(window => ({
    id: window.label,
    label: window.label,
    tone: creditTone[quotaTone(window.percentRemaining)],
    total: window.percentRemaining,
    unit: '',
    formatTotal: formatLeft,
    caption: UsageOverviewModel.formatResetIn(window.resetsAt, input.now),
    chart: 'area',
    series: recentPercents(input.history, window.label),
    meter: { percent: window.percentRemaining, label: `${window.label} remaining` },
  }))

export const UsageCardView = (props: {
  readonly usage: UsageCard | undefined
  readonly now: number
  readonly history?: readonly UsageHistoryPoint[]
}): JSX.Element | null => {
  const usage = props.usage
  if (usage === undefined) return null
  if (usage.status !== 'ok' || (usage.windows.length === 0 && usage.extraUsage === undefined)) {
    return (
      <p className="dshx:rounded-lg dshx:border dshx:bg-muted/30 dshx:p-3 dshx:text-xs dshx:text-muted-foreground">
        {usage.message ?? (usage.status === 'unauthenticated' ? "Sign in to read this account's quota." : 'This provider reported no quota windows.')}
      </p>
    )
  }
  const now = props.now
  const earliestExpiry = usage.bankedResetExpiries.filter((expiresAt): expiresAt is number => expiresAt !== null).sort((left, right) => left - right)[0]
  const categories = quotaWindowCategories({ windows: usage.windows, now, history: props.history ?? [] })
  return (
    <CreditsUsage categories={categories} heading="Quota windows">
      {usage.extraUsage === undefined ? null : <ExtraUsageMeter className="dshx:rounded-xl dshx:bg-muted/60 dshx:p-3" extra={usage.extraUsage} now={now} />}
      {usage.bankedResets > 0 ? (
        <p className="dshx:text-xs dshx:text-info">
          {String(usage.bankedResets)} banked reset{usage.bankedResets === 1 ? '' : 's'}
          {earliestExpiry === undefined ? '' : ` · earliest expires ${new Date(earliestExpiry).toLocaleDateString()}`}
        </p>
      ) : null}
    </CreditsUsage>
  )
}
