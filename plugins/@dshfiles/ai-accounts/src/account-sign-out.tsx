import { useApi } from '@dshfiles/dshx/client'
import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@dshfiles/plugin-ui/components/ui/alert-dialog'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { LogOutIcon } from '@dshfiles/plugin-ui/icons'
import { useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import type { AccountProfile } from './api.js'
import { aiAccountsSessionApi } from './account-session-api.js'
import { aiAccountsKeys } from './accounts-queries.js'

/** Mount under the page's existing PluginQueryProvider. Every destructive action needs a named, scoped confirmation. */
export const AccountSignOut = (props: { readonly account: AccountProfile; readonly onSignedOut?: () => void; readonly disabled?: boolean }): JSX.Element => (
  <AccountSignOutAction key={props.account.instanceId} {...props} />
)

const AccountSignOutAction = ({ account, onSignedOut, disabled }: Parameters<typeof AccountSignOut>[0]): JSX.Element => {
  const api = useApi(aiAccountsSessionApi)
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const capability = useQuery({
    queryKey: [
      'ai-accounts',
      'sign-out-capability',
      account.instanceId,
      account.homePath,
      account.shadowHomePath,
      account.apiKeyEnv,
      account.authSource,
      account.signedIn,
    ],
    queryFn: ({ signal }) => api.capability({ instanceId: account.instanceId }, { signal }),
    retry: false,
    enabled: disabled !== true && account.signedIn,
    // Active sign-in may finish without changing an already-authenticated profile. Never retry a missing/older Host.
    refetchInterval: query => (query.state.status === 'error' || !account.signedIn ? false : open ? 2_000 : 5_000),
  })
  const signOut = useMutation({
    mutationKey: ['ai-accounts', 'sign-out', account.instanceId],
    mutationFn: () => api.signOut({ instanceId: account.instanceId, confirm: true }),
    onSuccess: async () => {
      await Promise.all([client.cancelQueries({ queryKey: aiAccountsKeys.file }), client.cancelQueries({ queryKey: aiAccountsKeys.usage })])
      await Promise.all([
        client.invalidateQueries({ queryKey: aiAccountsKeys.file }),
        client.invalidateQueries({ queryKey: aiAccountsKeys.usage }),
        client.invalidateQueries({ queryKey: aiAccountsKeys.identity(account.instanceId) }),
        client.invalidateQueries({ queryKey: ['ai-accounts', 'sign-out-capability', account.instanceId] }),
      ])
      setOpen(false)
      onSignedOut?.()
    },
  })
  const blockedReason = () => {
    if (disabled) return 'Finish the current account edit before signing out.'
    if (!account.signedIn) return 'This account is already signed out.'
    if (capability.isPending) return 'Checking sign-out availability…'
    if (capability.isError) return 'Sign out needs the updated Host. Restart when idle, then retry.'
    return capability.data?.reason
  }
  const reason = blockedReason()
  const blocked = disabled === true || !account.signedIn || capability.isError || capability.data?.available !== true || signOut.isPending
  return (
    <AlertDialog
      open={open}
      onOpenChange={next => {
        if (!signOut.isPending) {
          if (next) signOut.reset()
          setOpen(next)
        }
      }}
    >
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="dshx-root dshx:inline-flex"
              tabIndex={blocked ? 0 : undefined}
              aria-label={blocked ? `Sign out unavailable: ${reason ?? 'An account operation is running.'}` : undefined}
            >
              <AlertDialogTrigger asChild>
                <Button type="button" size="sm" variant="outline" disabled={blocked}>
                  <LogOutIcon aria-hidden="true" />
                  Sign out
                </Button>
              </AlertDialogTrigger>
            </span>
          </TooltipTrigger>
          <TooltipContent>{reason ?? 'Sign out while keeping this account profile and its model preferences.'}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <AlertDialogContent className="dshx-root" size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Sign out of {account.displayName}?</AlertDialogTitle>
          <AlertDialogDescription>
            {capability.data?.credentialScope ?? 'Checking the account-owned credential scope…'} Your profile, enabled setting and model preferences stay here.
            Sign in again to use this account.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {signOut.isError ? (
          <p role="alert" className="dshx:text-sm dshx:text-destructive">
            Could not sign out. Check the credential source or finish any active sign-in, then retry. Your profile was preserved.
          </p>
        ) : null}
        {capability.data?.available === false ? (
          <p role="status" className="dshx:text-sm dshx:text-muted-foreground">
            {capability.data.reason}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={signOut.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={blocked}
            onClick={event => {
              event.preventDefault()
              signOut.mutate()
            }}
          >
            {signOut.isPending ? 'Signing out…' : 'Sign out'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
