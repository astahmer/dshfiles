import styles from './accounts.module.css'
import { Section } from './panel-primitives.js'
import type { AccountsPanelState } from './use-accounts-panel-state.js'
import { UsageCardView } from './usage-card-view.js'
import { UsageHistoryChart } from './usage-history-chart.js'

export const QuotaSection = (props: { readonly state: AccountsPanelState }): JSX.Element => {
  const { accounts, selected, selectedId, usage, history, setHistory, historyDays, setHistoryDays, setNotice } = props.state
  return (
    <Section
      index="04"
      title="Quota"
      action={
        <span className={styles.sectionActions}>
          <select
            className={styles.rangeSelect}
            value={String(historyDays)}
            aria-label="History range"
            onChange={event => setHistoryDays(Number(event.target.value))}
          >
            {[1, 3, 7, 14, 30].map(days => (
              <option key={days} value={String(days)}>
                {days}d
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles.quiet}
            onClick={() => {
              if (selectedId === null) return
              void accounts
                .collectUsage()
                .then(() => accounts.history({ instanceId: selectedId, days: historyDays }))
                .then(result => setHistory(result.points))
                .catch(() => setNotice('Could not record usage right now.'))
            }}
          >
            Record now
          </button>
        </span>
      }
    >
      <UsageCardView usage={usage?.cards.find(card => card.instanceId === selected?.instanceId)?.usage} />
      <UsageHistoryChart points={history} days={historyDays} />
    </Section>
  )
}
