import type { UsageCard } from './api.js'
import styles from './accounts.module.css'

/** Percent remaining, coloured by how much is left rather than by provider. */
const remainingTone = (percent: number): string => (percent <= 10 ? String(styles.barCritical) : percent <= 30 ? String(styles.barLow) : String(styles.barOk))

const formatReset = (resetsAt: number | null): string | null => {
  if (resetsAt === null || Number.isNaN(resetsAt)) return null
  const minutes = Math.max(0, Math.round((resetsAt - Date.now()) / 60_000))
  if (minutes < 60) return `Resets in ${String(minutes)}m`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `Resets in ${String(hours)}h`
  return `Resets in ${String(Math.round(hours / 24))}d`
}

export const UsageCardView = (props: { readonly usage: UsageCard | undefined }): JSX.Element | null => {
  const usage = props.usage
  if (usage === undefined || usage.status !== 'ok' || usage.windows.length === 0) return null
  return (
    <div className={styles.usageCard}>
      {usage.windows.map(window => (
        <div className={styles.usageWindow} key={window.label}>
          <div className={styles.usageRow}>
            <span className={styles.usageLabel}>{window.label}</span>
            <span className={styles.usagePercent}>{window.percentRemaining}% left</span>
          </div>
          <div className={styles.usageTrack}>
            <div
              className={`${styles.usageBar} ${remainingTone(window.percentRemaining)}`}
              style={{ width: `${String(Math.max(0, Math.min(100, window.percentRemaining)))}%` }}
            />
          </div>
          {formatReset(window.resetsAt) === null ? null : <div className={styles.usageReset}>{formatReset(window.resetsAt)}</div>}
        </div>
      ))}
      {usage.bankedResets > 0 ? (
        <div className={styles.usageBanked}>
          {String(usage.bankedResets)} banked reset{usage.bankedResets === 1 ? '' : 's'}
          {usage.bankedResetExpiries
            .filter((expiresAt): expiresAt is number => expiresAt !== null)
            .sort((left, right) => left - right)
            .map(expiresAt => ` · earliest expires ${new Date(expiresAt).toLocaleDateString()}`)
            .join('')}
        </div>
      ) : null}
    </div>
  )
}
