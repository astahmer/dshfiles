import { useApi } from '@dshfiles/dshx/client'
import { useEffect, useMemo, useState } from 'react'
import {
  aiAccountsApi,
  type AccountsFile,
  type AccountsUsage,
  type UsageHistoryMeta,
  type UsageHistoryPoint,
} from './api.js'
import { changedBankedResetSnapshots, forecastQuotaWindow, quotaHistoryCycles } from './usage-history-analysis.js'
import styles from './accounts.module.css'

const RANGE_OPTIONS = [1, 3, 7, 14, 30, 90] as const
const INTERVAL_OPTIONS = [5, 15, 30, 60] as const
const RETENTION_OPTIONS = [30, 90, 180, 365] as const
const CHART_POINT_LIMIT = 500
const BANK_EVENT_LIMIT = 100

const formatTimestamp = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? 'Not reported'
    : new Date(value).toLocaleString()

const formatReset = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return 'Reset time unavailable'
  const remaining = value - Date.now()
  if (remaining <= 0) return 'Resetting now'
  const minutes = Math.floor(remaining / 60_000)
  const days = Math.floor(minutes / (24 * 60))
  return days > 0
    ? `Resets in ${String(days)}d ${String(Math.floor(minutes / 60) % 24)}h`
    : `Resets in ${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`
}

const formatForecast = (forecast: ReturnType<typeof forecastQuotaWindow>): string => {
  switch (forecast.status) {
    case 'insufficient-history':
      return 'Need at least three snapshots spanning 30 minutes in this reset window.'
    case 'reset-due':
      return 'The provider reset time has passed; wait for its next quota reading.'
    case 'no-depletion':
      return 'No depletion trend appears in the recent snapshots.'
    case 'estimated-depletion':
      return `At the observed pace, estimated depletion is ${formatTimestamp(forecast.estimatedAt)}.`
    case 'depletes-before-reset':
      return `At the observed pace, quota may run out ${formatTimestamp(forecast.estimatedAt)}, before the provider reset.`
    case 'reset-before-depletion':
      return `The provider reset is expected before the current pace reaches zero (pace estimate ${formatTimestamp(forecast.estimatedAt)}).`
  }
}

const downsample = <T,>(values: readonly T[], limit: number): readonly T[] => {
  if (values.length <= limit) return values
  if (limit < 2) return values.slice(-limit)
  const last = values.length - 1
  return Array.from({ length: limit }, (_, index) => values[Math.round(index * last / (limit - 1))])
    .filter((value): value is T => value !== undefined)
}

