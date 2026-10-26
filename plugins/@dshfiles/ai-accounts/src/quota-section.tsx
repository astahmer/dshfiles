import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { NumberedSection } from './panel-primitives.js'
import { QuotaHistoryChart } from './quota-history-chart.js'
import type { AccountsPanelState } from './use-accounts-panel-state.js'
import { UsageCardView } from './usage-card-view.js'

const HISTORY_RANGES = [1, 3, 7, 14, 30] as const

export const QuotaSection = (props: { readonly state: AccountsPanelState }): JSX.Element => {
  const { selected, selectedId, usage, history, historyDays, setHistoryDays, recordUsage } = props.state
  return (
    <NumberedSection
      actions={
        <>
          <Select onValueChange={days => setHistoryDays(Number(days))} value={String(historyDays)}>
            <SelectTrigger aria-label="History range" className="dshx:h-6 dshx:text-xs" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HISTORY_RANGES.map(days => (
                <SelectItem key={days} value={String(days)}>
                  {days}d
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button disabled={selectedId === null} onClick={recordUsage} size="xs" type="button" variant="outline">
            Record now
          </Button>
        </>
      }
      index="04"
      heading="Quota"
    >
      <UsageCardView now={usage?.readAt ?? 0} usage={usage?.cards.find(card => card.instanceId === selected?.instanceId)?.usage} />
      <QuotaHistoryChart
        ariaLabel={`Remaining quota over the last ${String(historyDays)} days`}
        emptyMessage="Not enough history yet. Quota is recorded on an interval; check back shortly."
        height={160}
        points={history}
      />
    </NumberedSection>
  )
}
