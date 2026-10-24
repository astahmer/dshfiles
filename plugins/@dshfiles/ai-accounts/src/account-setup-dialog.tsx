import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { useMachine } from '@dshfiles/plugin-ui/machine'
import { useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useState, useSyncExternalStore } from 'react'
import type { WorkspacePickerPorts } from '@dshfiles/project-folder-picker'
import { AccountDraftModel } from './account-draft.js'
import { KIND_GROUPS, KIND_LABEL } from './account-labels.js'
import { aiAccountsKeys, aiAccountsQueries } from './accounts-queries.js'
import { aiAccountsApi, type AccountProfile } from './api.js'
import { ApiKeySetupDialog } from './api-key-setup-dialog.js'
import { accountSetupMachine } from './account-setup-machine.js'
import { runSetupStep } from './account-setup-operation.js'
import type { AccountSetupController, AccountSetupRequest } from './account-setup-controller.js'
import type { CredentialSetupPort } from './credential-setup-port.js'
import { ProviderGlyph } from './provider-glyph.js'
import { CopilotSignIn } from './copilot-sign-in.js'
import { CodexSignIn } from './codex-sign-in.js'

interface SetupPorts {
  readonly controller: AccountSetupController
  readonly credentialSetup: CredentialSetupPort | undefined
  readonly folderPicker: WorkspacePickerPorts
}

/** One overlay seat; sidebar entry points do not select a different main panel. */
export const AccountSetupOverlay = (props: SetupPorts): JSX.Element | null => {
  const request = useSyncExternalStore(props.controller.subscribe, props.controller.getSnapshot)
  return request === null ? null : <AccountSetupSession {...props} key={request.id} request={request} />
}

