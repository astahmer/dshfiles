import type { UsageCard } from './api.js'
import { QuotaMeter } from './panel-primitives.js'
import { UsageOverviewModel } from './usage-overview-model.js'

export const UsageCardView = (props: { readonly usage: UsageCard | undefined }): JSX.Element | null => {
  const usage = props.usage
  if (usage === undefined) return null
  if (usage.status !== 'ok' || usage.windows.length === 0) {
    return (
      <p className="dshx:rounded-lg dshx:border dshx:bg-muted/30 dshx:p-3 dshx:text-xs dshx:text-muted-foreground">
        {usage.message ?? (usage.status === 'unauthenticated' ? "Sign in to read this account's quota." : 'This provider reported no quota windows.')}
      </p>
    )
  }
  const now = Date.now()
  const earliestExpiry = usage.bankedResetExpiries.filter((expiresAt): expiresAt is number => expiresAt !== null).sort((left, right) => left - right)[0]
  return (
    <div className="dshx:grid dshx:gap-3 dshx:rounded-lg dshx:border dshx:bg-muted/30 dshx:p-3 dshx:md:grid-cols-2">
      {UsageOverviewModel.sortWindows(usage.windows).map(window => (
        <QuotaMeter detail={UsageOverviewModel.formatResetIn(window.resetsAt, now)} key={window.label} label={window.label} percent={window.percentRemaining} />
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
