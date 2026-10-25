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
import { useMutation, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'
import { aiAccountsKeys } from './accounts-queries.js'
import type { AccountsPanelState } from './use-accounts-panel-state.js'

/** Copilot is the only account kind with a supported credential-removal action. */
export const AccountCopilotDisconnect = (props: { readonly state: AccountsPanelState; readonly instanceId: string }): JSX.Element => {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const disconnect = useMutation({
    mutationFn: () => props.state.accounts.signOutCopilot({ instanceId: props.instanceId }),
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: aiAccountsKeys.file }), queryClient.invalidateQueries({ queryKey: aiAccountsKeys.usage })])
      setOpen(false)
    },
  })
  return (
    <AlertDialog
      onOpenChange={next => {
        if (!disconnect.isPending) setOpen(next)
      }}
      open={open}
    >
      <AlertDialogTrigger asChild>
        <Button size="sm" type="button" variant="outline">
          Disconnect GitHub
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="dshx-root" size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Disconnect GitHub Copilot?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the saved GitHub Copilot credential for this account. The profile stays here; connect it again to use its models.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {disconnect.isError ? (
          <p className="dshx:text-sm dshx:text-destructive" role="alert">
            Could not disconnect GitHub Copilot. Try again or cancel.
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={disconnect.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={disconnect.isPending}
            onClick={event => {
              event.preventDefault()
              disconnect.mutate()
            }}
            variant="destructive"
          >
            {disconnect.isPending ? 'Disconnecting…' : disconnect.isError ? 'Try again' : 'Disconnect GitHub'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
