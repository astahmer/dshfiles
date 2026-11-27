import { AccountQuotaViews, USAGE_QUOTA_VIEWS, type UsageQuotaView } from '@dshfiles/ai-accounts/quota-views'
import { useContract } from '@dshfiles/dshx/client'
import { EmptyState } from '@dshfiles/plugin-ui/components/page'
import { SlidingSegments } from '@dshfiles/plugin-ui/components/motion/sliding-segments'
import { useSyncExternalStore } from 'react'
import { accountOf, goToQuota, locationFor, type QuotaLocation } from './quota-location.js'

const VIEW_LABELS = { accounts: 'Accounts', history: 'History', forecast: 'Forecast' } satisfies Record<UsageQuotaView, string>

/**
 * Usage › Quota: ai-accounts' quota views (one account, history, forecast) inside the Usage page. They come from
 * `@dshfiles/ai-accounts` through `AccountQuotaViews`; without it the tab says what to install instead of guessing.
 */
const QuotaTab = (props: { readonly panelId?: string | undefined }): JSX.Element => {
  const views = useContract(AccountQuotaViews)
  const location = locationFor(props.panelId)
  const current = useSyncExternalStore(location.subscribe, location.get, location.get)
  if (views.status !== 'active')
    return (
      <EmptyState className="dshx:rounded-lg dshx:border dshx:border-border">
        {views.status === 'pending'
          ? 'Loading quota views…'
          : 'Quota comes from the AI accounts plugin, which is not running. Turn it on in Settings › Plugins to see quota here.'}
      </EmptyState>
    )
  const account = accountOf(current)
  const View = current.view === 'accounts' ? views.value.Accounts : current.view === 'history' ? views.value.History : views.value.Forecast
  return (
    <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-4" data-usage-quota={current.view}>
      <div className="dshx:min-w-0 dshx:overflow-x-auto dshx:pb-0.5">
        <SlidingSegments
          aria-label="Quota views"
          options={USAGE_QUOTA_VIEWS.map(view => ({ value: view, label: VIEW_LABELS[view] }))}
          value={current.view}
          onValueChange={view => location.set({ ...current, view })}
        />
      </div>
      <View key={`${current.view}:${String(current.visit)}`} {...account} />
    </div>
  )
}

export class UsageQuota {
  static readonly Tab = QuotaTab
  /** Land on a view (and account) of the Quota tab; the caller selects the Usage page and its Quota tab. */
  static readonly go = goToQuota
  /** Where the Quota tab stands now. */
  static readonly current = (panelId?: string): QuotaLocation => locationFor(panelId).get()
}
