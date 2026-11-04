import { useApi } from '@dshfiles/dshx/client'
import { EmptyState, PageSection } from '@dshfiles/plugin-ui/components/page'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { RefreshCwIcon } from '@dshfiles/plugin-ui/icons'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useMemo, useState } from 'react'
import { aiAccountsQueries } from './accounts-queries.js'
import { aiAccountsApi } from './api.js'
import { AccountUsageSlot } from './account-usage-view.js'
import { CurrentQuota, LabelledSelect } from './usage-history-panel.js'
import { useAccountsUsage } from './use-accounts-usage.js'

/**
 * Usage › Quota › Accounts: one account's current limits, then the requests and cost usage recorded for it (the
 * dashboard the account page's Usage tab used to show, provided by `@dshfiles/usage` through `AccountUsageView`).
 * `onOpenAccounts` leads to account management in Settings; `onOpenHistory` switches to the History view.
 */
export const QuotaAccountsView = (props: {
  readonly accountId?: string
  readonly displayName?: string
  readonly onOpenAccounts: () => void
  readonly onOpenHistory: (accountId: string) => void
}): JSX.Element => {
  const accounts = useApi(aiAccountsApi)
  const { usage, refresh, refreshing } = useAccountsUsage()
  const fileQuery = useQuery(aiAccountsQueries.file(accounts))
  const [chosenId, setChosenId] = useState(props.accountId ?? '')
  const options = useMemo(() => {
    const configured = (fileQuery.data?.accounts ?? []).map(account => ({ value: account.instanceId, label: account.displayName || account.instanceId }))
    // A native provider route is not in the accounts file; keep the one the user came from selectable.
    const extra =
      props.accountId === undefined || configured.some(option => option.value === props.accountId)
        ? []
        : [{ value: props.accountId, label: props.displayName ?? props.accountId }]
    return [...configured, ...extra]
  }, [fileQuery.data, props.accountId, props.displayName])
  const enabledFirst = fileQuery.data?.accounts.find(account => account.enabled)?.instanceId
  const selectedId = chosenId || enabledFirst || options[0]?.value || ''
  const selected = options.find(option => option.value === selectedId)

  if (fileQuery.isLoading && options.length === 0)
    return (
      <p className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-muted-foreground">
        <Spinner className="dshx:size-3.5" />
        Loading accounts…
      </p>
    )
  if (selected === undefined)
    return (
      <EmptyState className="dshx:rounded-lg dshx:border dshx:border-border" action={{ label: 'Open accounts', onSelect: props.onOpenAccounts }}>
        Add an account to see its quota and usage here.
      </EmptyState>
    )
  return (
    <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-5">
      <div className="dshx:flex dshx:flex-wrap dshx:items-end dshx:gap-2">
        <LabelledSelect ariaLabel="Quota account" label="Account" onChange={setChosenId} options={options} value={selectedId} />
        <Button size="sm" variant="outline" disabled={refreshing} onClick={() => void refresh()}>
          {refreshing ? <Spinner className="dshx:size-3.5" /> : <RefreshCwIcon aria-hidden />}
          Refresh quota
        </Button>
        <Button size="sm" variant="ghost" onClick={() => props.onOpenHistory(selectedId)}>
          Quota history
        </Button>
        <Button size="sm" variant="ghost" onClick={props.onOpenAccounts}>
          Manage accounts
        </Button>
      </div>
      <PageSection heading="Current limits" description="Provider-reported subscription allowance, separate from recorded requests and list-price estimates.">
        <CurrentQuota accountId={selectedId} usage={usage} />
      </PageSection>
      <AccountUsageSlot accountId={selectedId} displayName={selected.label} onOpenUsageHistory={() => props.onOpenHistory(selectedId)} />
    </div>
  )
}