const AccountSetupSession = (props: SetupPorts & { readonly request: AccountSetupRequest }): JSX.Element => {
  const api = useApi(aiAccountsApi)
  const client = useQueryClient()
  const file = useQuery({ ...aiAccountsQueries.file(api), staleTime: 0 })
  const [notice, setNotice] = useState<string | null>(null)
  const [useKey, setUseKey] = useState(false)
  const [connectAnother, setConnectAnother] = useState(false)
  const [snapshot, send] = useMachine(accountSetupMachine, {
    input: {
      accountId: props.request.accountId,
      create: async (kind, actorSignal) => {
        const signal = AbortSignal.any([actorSignal, props.request.signal])
        const next = await api.createSetupAccount({ kind, requestId: props.request.operationId }, { signal })
        signal.throwIfAborted()
        if (!props.controller.isCurrent(props.request.id)) throw new Error('Setup was replaced.')
        await client.cancelQueries({ queryKey: aiAccountsKeys.file, exact: true })
        signal.throwIfAborted()
        if (!props.controller.isCurrent(props.request.id)) throw new Error('Setup was replaced.')
        client.setQueryData(aiAccountsKeys.file, next.file)
        props.request.onCreated?.(next.instanceId)
        return next.instanceId
      },
    },
  })
  const account = file.data?.accounts.find(candidate => candidate.instanceId === snapshot.context.accountId)
  const assertCurrent = (): void => {
    props.request.signal.throwIfAborted()
    if (!props.controller.isCurrent(props.request.id)) throw new Error('Setup was replaced.')
  }
  const finish = useMutation({
    mutationFn: async () => {
      assertCurrent()
      if (snapshot.context.accountId === null) throw new Error('Choose an account first.')
      const next = await runSetupStep(props.controller, props.request, signal =>
        api.completeSetupAccount({ instanceId: snapshot.context.accountId ?? '' }, { signal }),
      )
      assertCurrent()
      await runSetupStep(props.controller, props.request, () => client.cancelQueries({ queryKey: aiAccountsKeys.file, exact: true }))
      assertCurrent()
      client.setQueryData(aiAccountsKeys.file, next)
      await client.invalidateQueries({ queryKey: aiAccountsKeys.usage })
    },
    onSuccess: () => props.controller.close(props.request.id),
    onError: () => {
      if (props.controller.isCurrent(props.request.id))
        setNotice('The credential could not be confirmed or the account could not be enabled. The profile is kept; check sign-in and retry.')
    },
  })
  const ref = account?.apiKeyEnv ?? ''
  const credential = useQuery({
    queryKey: aiAccountsKeys.credential(ref),
    queryFn: () => props.credentialSetup?.describe(ref) ?? Promise.reject(new Error('Credential setup is unavailable.')),
    enabled: props.credentialSetup !== undefined && ref !== '',
    retry: false,
    staleTime: 0,
  })
  const close = (): void => {
    void client.invalidateQueries({ queryKey: aiAccountsKeys.file })
    props.controller.close(props.request.id)
  }
  const complete = (): void => {
    if (props.controller.isCurrent(props.request.id)) finish.mutate()
  }
  const keyed = account !== undefined && account.kind !== 'codex' && account.kind !== 'github-copilot'
  const keyForm = account !== undefined && keyed && (!account.signedIn || useKey)
  if (keyForm && props.credentialSetup !== undefined) {
    const persistAndFinish = async <T,>(write: () => Promise<T>): Promise<boolean> => {
      try {
        assertCurrent()
        await runSetupStep(props.controller, props.request, write)
        assertCurrent()
        await client.invalidateQueries({ queryKey: aiAccountsKeys.credential(ref) })
        assertCurrent()
        await finish.mutateAsync()
        return true
      } catch {
        if (props.controller.isCurrent(props.request.id)) setNotice('The profile is kept, but setup did not finish. Check credential storage and retry.')
        return false
      }
    }
    return (
      <>
        <ApiKeySetupDialog
          setupNotice={
            account.enabled
              ? 'This enabled profile stays available. Closing keeps the profile and cannot undo an accepted credential replacement.'
              : 'This profile stays disabled until you finish connecting. Cancel keeps it for later. An accepted credential write cannot be undone by closing this dialog.'
          }
          errorNotice={notice}
          draft={AccountDraftModel.toDraft(account)}
          folderPicker={props.folderPicker}
          open
          onOpenChange={open => {
            if (!open) close()
          }}
          state={{
            credentialInfo: credential.data ?? null,
            storeCredential: async input => {
              if (input.ref !== ref || credential.data?.writable !== true || props.credentialSetup === undefined) return false
              return persistAndFinish(() => props.credentialSetup?.set(ref, input.value) ?? Promise.reject(new Error('Credential storage is unavailable.')))
            },
            importSecretCatalogKey: input => persistAndFinish(() => api.importSecretCatalogKey({ instanceId: account.instanceId, ...input })),
          }}
        />
      </>
    )
  }
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) close()
      }}
    >
      <DialogContent className="dshx-root dshx:max-w-lg">
        <DialogHeader>
          <DialogTitle>{account === undefined ? 'Add account' : `Connect ${account.displayName}`}</DialogTitle>
          <DialogDescription>
            {account === undefined
              ? 'Choose a provider. DSH handles account defaults; approve sign-in or add a key next.'
              : 'Provider approval happens on its own website. Credentials stay on the DSH host, not in account settings.'}
          </DialogDescription>
        </DialogHeader>
        {snapshot.matches('choosing') ? (
          <div className="dshx:grid dshx:grid-cols-2 dshx:gap-2">
            {KIND_GROUPS.map(kind => (
              <Button
                className="dshx:h-auto dshx:justify-start dshx:gap-3 dshx:py-3"
                variant="outline"
                key={kind}
                disabled={file.data === undefined}
                onClick={() => {
                  if (file.data === undefined) return
                  send({ type: 'choose', kind })
                }}
              >
                <span aria-hidden>
                  <ProviderGlyph kind={kind} className="dshx:size-5 dshx:shrink-0" />
                </span>
                {KIND_LABEL[kind]} account
              </Button>
            ))}
          </div>
        ) : null}
        {snapshot.matches('creating') || file.isLoading ? (
          <p className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm" role="status">
            <Spinner />
            Preparing your account…
          </p>
        ) : null}
        {snapshot.matches('error') ? (
          <div className="dshx:flex dshx:flex-col dshx:gap-3">
            <p role="alert">Could not save the account. Retry uses the same profile, not a duplicate.</p>
            <Button onClick={() => send({ type: 'retry' })}>Try again</Button>
          </div>
        ) : null}
        {file.isError ? (
          <p role="alert" className="dshx:text-sm dshx:text-destructive">
            Accounts could not be loaded.{' '}
            <Button variant="link" onClick={() => void file.refetch()}>
              Retry
            </Button>
          </p>
        ) : null}
        {snapshot.matches('connecting') && account === undefined && !file.isLoading ? (
          <p role="alert" className="dshx:text-sm">
            This account is no longer available. Close setup and add it again.
          </p>
        ) : null}
        {account === undefined ? null : (
          <>
            <AccountConnectionSummary account={account} />
            {account.signedIn && !connectAnother ? (
              <div className="dshx:flex dshx:flex-col dshx:gap-3">
                <p className="dshx:text-sm">
                  {account.identity === null ? 'A credential is already available for this profile.' : `Existing sign-in: ${account.identity}`}
                </p>
                <Button disabled={finish.isPending} onClick={complete}>
                  {finish.isPending ? 'Enabling…' : 'Use this account'}
                </Button>
                {account.kind === 'codex' || account.kind === 'github-copilot' ? (
                  <Button variant="outline" onClick={() => setConnectAnother(true)}>
                    Sign in to another account
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => setUseKey(true)}>
                    Replace or import key…
                  </Button>
                )}
              </div>
            ) : account.kind === 'github-copilot' ? (
              <CopilotSignIn instanceId={account.instanceId} signedIn={false} onConnected={complete} />
            ) : account.kind === 'codex' ? (
              <CodexSignIn replaceExisting={account.signedIn && connectAnother} instanceId={account.instanceId} onConnected={complete} />
            ) : (
              <p className="dshx:text-sm dshx:text-muted-foreground">
                Credential management is unavailable on this Host. Enable the supported DSH credential provider before adding a key.
              </p>
            )}
            {account.kind === 'claude' ? (
              <p className="dshx:text-xs dshx:text-muted-foreground">
                Claude subscription sign-in must use unmodified Claude Code. DSH does not intercept Claude.ai login; keyed setup uses the existing supported
                credential route.
              </p>
            ) : null}
          </>
        )}
        {notice === null ? null : (
          <p role="alert" className="dshx:text-sm dshx:text-destructive">
            {notice}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            {account === undefined ? 'Cancel' : 'Finish later'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const AccountConnectionSummary = (props: { readonly account: AccountProfile }): JSX.Element => (
  <div className="dshx:flex dshx:items-center dshx:gap-3 dshx:rounded-lg dshx:bg-muted/40 dshx:p-3">
    <ProviderGlyph kind={props.account.kind} className="dshx:size-7 dshx:shrink-0" />
    <div className="dshx:min-w-0">
      <p className="dshx:truncate dshx:text-sm dshx:font-semibold">{props.account.displayName}</p>
      <p className="dshx:text-xs dshx:text-muted-foreground">
        {props.account.kind === 'cursor' ? 'Quota tracking only · no DSH model route' : 'Account defaults are ready · advanced settings remain editable'}
      </p>
    </div>
  </div>
)