const QuotaHistoryPlot = (props: { points: readonly UsageHistoryPoint[] }): JSX.Element => {
  const labels = [...new Set(props.points.flatMap(point => Object.keys(point.windows)))]
  if (props.points.length < 2 || labels.length === 0) {
    return <p className={styles.historyEmpty}>Not enough quota snapshots yet. The collector records on the selected interval.</p>
  }

  const start = props.points[0]?.at ?? 0
  const end = props.points.at(-1)?.at ?? start
  const span = Math.max(1, end - start)
  const colors = [
    'var(--dsw-alias-brand-primary)',
    'var(--dsw-alias-state-success-primary)',
    'var(--dsw-alias-state-warn-primary)',
    'var(--dsw-alias-state-error-primary)',
    'var(--dsw-alias-label-primary)',
  ]

  return (
    <div className={styles.historyPlotWrap}>
      <svg
        className={styles.historyPlot}
        viewBox="0 0 1000 140"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Remaining quota history from ${formatTimestamp(start)} to ${formatTimestamp(end)}`}
      >
        {[0, 25, 50, 75, 100].map(percent => (
          <g key={percent}>
            <line x1="0" x2="1000" y1={140 - percent * 1.3} y2={140 - percent * 1.3} className={styles.historyGrid} />
            <text x="0" y={136 - percent * 1.3} className={styles.historyAxisLabel}>{String(percent)}%</text>
          </g>
        ))}
        {labels.map((label, index) => {
          const cycles = quotaHistoryCycles(props.points, label)
          const perCycleLimit = Math.max(2, Math.floor(CHART_POINT_LIMIT / Math.max(1, cycles.length)))
          return cycles.map((cycle, cycleIndex) => {
            const plotted = downsample(cycle, perCycleLimit)
            const color = colors[index % colors.length] ?? colors[0]
            const coords = plotted.map(point => {
              const x = ((point.at - start) / span) * 1000
              const percent = point.windows[label] ?? 0
              const y = 140 - Math.max(0, Math.min(100, percent)) * 1.3
              return `${x.toFixed(2)},${y.toFixed(2)}`
            }).join(' ')
            return (
              <g key={`${label}:${cycle[0]?.resetsAt[label] ?? 'unknown'}:${cycleIndex}`}>
                {plotted.length > 1 ? <polyline points={coords} className={styles.historyPlotLine} style={{ stroke: color }} /> : null}
                {plotted.map(point => {
                  const x = ((point.at - start) / span) * 1000
                  const percent = point.windows[label] ?? 0
                  const y = 140 - Math.max(0, Math.min(100, percent)) * 1.3
                  return <circle key={point.at} cx={x} cy={y} r="2.2" style={{ fill: color }}><title>{`${label}: ${String(percent)}% remaining · ${formatTimestamp(point.at)}`}</title></circle>
                })}
              </g>
            )
          })
        })}
      </svg>
      <div className={styles.historyLegend}>
        {labels.map((label, index) => <span key={label}><i style={{ background: colors[index % colors.length] ?? colors[0] }} />{label}</span>)}
      </div>
      <div className={styles.historyAxis}><span>{formatTimestamp(start)}</span><span>{formatTimestamp(end)}</span></div>
      <p className={styles.historyFootnote}>Lines break at provider reset boundaries; each point is a stored quota reading.</p>
    </div>
  )
}

const CurrentQuota = (props: { accountId: string; usage: AccountsUsage | null }): JSX.Element => {
  const card = props.usage?.cards.find(value => value.instanceId === props.accountId)?.usage
  if (card === undefined) return <p className={styles.historyEmpty}>Current provider usage is not available for this account.</p>
  if (card.status !== 'ok') return <p className={styles.historyNotice}>{card.message ?? `Provider status: ${card.status}.`}</p>

  return (
    <div className={styles.historyCurrentGrid}>
      {card.windows.map(window => (
        <article className={styles.historyCurrentCard} key={window.label}>
          <div className={styles.historyCurrentHeading}><strong>{window.label}</strong><span>{String(window.percentRemaining)}% left</span></div>
          <div className={styles.historyCurrentTrack} role="progressbar" aria-label={`${window.label} remaining`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={window.percentRemaining}>
            <span style={{ width: `${Math.max(0, Math.min(100, window.percentRemaining))}%` }} />
          </div>
          <small>{formatReset(window.resetsAt)}</small>
        </article>
      ))}
      {card.bankedResets > 0 ? (
        <article className={styles.historyCurrentCard}>
          <div className={styles.historyCurrentHeading}><strong>Banked resets</strong><span>{String(card.bankedResets)}</span></div>
          {card.bankedResetExpiries.length === 0 ? <small>Individual expiry dates are not reported.</small> : (
            <ul className={styles.historyExpiryList}>
              {card.bankedResetExpiries.map((expiry, index) => <li key={`${expiry ?? 'unknown'}:${index}`}>{expiry === null ? 'Expiry not reported' : `Expires ${formatTimestamp(expiry)}`}</li>)}
            </ul>
          )}
        </article>
      ) : null}
    </div>
  )
}

export const UsageHistoryPanel = (props: { readonly onBack: () => void }): JSX.Element => {
  const accounts = useApi(aiAccountsApi)
  const [file, setFile] = useState<AccountsFile | null>(null)
  const [usage, setUsage] = useState<AccountsUsage | null>(null)
  const [settings, setSettings] = useState<UsageHistoryMeta | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [days, setDays] = useState(7)
  const [points, setPoints] = useState<readonly UsageHistoryPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void Promise.all([accounts.read(), accounts.usage(), accounts.historySettings()])
      .then(([nextFile, nextUsage, nextSettings]) => {
        if (!live) return
        setFile(nextFile)
        setUsage(nextUsage)
        setSettings(nextSettings)
        setSelectedId(current => current || nextFile.accounts.find(account => account.enabled)?.instanceId || nextFile.accounts[0]?.instanceId || '')
      })
      .catch(() => { if (live) setNotice('Usage data could not be loaded.') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [accounts])

  useEffect(() => {
    let live = true
    if (selectedId === '') {
      setPoints([])
      return () => { live = false }
    }
    setLoading(true)
    void accounts.history({ instanceId: selectedId, days })
      .then(result => { if (live) setPoints(result.points) })
      .catch(() => { if (live) { setPoints([]); setNotice('Quota history could not be loaded.') } })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [accounts, selectedId, days])

  useEffect(() => {
    let live = true
    const refresh = () => void accounts.usage().then(next => { if (live) setUsage(next) }).catch(() => undefined)
    const timer = setInterval(refresh, 60_000)
    return () => { live = false; clearInterval(timer) }
  }, [accounts])

  const selected = useMemo(
    () => file?.accounts.find(account => account.instanceId === selectedId),
    [file, selectedId],
  )
  const current = usage?.cards.find(card => card.instanceId === selectedId)?.usage
  const forecasts = useMemo(() => {
    if (current?.status !== 'ok') return []
    return current.windows.map(window => ({
      label: window.label,
      remaining: window.percentRemaining,
      forecast: forecastQuotaWindow({
        points,
        label: window.label,
        remainingPercent: window.percentRemaining,
        resetsAt: window.resetsAt,
        now: Date.now(),
      }),
    }))
  }, [current, points])
  const bankChanges = useMemo(() => changedBankedResetSnapshots(points).slice(-BANK_EVENT_LIMIT).reverse(), [points])

  const recordNow = async (): Promise<void> => {
    setRefreshing(true)
    setNotice(null)
    try {
      await accounts.collectUsage()
      const [nextUsage, nextSettings, nextHistory] = await Promise.all([
        accounts.usage(),
        accounts.historySettings(),
        selectedId === '' ? Promise.resolve({ points: [] as UsageHistoryPoint[] }) : accounts.history({ instanceId: selectedId, days }),
      ])
      setUsage(nextUsage)
      setSettings(nextSettings)
      setPoints(nextHistory.points)
      setNotice('Usage history recorded.')
    } catch {
      setNotice('Could not record usage right now. Check the provider sign-in and try again.')
    } finally {
      setRefreshing(false)
    }
  }

  const saveSettings = async (patch: Partial<Pick<UsageHistoryMeta, 'intervalMinutes' | 'retentionDays'>>): Promise<void> => {
    if (settings === null) return
    setSavingSettings(true)
    setNotice(null)
    try {
      const next = await accounts.saveHistorySettings({
        intervalMinutes: patch.intervalMinutes ?? settings.intervalMinutes,
        retentionDays: patch.retentionDays ?? settings.retentionDays,
      })
      setSettings(next)
      setNotice('Usage history settings saved.')
    } catch {
      setNotice('Usage history settings could not be saved.')
    } finally {
      setSavingSettings(false)
    }
  }

  const resetCount = points.at(-1)?.bankedResets ?? 0

  return (
    <main className={styles.usageHistoryPage}>
      <header className={styles.usageHistoryHeader}>
        <div>
          <button type="button" className={styles.historyBack} onClick={props.onBack}>← AI Accounts</button>
          <h1 className={styles.title}>Usage history</h1>
          <p className={styles.subtitle}>Quota snapshots, observed depletion pace, and banked reset changes for each configured account.</p>
        </div>
        <div className={styles.historyControls}>
          <label>
            <span>Account</span>
            <select value={selectedId} onChange={event => setSelectedId(event.target.value)} aria-label="Usage history account">
              {(file?.accounts ?? []).map(account => <option value={account.instanceId} key={account.instanceId}>{account.displayName || account.instanceId}</option>)}
            </select>
          </label>
          <label>
            <span>Range</span>
            <select value={String(days)} onChange={event => setDays(Number(event.target.value))} aria-label="Usage history range">
              {RANGE_OPTIONS.map(option => <option key={option} value={String(option)}>{String(option)} days</option>)}
            </select>
          </label>
          <button type="button" className={styles.secondary} disabled={refreshing || selectedId === ''} onClick={() => void recordNow()}>
            {refreshing ? 'Recording…' : 'Record now'}
          </button>
        </div>
      </header>

      {notice === null ? null : <p className={styles.historyNotice} role="status">{notice}</p>}
      {loading && points.length === 0 ? <p className={styles.historyEmpty}>Loading usage history…</p> : null}
      {selected === undefined ? <p className={styles.empty}>Add an account to start collecting usage history.</p> : <>
        <details className={styles.historySettings}>
          <summary>Collection and retention</summary>
          <div className={styles.historySettingsBody}>
            <label><span>Provider polling</span><select disabled={savingSettings || settings === null} value={String(settings?.intervalMinutes ?? 15)} onChange={event => void saveSettings({ intervalMinutes: Number(event.target.value) })}>{INTERVAL_OPTIONS.map(value => <option key={value} value={String(value)}>Every {String(value)} minutes</option>)}</select></label>
            <label><span>Keep quota snapshots</span><select disabled={savingSettings || settings === null} value={String(settings?.retentionDays ?? 90)} onChange={event => void saveSettings({ retentionDays: Number(event.target.value) })}>{RETENTION_OPTIONS.map(value => <option key={value} value={String(value)}>{String(value)} days</option>)}</select></label>
            <p>Snapshots contain quota percentages, reset times, and reset-bank expiry metadata. They do not store provider credentials or response bodies.</p>
            <p>Last successful read: {formatTimestamp(settings?.lastReadAt)} · Last attempt: {formatTimestamp(settings?.lastAttemptAt)}</p>
          </div>
        </details>

        <section className={styles.historyBlock}>
          <div className={styles.historyBlockHeading}><div><h2>Current limits</h2><p>{selected.displayName || selected.instanceId}{selected.kind ? ` · ${selected.kind}` : ''}</p></div></div>
          <CurrentQuota accountId={selectedId} usage={usage} />
        </section>

        <section className={styles.historyBlock}>
          <div className={styles.historyBlockHeading}><div><h2>Usage pace</h2><p>Linear estimates use recent snapshots from the current reset cycle. They are a guide, not provider forecasts.</p></div></div>
          {forecasts.length === 0 ? <p className={styles.historyEmpty}>A current quota reading is not available for this account.</p> : (
            <div className={styles.historyForecastGrid}>
              {forecasts.map(entry => <article className={styles.historyForecast} key={entry.label}>
                <div><strong>{entry.label}</strong><span>{String(entry.remaining)}% left</span></div>
                <p>{formatForecast(entry.forecast)}</p>
                {'percentPerHour' in entry.forecast ? <small>Observed change: {entry.forecast.percentPerHour.toFixed(1)} percentage points/hour · {String(entry.forecast.sampleCount)} snapshots</small> : null}
              </article>)}
            </div>
          )}
        </section>

        <section className={styles.historyBlock}>
          <div className={styles.historyBlockHeading}><div><h2>Quota over time</h2><p>{String(points.length)} snapshots in the last {String(days)} days.</p></div></div>
          <QuotaHistoryPlot points={points} />
        </section>

        <section className={styles.historyBlock}>
          <div className={styles.historyBlockHeading}><div><h2>Banked reset history</h2><p>{String(resetCount)} reset credits in the latest snapshot across {String(points.length)} quota snapshots.</p></div></div>
          {bankChanges.length === 0 || !bankChanges.some(point => point.bankedResets > 0) ? (
            <p className={styles.historyEmpty}>This provider has not reported banked resets in the selected period.</p>
          ) : (
            <div className={styles.historyTableWrap}>
              <table className={styles.historyTable}>
                <thead><tr><th>Recorded</th><th>Balance</th><th>Individual expiry dates</th></tr></thead>
                <tbody>{bankChanges.map(point => {
                  const expiries = point.bankedResetExpiries ?? []
                  const unknown = Math.max(0, point.bankedResets - expiries.length)
                  return <tr key={point.at}>
                    <td>{formatTimestamp(point.at)}</td>
                    <td>{String(point.bankedResets)}</td>
                    <td>
                      {expiries.length === 0 ? 'No individual expiries reported' : expiries.map((expiry, index) => <span className={styles.historyExpiry} key={`${expiry ?? 'unknown'}:${index}`}>{expiry === null ? 'Expiry not reported' : formatTimestamp(expiry)}</span>)}
                      {unknown > 0 ? <span className={styles.historyExpiry}>{String(unknown)} reset{unknown === 1 ? '' : 's'} without a reported expiry</span> : null}
                    </td>
                  </tr>
                })}</tbody>
              </table>
              {changedBankedResetSnapshots(points).length > BANK_EVENT_LIMIT ? <p className={styles.historyFootnote}>Showing the latest {String(BANK_EVENT_LIMIT)} reset-bank changes.</p> : null}
            </div>
          )}
        </section>
      </>}
    </main>
  )
}
