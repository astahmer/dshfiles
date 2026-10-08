import { useApi } from '@dshfiles/dshx/client'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@dshfiles/plugin-ui/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@dshfiles/plugin-ui/components/ui/collapsible'
import { Empty, EmptyDescription, EmptyHeader } from '@dshfiles/plugin-ui/components/ui/empty'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@dshfiles/plugin-ui/components/ui/table'
import { ChevronDownIcon, ChevronLeftIcon, RefreshCwIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { aiAccountsApi, type AccountsFile, type AccountsUsage, type UsageHistoryMeta, type UsageHistoryPoint } from './api.js'
import { MAX_USAGE_HISTORY_POINTS } from './usage-history-model.js'
import { changedBankedResetSnapshots, forecastQuotaWindow } from './usage-history-analysis.js'
import { QuotaMeter } from './panel-primitives.js'
import { QuotaHistoryChart } from './quota-history-chart.js'
import { QUOTA_TONE_TEXT, quotaTone } from './quota-tone.js'
import { formatResetIn } from './usage-overview-model.js'
import { usePreferences } from './use-preferences.js'

const RANGE_OPTIONS = [1, 3, 7, 14, 30, 90, 180, 365] as const
const INTERVAL_OPTIONS = Array.from({ length: 60 }, (_, index) => index + 1)
const RETENTION_OPTIONS = [30, 90, 180, 365] as const
const BANK_EVENT_LIMIT = 100

const formatTimestamp = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value) ? 'Not reported' : new Date(value).toLocaleString()

const formatReset = (value: number | null): string => formatResetIn(value, Date.now())

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

