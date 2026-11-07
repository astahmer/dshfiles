import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Combobox } from '@dshfiles/plugin-ui/components/ui/combobox'
import { NumberedSection } from './panel-primitives.js'
import { QuotaHistoryChart } from './quota-history-chart.js'
import type { AccountsPanelState } from './use-accounts-panel-state.js'
import { UsageCardView } from './usage-card-view.js'
import { UsageRefreshNotice } from './usage-read-status.js'
import { useAccountsUsage } from './use-accounts-usage.js'

const HISTORY_RANGES = [1, 3, 7, 14, 30] as const

export const QuotaSection = (props: { readonly state: AccountsPanelState }): JSX.Element => {
  const { selected, selectedId, usage, history, historyDays, setHistoryDays, recordUsage } = props.state
  const { refresh, refreshing, failure } = useAccountsUsage()
  return (
    <NumberedSection
      actions={
        <>
          <Combobox
            label="History range"
            onValueChange={days => setHistoryDays(Number(days))}
            options={HISTORY_RANGES.map(days => ({ value: String(days), label: `${days}d` }))}
            triggerClassName="dshx:h-7 dshx:w-20 dshx:text-xs"
            value={String(historyDays)}
          />
          <Button disabled={selectedId === null} onClick={recordUsage} size="xs" type="button" variant="outline">
            Record now
          </Button>
        </>
      }
      heading="Quota"
    >
      <UsageRefreshNotice failure={failure} hasReading={usage !== null} onRetry={() => void refresh()} refreshing={refreshing} />
      <UsageCardView
        history={history}
        now={usage?.readAt ?? 0}
        onRetry={() => void refresh()}
        refreshing={refreshing}
        usage={usage?.cards.find(card => card.instanceId === selected?.instanceId)?.usage}
      />
      <h4 className="dshx:mt-5 dshx:text-sm dshx:font-medium">Remaining quota over time</h4>
      <QuotaHistoryChart
        ariaLabel={`Remaining quota over the last ${String(historyDays)} days`}
        emptyMessage="Not enough history yet. Quota is recorded on an interval; check back shortly."
        height={200}
        points={history}
      />
    </NumberedSection>
  )
}
