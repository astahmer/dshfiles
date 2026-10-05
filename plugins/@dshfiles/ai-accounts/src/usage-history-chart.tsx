import styles from './accounts.module.css'

/**
 * Quota over time for one account.
 *
 * Drawn as an inline sparkline per window rather than a charting library: the
 * shape is one polyline per labelled window over a fixed time axis, which is
 * enough to answer "is it draining faster than it resets" without shipping a
 * dependency or a canvas the theme cannot restyle.
 */
export const UsageHistoryChart = (props: {
  readonly points: readonly { at: number; windows: Record<string, number> }[] | undefined
  readonly days: number
}): JSX.Element => {
  const points = props.points ?? []
  if (points.length < 2) {
    return <p className={styles.historyEmpty}>Not enough history yet. Quota is recorded on an interval; check back shortly.</p>
  }
  const labels = [...new Set(points.flatMap(point => Object.keys(point.windows)))]
  const from = points[0]?.at ?? Date.now()
  const span = Math.max(1, Date.now() - from)
  const width = 100
  const height = 24
  return (
    <div className={styles.history}>
      {labels.map(label => {
        const line = points
          .filter(point => point.windows[label] !== undefined)
          .map(point => {
            const x = ((point.at - from) / span) * width
            const remaining = point.windows[label] ?? 0
            const y = height - (Math.max(0, Math.min(100, remaining)) / 100) * height
            return `${x.toFixed(2)},${y.toFixed(2)}`
          })
          .join(' ')
        return (
          <div className={styles.historyRow} key={label}>
            <span className={styles.historyLabel}>{label}</span>
            <svg
              className={styles.historySvg}
              viewBox={`0 0 ${String(width)} ${String(height)}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={`${label} remaining over the last ${String(props.days)} days`}
            >
              <polyline className={styles.historyLine} points={line} />
            </svg>
          </div>
        )
      })}
      <div className={styles.historyAxis}>
        <span>{props.days}d ago</span>
        <span>now</span>
      </div>
    </div>
  )
}