const CurrentQuota = (props: { accountId: string; usage: AccountsUsage | null }): JSX.Element => {
  const card = props.usage?.cards.find(value => value.instanceId === props.accountId)?.usage
  if (card === undefined) return <p className="dshx:text-xs dshx:text-muted-foreground">Current provider usage is not available for this account.</p>
  if (card.status !== 'ok') {
    return (
      <Alert variant="warning">
        <AlertDescription>{card.message ?? `Provider status: ${card.status}.`}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="dshx:grid dshx:grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] dshx:gap-2.5">
      {card.windows.map(window => (
        <QuotaMeter
          className="dshx:rounded-lg dshx:border dshx:bg-muted/30 dshx:p-3"
          detail={formatReset(window.resetsAt)}
          key={window.label}
          label={window.label}
          percent={window.percentRemaining}
        />
      ))}
      {card.bankedResets > 0 ? (
        <div className="dshx:flex dshx:flex-col dshx:gap-1.5 dshx:rounded-lg dshx:border dshx:border-info/30 dshx:bg-info/5 dshx:p-3">
          <div className="dshx:flex dshx:items-baseline dshx:justify-between dshx:gap-2">
            <span className="dshx:text-xs dshx:text-muted-foreground">Banked resets</span>
            <Badge variant="info">{String(card.bankedResets)}</Badge>
          </div>
          {card.bankedResetExpiries.length === 0 ? (
            <span className="dshx:text-xs dshx:text-muted-foreground">Individual expiry dates are not reported.</span>
          ) : (
            <ul className="dshx:flex dshx:flex-col dshx:gap-0.5 dshx:text-xs">
              {card.bankedResetExpiries.map((expiry, index) => (
                <li key={`${expiry ?? 'unknown'}:${index}`}>{expiry === null ? 'Expiry not reported' : `Expires ${formatTimestamp(expiry)}`}</li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}

const HistoryCard = (props: { readonly title: string; readonly description: string; readonly children: ReactNode }): JSX.Element => (
  <Card className="dshx:mx-auto dshx:w-full dshx:max-w-[1500px] dshx:gap-3 dshx:py-4">
    <CardHeader className="dshx:gap-1 dshx:px-4">
      <CardTitle className="dshx:text-sm">{props.title}</CardTitle>
      <CardDescription className="dshx:text-xs">{props.description}</CardDescription>
    </CardHeader>
    <CardContent className="dshx:px-4">{props.children}</CardContent>
  </Card>
)

const LabelledSelect = (props: {
  readonly label: string
  readonly ariaLabel?: string
  readonly value: string
  readonly disabled?: boolean
  readonly options: readonly { readonly value: string; readonly label: string }[]
  readonly onChange: (value: string) => void
}): JSX.Element => {
  const id = useId()
  return (
    <span className="dshx:flex dshx:flex-col dshx:gap-1">
      <Label className="dshx:text-xs dshx:font-normal dshx:text-muted-foreground" htmlFor={id}>
        {props.label}
      </Label>
      <Select disabled={props.disabled} onValueChange={props.onChange} value={props.value}>
        <SelectTrigger aria-label={props.ariaLabel} className="dshx:min-w-36" id={id} size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {props.options.map(option => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </span>
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
  const selectedQueryRef = useRef({ selectedId, days })
  const { usageRefreshMs } = usePreferences()

  useEffect(() => {
    selectedQueryRef.current = { selectedId, days }
  }, [selectedId, days])

  useEffect(() => {
    let live = true
    // Usage and history settings fail independently of the account list (an
    // older Host can lack either), so one failure does not blank the page.
    void Promise.all([accounts.read(), accounts.usage().catch(() => null), accounts.historySettings().catch(() => null)])
      .then(([nextFile, nextUsage, nextSettings]) => {
        if (!live) return
        setFile(nextFile)
        setUsage(nextUsage)
        setSettings(nextSettings)
        setSelectedId(current => current || nextFile.accounts.find(account => account.enabled)?.instanceId || nextFile.accounts[0]?.instanceId || '')
      })
      .catch(() => {
        if (live) setNotice('Usage data could not be loaded.')
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [accounts])

  useEffect(() => {
    let live = true
    if (selectedId === '') {
      setPoints([])
      return () => {
        live = false
      }
    }
    setPoints([])
    setLoading(true)
    void accounts
      .history({ instanceId: selectedId, days })
      .then(result => {
        if (live) setPoints(result.points)
      })
      .catch(() => {
        if (live) {
          setPoints([])
          setNotice('Quota history could not be loaded.')
        }
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [accounts, selectedId, days])

  // Stored history grows on the Host's schedule, so reread it with the live
  // quota rather than only when the selection changes.
  useEffect(() => {
    let live = true
    const refresh = () => {
      void accounts
        .usage()
        .then(next => {
          if (live) setUsage(next)
        })
        .catch(() => undefined)
      const query = selectedQueryRef.current
      if (query.selectedId === '') return
      void accounts
        .history({ instanceId: query.selectedId, days: query.days })
        .then(result => {
          const latest = selectedQueryRef.current
          if (live && latest.selectedId === query.selectedId && latest.days === query.days) setPoints(result.points)
        })
        .catch(() => undefined)
    }
    const timer = setInterval(refresh, usageRefreshMs)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [accounts, usageRefreshMs])

  const selected = useMemo(() => file?.accounts.find(account => account.instanceId === selectedId), [file, selectedId])
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
    const query = { selectedId, days }
    setRefreshing(true)
    setNotice(null)
    try {
      const result = await accounts.collectUsage()
      const [nextUsage, nextSettings, nextHistory] = await Promise.all([
        accounts.refreshUsage().catch(() => accounts.usage()),
        accounts.historySettings(),
        query.selectedId === '' ? Promise.resolve({ points: [] as UsageHistoryPoint[] }) : accounts.history({ instanceId: query.selectedId, days: query.days }),
      ])
      setUsage(nextUsage)
      setSettings(nextSettings)
      if (selectedQueryRef.current.selectedId === query.selectedId && selectedQueryRef.current.days === query.days) {
        setPoints(nextHistory.points)
      }
      setNotice(
        result.recorded > 0
          ? `Recorded quota for ${String(result.recorded)} account${result.recorded === 1 ? '' : 's'}.`
          : 'No new quota readings were available.',
      )
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
    <main className="dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:w-full dshx:flex-col dshx:gap-4 dshx:overflow-auto dshx:px-6 dshx:py-5">
      <header className="dshx:mx-auto dshx:flex dshx:w-full dshx:max-w-[1500px] dshx:flex-wrap dshx:items-end dshx:justify-between dshx:gap-4">
        <div className="dshx:flex dshx:flex-col dshx:items-start dshx:gap-1">
          <Button className="dshx:-ml-2 dshx:text-muted-foreground" onClick={props.onBack} size="xs" type="button" variant="ghost">
            <ChevronLeftIcon />
            AI Accounts
          </Button>
          <h1 className="dshx:text-xl dshx:font-semibold dshx:tracking-tight">Usage history</h1>
          <p className="dshx:text-sm dshx:text-muted-foreground">
            Quota snapshots, observed depletion pace, and banked reset changes for each configured account.
          </p>
        </div>
        <div className="dshx:flex dshx:flex-wrap dshx:items-end dshx:gap-2">
          <LabelledSelect
            ariaLabel="Usage history account"
            label="Account"
            onChange={nextId => {
              selectedQueryRef.current = { ...selectedQueryRef.current, selectedId: nextId }
              setSelectedId(nextId)
            }}
            options={(file?.accounts ?? []).map(account => ({ value: account.instanceId, label: account.displayName || account.instanceId }))}
            value={selectedId}
          />
          <LabelledSelect
            ariaLabel="Usage history range"
            label="Range"
            onChange={value => {
              const nextDays = Number(value)
              selectedQueryRef.current = { ...selectedQueryRef.current, days: nextDays }
              setDays(nextDays)
            }}
            options={RANGE_OPTIONS.map(option => ({ value: String(option), label: `${String(option)} days` }))}
            value={String(days)}
          />
          <Button disabled={refreshing || selectedId === ''} onClick={() => void recordNow()} size="sm" type="button" variant="outline">
            {refreshing ? <Spinner /> : <RefreshCwIcon />}
            {refreshing ? 'Recording…' : 'Record now'}
          </Button>
        </div>
      </header>

      {notice === null ? null : (
        <Alert className="dshx:mx-auto dshx:max-w-[1500px]" role="status" variant="info">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      {loading && points.length === 0 ? (
        <p className="dshx:mx-auto dshx:flex dshx:w-full dshx:max-w-[1500px] dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-muted-foreground">
          <Spinner className="dshx:size-3.5" />
          Loading usage history…
        </p>
      ) : null}
      {selected === undefined ? (
        <Empty className="dshx:mx-auto dshx:w-full dshx:max-w-[1500px] dshx:flex-none dshx:border">
          <EmptyHeader>
            <EmptyDescription>Add an account to start collecting usage history.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <Collapsible className="dshx:mx-auto dshx:w-full dshx:max-w-[1500px] dshx:rounded-lg dshx:border dshx:bg-card">
            <CollapsibleTrigger className="dshx:group dshx:flex dshx:w-full dshx:items-center dshx:justify-between dshx:gap-2 dshx:px-4 dshx:py-2.5 dshx:text-left dshx:text-sm dshx:font-medium">
              Collection and retention
              <ChevronDownIcon className="dshx:size-4 dshx:text-muted-foreground dshx:transition-transform dshx:group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="dshx:flex dshx:flex-col dshx:gap-3 dshx:border-t dshx:px-4 dshx:py-3">
              <div className="dshx:flex dshx:flex-wrap dshx:gap-3">
                <LabelledSelect
                  disabled={savingSettings || settings === null}
                  label="Provider polling"
                  onChange={value => void saveSettings({ intervalMinutes: Number(value) })}
                  options={INTERVAL_OPTIONS.map(value => ({ value: String(value), label: `Every ${String(value)} minute${value === 1 ? '' : 's'}` }))}
                  value={String(settings?.intervalMinutes ?? 5)}
                />
                <LabelledSelect
                  disabled={savingSettings || settings === null}
                  label="Keep quota snapshots"
                  onChange={value => void saveSettings({ retentionDays: Number(value) })}
                  options={RETENTION_OPTIONS.map(value => ({ value: String(value), label: `${String(value)} days` }))}
                  value={String(settings?.retentionDays ?? 90)}
                />
              </div>
              <p className="dshx:text-xs dshx:text-muted-foreground">
                Snapshots contain quota percentages, reset times, and reset-bank expiry metadata. They do not store provider credentials or response bodies.
              </p>
              <p className="dshx:text-xs dshx:text-muted-foreground">
                Last successful read: {formatTimestamp(settings?.lastReadAt)} · Last attempt: {formatTimestamp(settings?.lastAttemptAt)}
              </p>
            </CollapsibleContent>
          </Collapsible>

          <HistoryCard description={`${selected.displayName || selected.instanceId}${selected.kind ? ` · ${selected.kind}` : ''}`} title="Current limits">
            <CurrentQuota accountId={selectedId} usage={usage} />
          </HistoryCard>

          <HistoryCard
            description="Linear estimates use recent snapshots from the current reset cycle. They are a guide, not provider forecasts."
            title="Usage pace"
          >
            {forecasts.length === 0 ? (
              <p className="dshx:text-xs dshx:text-muted-foreground">A current quota reading is not available for this account.</p>
            ) : (
              <div className="dshx:grid dshx:grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] dshx:gap-2.5">
                {forecasts.map(entry => (
                  <article className="dshx:flex dshx:flex-col dshx:gap-1.5 dshx:rounded-lg dshx:border dshx:bg-muted/30 dshx:p-3" key={entry.label}>
                    <div className="dshx:flex dshx:items-baseline dshx:justify-between dshx:gap-2">
                      <strong className="dshx:text-sm dshx:font-semibold">{entry.label}</strong>
                      <span className={cn('dshx:text-xs dshx:font-medium dshx:tabular-nums', QUOTA_TONE_TEXT[quotaTone(entry.remaining)])}>
                        {String(entry.remaining)}% left
                      </span>
                    </div>
                    <p className="dshx:text-xs">{formatForecast(entry.forecast)}</p>
                    {'percentPerHour' in entry.forecast ? (
                      <small className="dshx:text-xs dshx:text-muted-foreground">
                        Observed change: {entry.forecast.percentPerHour.toFixed(1)} percentage points/hour · {String(entry.forecast.sampleCount)} snapshots
                      </small>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </HistoryCard>

          <HistoryCard
            description={
              points.length >= MAX_USAGE_HISTORY_POINTS
                ? `Showing up to ${String(MAX_USAGE_HISTORY_POINTS)} sampled readings from the last ${String(days)} days.`
                : `${String(points.length)} snapshots in the last ${String(days)} days.`
            }
            title="Quota over time"
          >
            <div className="dshx:flex dshx:flex-col dshx:gap-2">
              <QuotaHistoryChart
                ariaLabel={`Remaining quota history from ${formatTimestamp(points[0]?.at)} to ${formatTimestamp(points.at(-1)?.at)}`}
                emptyMessage="Not enough quota snapshots yet. The collector records on the selected interval."
                height={240}
                points={points}
              />
              <p className="dshx:text-xs dshx:text-muted-foreground">Lines break at provider reset boundaries; each point is a stored quota reading.</p>
            </div>
          </HistoryCard>

          <HistoryCard
            description={`${String(resetCount)} reset credits in the latest snapshot across ${String(points.length)} quota snapshots.`}
            title="Banked reset history"
          >
            {bankChanges.length === 0 || !bankChanges.some(point => point.bankedResets > 0) ? (
              <p className="dshx:text-xs dshx:text-muted-foreground">This provider has not reported banked resets in the selected period.</p>
            ) : (
              <div className="dshx:flex dshx:flex-col dshx:gap-2">
                <Table className="dshx:text-xs">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Recorded</TableHead>
                      <TableHead>Balance</TableHead>
                      <TableHead>Individual expiry dates</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bankChanges.map(point => {
                      const expiries = point.bankedResetExpiries ?? []
                      const unknown = Math.max(0, point.bankedResets - expiries.length)
                      return (
                        <TableRow key={point.at}>
                          <TableCell className="dshx:align-top dshx:text-muted-foreground">{formatTimestamp(point.at)}</TableCell>
                          <TableCell className="dshx:align-top dshx:font-medium dshx:tabular-nums">{String(point.bankedResets)}</TableCell>
                          <TableCell>
                            <span className="dshx:flex dshx:flex-wrap dshx:gap-1">
                              {expiries.length === 0 ? (
                                <span className="dshx:text-muted-foreground">No individual expiries reported</span>
                              ) : (
                                expiries.map((expiry, index) => (
                                  <Badge key={`${expiry ?? 'unknown'}:${index}`} variant="muted">
                                    {expiry === null ? 'Expiry not reported' : formatTimestamp(expiry)}
                                  </Badge>
                                ))
                              )}
                              {unknown > 0 ? (
                                <Badge variant="outline">
                                  {String(unknown)} reset{unknown === 1 ? '' : 's'} without a reported expiry
                                </Badge>
                              ) : null}
                            </span>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
                {changedBankedResetSnapshots(points).length > BANK_EVENT_LIMIT ? (
                  <p className="dshx:text-xs dshx:text-muted-foreground">Showing the latest {String(BANK_EVENT_LIMIT)} reset-bank changes.</p>
                ) : null}
              </div>
            )}
          </HistoryCard>
        </>
      )}
    </main>
  )
}
