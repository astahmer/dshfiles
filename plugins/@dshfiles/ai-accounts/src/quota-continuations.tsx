import { useApi } from '@dshfiles/dshx/client'
import { useCallback, useEffect, useState } from 'react'
import { aiAccountsApi } from './api.js'
import type { QuotaContinuationSummary } from './quota-continuation-model.js'
import styles from './accounts.module.css'

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
    <div className={styles.continuationList} aria-label="Quota recovery" aria-busy={loading} role="region">
      <div className={styles.continuationHeader}>
        <strong>Quota recovery</strong>
        <button type="button" className={styles.quiet} disabled={loading} onClick={() => void load()}>
          {loading ? 'Checking…' : 'Refresh'}
        </button>
      </div>
      {notice === null ? null : (
        <p className={styles.historyEmpty} role="status">
          {notice}
        </p>
      )}
      {visible.length === 0 ? (
        <p className={styles.historyEmpty}>{loading ? 'Checking for blocked Sessions…' : 'No pending quota recoveries for this account.'}</p>
      ) : (
        visible.map(item => {
          const busy = busyId === item.continuationId
          const targetTime = Math.max(item.resetAt ?? 0, item.snoozedUntil ?? 0)
          const resetStatus = item.resetAt === null ? 'Reset time unknown.' : `Known reset ${formatTime(item.resetAt)}.`
          const scheduleStatus = item.scheduled
            ? `Automatic resume expected ${formatTime(targetTime)}.`
            : scheduleAvailable
              ? 'No automatic timer is set; resume manually.'
              : 'Schedule service is not loaded; resume manually.'

          return (
            <article className={styles.continuationItem} key={item.continuationId}>
              <div className={styles.continuationCopy}>
                <strong>Session {item.sessionId}</strong>
                <span className={styles.continuationMeta}>
                  {item.state === 'queued' ? 'Recovery prompt queued.' : item.ready ? 'Reset time passed; ready for manual recovery.' : 'Quota-blocked turn.'}
                </span>
                <span className={styles.continuationMeta}>{resetStatus}</span>
                <span className={styles.continuationMeta}>{scheduleStatus}</span>
                {item.snoozedUntil === null ? null : (
                  <span className={styles.continuationMeta}>Snoozed until {formatTime(item.snoozedUntil)}.</span>
                )}
              </div>
              <div className={styles.continuationActions}>
                {item.state === 'waiting' ? (
                  <>
                    <button
                      type="button"
                      className={styles.quiet}
                      disabled={busyId !== null}
                      onClick={() => void resume(item.continuationId)}
                    >
                      {busy ? 'Queueing…' : 'Resume now'}
                    </button>
                    <button
                      type="button"
                      className={styles.quiet}
                      disabled={busyId !== null}
                      onClick={() => void snooze(item.continuationId, 'one-hour')}
                    >
                      Snooze 1h
                    </button>
                    <button
                      type="button"
                      className={styles.quiet}
                      disabled={busyId !== null}
                      onClick={() => void snooze(item.continuationId, 'four-hours')}
                    >
                      Snooze 4h
                    </button>
                    <button
                      type="button"
                      className={styles.quiet}
                      disabled={busyId !== null}
                      onClick={() => void snooze(item.continuationId, 'one-day')}
                    >
                      Snooze 1 day
                    </button>
                    {item.snoozedUntil === null ? null : (
                      <button
                        type="button"
                        className={styles.quiet}
                        disabled={busyId !== null}
                        onClick={() => void snooze(item.continuationId, 'unsnooze')}
                      >
                        Unsnooze
                      </button>
                    )}
                  </>
                ) : null}
              </div>
            </article>
          )
        })
      )}
    </div>
  )
}
