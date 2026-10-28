import { useApi } from '@dshfiles/dshx/client'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { AccountDraftModel } from './account-draft.js'
import { acceptAccountOrder, aiAccountsKeys, aiAccountsQueries } from './accounts-queries.js'
import { aiAccountsApi } from './api.js'

/** The same persisted account switch as Settings; routing state is never a cosmetic hide preference. */
export const AccountEnabledToggle = (props: { readonly instanceId: string; readonly name: string }): JSX.Element => {
  const accounts = useApi(aiAccountsApi)
  const client = useQueryClient()
  const file = useQuery(aiAccountsQueries.file(accounts))
  const account = file.data?.accounts.find(account => account.instanceId === props.instanceId)
  const change = useMutation({
    mutationFn: async (enabled: boolean) => {
      // Read at action time, not from a potentially old quota snapshot, to preserve the account's latest authored settings.
      const current = await accounts.read()
      const saved = current.accounts.find(account => account.instanceId === props.instanceId)
      if (saved === undefined) throw new Error('This account no longer exists. Reopen the popover.')
      return accounts.save({ draft: { ...AccountDraftModel.toDraft(saved), enabled } })
    },
    onSuccess: async next => {
      await acceptAccountOrder(client, next)
      await client.invalidateQueries({ queryKey: aiAccountsKeys.usage })
    },
  })
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-1 dshx:border-t dshx:pt-2">
      <label className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs">
        <Switch
          aria-label={`Enable ${props.name}`}
          checked={account?.enabled ?? false}
          className="dshx:data-[state=checked]:bg-info"
          disabled={account === undefined || file.isError || change.isPending}
          onCheckedChange={enabled => change.mutate(enabled)}
        />
        <span>Enable account</span>
      </label>
      {change.isPending ? (
        <p role="status" className="dshx:text-xs dshx:text-muted-foreground">
          Saving account availability…
        </p>
      ) : null}
      {change.isError ? (
        <p role="alert" className="dshx:text-xs dshx:text-destructive">
          {errorMessage(change.error, 'Could not change account availability. Try again.')}
        </p>
      ) : null}
      {file.isError ? (
        <p role="alert" className="dshx:text-xs dshx:text-destructive">
          Account settings are unavailable. Reopen the popover to retry.
        </p>
      ) : null}
    </div>
  )
}
