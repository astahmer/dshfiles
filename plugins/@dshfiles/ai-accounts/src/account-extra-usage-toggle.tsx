import { useApi } from '@dshfiles/dshx/client'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { aiAccountsKeys, aiAccountsQueries, acceptAccountOrder } from './accounts-queries.js'
import { aiAccountsApi } from './api.js'

/**
 * The persisted "Use extra usage" switch for one account, beside the meter that reports it. Off is the default: once a
 * plan window is spent, routing skips the account instead of drawing paid overage.
 */
export const AccountExtraUsageToggle = (props: { readonly instanceId: string; readonly name: string }): JSX.Element => {
  const accounts = useApi(aiAccountsApi)
  const client = useQueryClient()
  const file = useQuery(aiAccountsQueries.file(accounts))
  const account = file.data?.accounts.find(candidate => candidate.instanceId === props.instanceId)
  const change = useMutation({
    mutationFn: (enabled: boolean) => accounts.setExtraUsage({ instanceId: props.instanceId, enabled }),
    onSuccess: async next => {
      await acceptAccountOrder(client, next)
      await client.invalidateQueries({ queryKey: aiAccountsKeys.usage })
    },
  })
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-1">
      <label className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-[11px]">
        <Switch
          aria-label={`Use extra usage for ${props.name}`}
          checked={account?.useExtraUsage === true}
          className="dshx:data-[state=checked]:bg-warning"
          disabled={account === undefined || file.isError || change.isPending}
          onCheckedChange={enabled => change.mutate(enabled)}
        />
        <span>Use extra usage</span>
      </label>
      <p className="dshx:text-[11px] dshx:text-muted-foreground">
        {account?.useExtraUsage === true ? 'Spent plan windows draw paid extra usage.' : 'Spent plan windows stop this account instead of drawing overage.'}
      </p>
      {change.isError ? (
        <p className="dshx:text-[11px] dshx:text-destructive" role="alert">
          {errorMessage(change.error, 'Could not change extra usage for this account. Try again.')}
        </p>
      ) : null}
      {file.isError ? (
        <p className="dshx:text-[11px] dshx:text-destructive" role="alert">
          Account settings are unavailable. Reopen the popover to retry.
        </p>
      ) : null}
    </div>
  )
}
