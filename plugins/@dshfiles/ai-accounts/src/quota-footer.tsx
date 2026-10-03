import { useApi } from '@dshfiles/dshx/client'
import { useEffect, useState } from 'react'
import { aiAccountsApi, type AccountsUsage } from './api.js'
import styles from './accounts.module.css'

/**
 * Quota in the sidebar foot.
 *
 * The footer owns its whole surface, so this is its own disclosure rather than a
 * control that opens something: the number you want without navigating. It shows
 * only the tightest window per account, because a foot affordance that lists six
 * rows is a panel wearing a hat.
 *
 * Nothing renders until an account actually reports quota, so an unconfigured
 * profile shows no dangling empty state.
 */
export const QuotaFooter = (props: { readonly wide: boolean }): JSX.Element | null => {
  const accounts = useApi(aiAccountsApi)
  const [usage, setUsage] = useState<AccountsUsage | null>(null)

  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      void accounts
        .usage()
        .then(next => {
          if (!cancelled) setUsage(next)
        })
        .catch(() => undefined)
    }
    refresh()
    const timer = setInterval(refresh, 60_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [accounts])

  const rows = (usage?.cards ?? [])
    .map(card => {
      const tightest = card.usage.windows.reduce<
        { label: string; percent: number; resetsAt: number | null } | undefined
      >(
        (current, window) => {
          if (current !== undefined && current.percent <= window.percentRemaining) return current
          return {
            label: window.label,
            percent: window.percentRemaining,
            resetsAt: window.resetsAt,
          }
        },
        undefined,
      )
      return { instanceId: card.instanceId, tightest }
    })
    .filter(row => row.tightest !== undefined)

  if (rows.length === 0) return null

  if (!props.wide) {
    // Rail: a dot per account, dimming as the tightest window drains.
    return (
      <div className={styles.footerRail} aria-label="Account quota">
        {rows.map(row => (
          <span
            key={row.instanceId}
            className={toneFor(row.tightest?.percent ?? 0)}
            title={`${row.instanceId}: ${String(row.tightest?.percent ?? 0)}% left`}
          />
        ))}
      </div>
    )
  }

  return (
    <div className={styles.footerWide} title="Tightest window per account. Open AI Accounts from the sidebar.">
      {rows.map(row => (
        <div className={styles.footerRow} key={row.instanceId}>
          <span className={styles.footerName}>{row.instanceId}</span>
          <span className={`${styles.footerBar} ${toneFor(row.tightest?.percent ?? 0)}`} />
          <span className={styles.footerPercent}>
            {String(row.tightest?.percent ?? 0)}%
          </span>
        </div>
      ))}
    </div>
  )
}

const toneFor = (percent: number): string =>
  percent <= 10
    ? String(styles.stateCritical)
    : percent <= 30
      ? String(styles.stateWarn)
      : String(styles.stateOk)
