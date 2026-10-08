import type { UsageCard } from './api.js'
import { QuotaMeter } from './panel-primitives.js'

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
  const earliestExpiry = usage.bankedResetExpiries.filter((expiresAt): expiresAt is number => expiresAt !== null).sort((left, right) => left - right)[0]
  return (
    <div className="dshx:grid dshx:gap-3 dshx:rounded-lg dshx:border dshx:bg-muted/30 dshx:p-3 dshx:md:grid-cols-2">
      {usage.windows.map(window => (
        <QuotaMeter detail={formatReset(window.resetsAt)} key={window.label} label={window.label} percent={window.percentRemaining} />
      ))}
      {usage.bankedResets > 0 ? (
        <p className="dshx:text-xs dshx:text-info dshx:md:col-span-2">
          {String(usage.bankedResets)} banked reset{usage.bankedResets === 1 ? '' : 's'}
          {earliestExpiry === undefined ? '' : ` · earliest expires ${new Date(earliestExpiry).toLocaleDateString()}`}
        </p>
      ) : null}
    </div>
  )
}
