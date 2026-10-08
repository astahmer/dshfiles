import { useApi } from '@dshfiles/dshx/client'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from '@dshfiles/plugin-ui/components/ui/item'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { RefreshCwIcon } from '@dshfiles/plugin-ui/icons'
import { useCallback, useEffect, useState } from 'react'
import { aiAccountsApi } from './api.js'
import type { QuotaContinuationSummary } from './quota-continuation-model.js'

const formatTime = (timestamp: number): string =>
  new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(timestamp)

export const QuotaContinuations = (props: { readonly accountId: string | null }): JSX.Element => {
  const accounts = useApi(aiAccountsApi)
  const [continuations, setContinuations] = useState<readonly QuotaContinuationSummary[]>([])
  const [scheduleAvailable, setScheduleAvailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const result = await accounts.quotaContinuations()
      setContinuations(result.continuations)
      setScheduleAvailable(result.scheduleAvailable)
      setNotice(null)
    } catch {
      setNotice('Quota recovery is unavailable right now.')
    } finally {
      setLoading(false)
    }
  }, [accounts])

  useEffect(() => {
    void load()
  }, [load])

  const resume = async (continuationId: string): Promise<void> => {
    setBusyId(continuationId)
    try {
      const result = await accounts.resumeQuotaContinuation({ continuationId })
      setNotice(result.accepted ? 'Recovery prompt queued.' : 'This recovery was superseded or its Session is unavailable.')
      await load()
    } catch {
      setNotice('Could not queue this recovery.')
    } finally {
      setBusyId(null)
    }
  }

  const snooze = async (continuationId: string, duration: 'one-hour' | 'four-hours' | 'one-day' | 'unsnooze'): Promise<void> => {
    setBusyId(continuationId)
    try {
      const result = await accounts.snoozeQuotaContinuation({ continuationId, duration })
      setNotice(result.updated ? 'Recovery timing updated.' : 'This recovery is already queued or no longer active.')
      await load()
    } catch {
      setNotice('Could not update recovery timing.')
    } finally {
      setBusyId(null)
    }
  }

  const visible = continuations.filter(item => props.accountId === null || item.accountId === props.accountId)

  return (
    <section
      aria-busy={loading}
      aria-label="Quota recovery"
      className="dshx:mx-auto dshx:flex dshx:w-full dshx:max-w-[1600px] dshx:flex-col dshx:gap-2 dshx:rounded-lg dshx:border dshx:bg-card dshx:px-3 dshx:py-2.5"
      role="region"
    >
      <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-3">
        <h2 className="dshx:text-sm dshx:font-semibold">Quota recovery</h2>
        <Button disabled={loading} onClick={() => void load()} size="xs" type="button" variant="ghost">
          {loading ? <Spinner className="dshx:size-3" /> : <RefreshCwIcon />}
          {loading ? 'Checking…' : 'Refresh'}
        </Button>
      </div>
      {notice === null ? null : (
        <p className="dshx:text-xs dshx:text-muted-foreground" role="status">
          {notice}
        </p>
      )}
      {visible.length === 0 ? (
        <p className="dshx:text-xs dshx:text-muted-foreground">
          {loading ? 'Checking for blocked Sessions…' : 'No pending quota recoveries for this account.'}
        </p>
      ) : (
        <ItemGroup className="dshx:gap-1.5">
          {visible.map(item => {
            const busy = busyId === item.continuationId
            const targetTime = Math.max(item.resetAt ?? 0, item.snoozedUntil ?? 0)
            const resetStatus = item.resetAt === null ? 'Reset time unknown.' : `Known reset ${formatTime(item.resetAt)}.`
            const scheduleStatus = item.scheduled
              ? `Automatic resume expected ${formatTime(targetTime)}.`
              : scheduleAvailable
                ? 'No automatic timer is set; resume manually.'
                : 'Schedule service is not loaded; resume manually.'
            const snoozes = [
              { duration: 'one-hour', label: 'Snooze 1h' },
              { duration: 'four-hours', label: 'Snooze 4h' },
              { duration: 'one-day', label: 'Snooze 1 day' },
            ] as const

            return (
              <Item className="dshx:items-start dshx:gap-3 dshx:px-3 dshx:py-2" key={item.continuationId} role="listitem" size="sm" variant="outline">
                <ItemContent className="dshx:min-w-0 dshx:gap-0.5">
                  <ItemTitle className="dshx:font-mono dshx:text-xs dshx:break-all">Session {item.sessionId}</ItemTitle>
                  <span className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-x-2 dshx:gap-y-1 dshx:text-xs dshx:text-muted-foreground">
                    <Badge variant={item.state === 'queued' ? 'info' : item.ready ? 'success' : 'warning'}>
                      {item.state === 'queued'
                        ? 'Recovery prompt queued.'
                        : item.ready
                          ? 'Reset time passed; ready for manual recovery.'
                          : 'Quota-blocked turn.'}
                    </Badge>
                    <span>{resetStatus}</span>
                    <span>{scheduleStatus}</span>
                    {item.snoozedUntil === null ? null : <span>Snoozed until {formatTime(item.snoozedUntil)}.</span>}
                  </span>
                </ItemContent>
                {item.state === 'waiting' ? (
                  <ItemActions className="dshx:flex-wrap dshx:justify-end dshx:gap-1.5">
                    <Button disabled={busyId !== null} onClick={() => void resume(item.continuationId)} size="xs" type="button">
                      {busy ? 'Queueing…' : 'Resume now'}
                    </Button>
                    {snoozes.map(snoozeOption => (
                      <Button
                        disabled={busyId !== null}
                        key={snoozeOption.duration}
                        onClick={() => void snooze(item.continuationId, snoozeOption.duration)}
                        size="xs"
                        type="button"
                        variant="outline"
                      >
                        {snoozeOption.label}
                      </Button>
                    ))}
                    {item.snoozedUntil === null ? null : (
                      <Button disabled={busyId !== null} onClick={() => void snooze(item.continuationId, 'unsnooze')} size="xs" type="button" variant="ghost">
                        Unsnooze
                      </Button>
                    )}
                  </ItemActions>
                ) : null}
              </Item>
            )
          })}
        </ItemGroup>
      )}
    </section>
  )
}
