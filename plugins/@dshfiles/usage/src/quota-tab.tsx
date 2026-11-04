import { AccountQuotaViews, USAGE_QUOTA_VIEWS, type UsageQuotaTarget, type UsageQuotaView } from '@dshfiles/ai-accounts/quota-views'
import { useContract } from '@dshfiles/dshx/client'
import { EmptyState } from '@dshfiles/plugin-ui/components/page'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { useSyncExternalStore } from 'react'

const VIEW_LABELS: Record<UsageQuotaView, string> = { accounts: 'Accounts', history: 'History', forecast: 'Forecast' }

/**
 * Where Usage › Quota stands: the view and the account a caller asked for. Module state, not a stored preference: the
 * last view is a session detail, and `open` comes from other plugins through the `UsageNavigation` contract.
 */
interface QuotaLocation {
  readonly view: UsageQuotaView
  readonly accountId?: string
  readonly displayName?: string
  /** Bumped on every navigation, so the same account opened twice still remounts its view. */
  readonly visit: number
}

let location: QuotaLocation = { view: 'accounts', visit: 0 }
const listeners = new Set<() => void>()
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const set = (next: QuotaLocation): void => {
  location = next
  for (const listener of listeners) listener()
}

const go = (target: UsageQuotaTarget = {}): void =>
  set({
    view: target.view ?? location.view,
    ...(target.accountId === undefined ? {} : { accountId: target.accountId }),
    ...(target.displayName === undefined ? {} : { displayName: target.displayName }),
    visit: location.visit + 1,
  })

/**
 * Usage › Quota: ai-accounts' quota views (one account, history, forecast) inside the Usage page. They come from
 * `@dshfiles/ai-accounts` through `AccountQuotaViews`; without it the tab says what to install instead of guessing.
 */
const QuotaTab = (): JSX.Element => {
  const views = useContract(AccountQuotaViews)
  const current = useSyncExternalStore(
    subscribe,
    () => location,
    () => location,
  )
  if (views.status !== 'active')
    return (
      <EmptyState className="dshx:rounded-lg dshx:border dshx:border-border">
        {views.status === 'pending'
          ? 'Loading quota views…'
          : 'Quota comes from the AI accounts plugin, which is not running. Turn it on in Settings › Plugins to see quota here.'}
      </EmptyState>
    )
  const account = {
    ...(current.accountId === undefined ? {} : { accountId: current.accountId }),
    ...(current.displayName === undefined ? {} : { displayName: current.displayName }),
  }
  const View = current.view === 'accounts' ? views.value.Accounts : current.view === 'history' ? views.value.History : views.value.Forecast
  return (
    <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-4" data-usage-quota={current.view}>
      <div className="dshx:min-w-0 dshx:overflow-x-auto dshx:pb-0.5">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label="Quota views"
          value={current.view}
          onValueChange={value => {
            const view = USAGE_QUOTA_VIEWS.find(candidate => candidate === value)
            if (view !== undefined) set({ ...current, view })
          }}
        >
          {USAGE_QUOTA_VIEWS.map(view => (
            <ToggleGroupItem key={view} value={view} className="dshx:flex-none">
              {VIEW_LABELS[view]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <View key={`${current.view}:${String(current.visit)}`} {...account} />
    </div>
  )
}

export class UsageQuota {
  static readonly Tab = QuotaTab
  /** Land on a view (and account) of the Quota tab; the caller selects the Usage page and its Quota tab. */
  static readonly go = go
  /** Where the Quota tab stands now. */
  static readonly current = (): QuotaLocation => location
}
