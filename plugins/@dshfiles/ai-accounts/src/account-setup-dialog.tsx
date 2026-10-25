import { useApi } from '@dshfiles/dshx/client'
import { isApiError } from '@dshfiles/dshx/api'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { useMachine } from '@dshfiles/plugin-ui/machine'
import { useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { WorkspacePickerPorts } from '@dshfiles/project-folder-picker'
import { AccountDraftModel } from './account-draft.js'
import { AccountConnectionMethodModel } from './account-connection-method.js'
import { AccountConnectionOptions, ExistingConnectionReference } from './account-connection-options.js'
import { AccountConnectionSummary } from './account-connection-summary.js'
import { preserveAccountNameEditOnEscape } from './account-name-escape.js'
import { KIND_GROUPS, KIND_LABEL } from './account-labels.js'
import { aiAccountsKeys } from './accounts-queries.js'
import { aiAccountsApi, type AccountConnectionSnapshot, type AccountProfile, type ConfigureAccountConnectionInput } from './api.js'
import { ApiKeySetupDialog } from './api-key-setup-dialog.js'
import { accountSetupMachine } from './account-setup-machine.js'
import { runSetupStep } from './account-setup-operation.js'
import type { AccountSetupController, AccountSetupRequest } from './account-setup-controller.js'
import type { CredentialSetupPort } from './credential-setup-port.js'
import { ProviderGlyph } from './provider-glyph.js'
import { CopilotSignIn } from './copilot-sign-in.js'
import { CodexSignIn } from './codex-sign-in.js'

// A response/transport failure can occur after an accepted commit. Never infer
// authentication failure or safe credential replacement from a missing receipt.
const isUnknownConnectionResult = (error: unknown): boolean =>
  isApiError(error) && (error.kind === 'contract' || error.kind === 'transport' || error.kind === 'unavailable')

interface SetupPorts {
  readonly controller: AccountSetupController
  readonly credentialSetup: CredentialSetupPort | undefined
  readonly folderPicker: WorkspacePickerPorts
}

/** Provisional profiles live only in this operation's query, never in the saved account-list cache. */
export const AccountSetupOverlay = (props: SetupPorts): JSX.Element | null => {
  const request = useSyncExternalStore(props.controller.subscribe, props.controller.getSnapshot)
  return request === null ? null : <AccountSetupSession {...props} key={request.id} request={request} />
}

const AccountSetupSession = (props: SetupPorts & { readonly request: AccountSetupRequest }): JSX.Element => {
  const api = useApi(aiAccountsApi)
  const client = useQueryClient()
  const { controller, request } = props
  const newAccount = request.accountId === undefined
  const queryKey = ['ai-accounts', 'account-connection', request.operationId] as const
  const [notice, setNotice] = useState<string | null>(null)
  const [connectAnother, setConnectAnother] = useState(false)
  const assertCurrent = (): void => {
    request.signal.throwIfAborted()
    if (!controller.isCurrent(request.id)) throw new Error('Setup was replaced.')
  }
  const publishConnection = async (next: AccountConnectionSnapshot): Promise<void> => {
    assertCurrent()
    // A response captured before a configuration/commit must not undo its newer snapshot.
    await client.cancelQueries({ queryKey, exact: true })
    assertCurrent()
    client.setQueryData(queryKey, next)
  }
  useEffect(() => {
    // The controller retains this one cleanup until close/replacement/plugin disposal.
    // React StrictMode view remounts do not discard the still-current operation.
    controller.registerCancellation(request.id, () => {
      void Promise.resolve()
        .then(() => api.discardAccountConnection({ operationId: request.operationId, confirm: true }))
        .catch(() => undefined)
      client.removeQueries({ queryKey: ['ai-accounts', 'account-connection', request.operationId], exact: true })
    })
  }, [api, client, controller, request])
  const [snapshot, send] = useMachine(accountSetupMachine, {
    input: {
      accountId: request.accountId,
      create: async (kind, actorSignal) => {
        const signal = AbortSignal.any([actorSignal, request.signal])
        const existing =
          request.accountId === undefined
            ? undefined
            : (await api.read(undefined, { signal })).accounts.find(account => account.instanceId === request.accountId)
        const provider = kind ?? existing?.kind
        if (provider === undefined) throw new Error('This account is no longer available.')
        const next = await api.prepareAccountConnection(
          {
            kind: provider,
            requestId: request.operationId,
            ...(request.accountId === undefined ? {} : { existingInstanceId: request.accountId }),
          },
          { signal },
        )
        signal.throwIfAborted()
        assertCurrent()
        await publishConnection(next)
        return next.instanceId
      },
    },
  })
  const connection = useQuery({
    queryKey,
    queryFn: ({ signal }) => api.getAccountConnection({ operationId: request.operationId }, { signal }),
    enabled: snapshot.matches('connecting'),
    refetchInterval: query => (query.state.data?.status === 'pending' || query.state.data?.status === 'verifying' ? 1_000 : false),
    retry: false,
  })
  const account = connection.data?.account ?? undefined
  const finish = useMutation({
    mutationFn: async () => {
      assertCurrent()
      const next = await runSetupStep(controller, request, signal => api.completeAccountConnection({ operationId: request.operationId }, { signal }))
      assertCurrent()
      if (next.status !== 'complete') throw new Error('Connection did not complete.')
      await publishConnection(next)
      await Promise.all([
        client.invalidateQueries({ queryKey: aiAccountsKeys.file, exact: true }),
        client.invalidateQueries({ queryKey: aiAccountsKeys.usage }),
      ])
      return next
    },
    onSuccess: next => {
      if (!controller.isCurrent(request.id)) return
      if (newAccount) request.onCreated?.(next.instanceId)
      controller.close(request.id)
    },
    onError: error => {
      if (controller.isCurrent(request.id))
        setNotice(
          isUnknownConnectionResult(error)
            ? null
            : newAccount
              ? 'Connection could not be verified. No account was added.'
              : 'Sign-in could not be verified. Your saved account is unchanged.',
        )
    },
  })
  const configure = useMutation({
    mutationFn: (input: Omit<ConfigureAccountConnectionInput, 'operationId'>) =>
      runSetupStep(controller, request, signal => api.configureAccountConnection({ operationId: request.operationId, ...input }, { signal })),
    onSuccess: async next => {
      if (!controller.isCurrent(request.id)) return
      await publishConnection(next)
      setConnectAnother(false)
      setNotice(null)
    },
    onError: () => {
      if (controller.isCurrent(request.id)) setNotice('Connection settings could not be changed. Retry or cancel setup.')
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
  const close = (): void => controller.close(request.id)
  const startAgain = (): void => {
    if (!controller.isCurrent(request.id)) return
    controller.open({
      ...(request.accountId === undefined ? {} : { accountId: request.accountId }),
      ...(request.onCreated === undefined ? {} : { onCreated: request.onCreated }),
    })
  }
  const complete = (): void => {
    if (controller.isCurrent(request.id)) finish.mutate()
  }
  const busy = finish.isPending || configure.isPending
  const resultUnknown = isUnknownConnectionResult(finish.error)
  const saveName = async (displayName: string): Promise<void> => {
    const next = await configure.mutateAsync({ displayName })
    if (next.account?.displayName !== displayName) throw new Error('This Host does not support pending account names yet.')
  }
  const method = connection.data?.method ?? (account === undefined ? undefined : AccountConnectionMethodModel.defaultMethod(account.kind))
  const keyForm = account !== undefined && method === 'key'
  if (keyForm && props.credentialSetup !== undefined && !resultUnknown) {
    const stageAndFinish = async (stage: () => Promise<AccountConnectionSnapshot>): Promise<boolean> => {
      try {
        assertCurrent()
        await runSetupStep(controller, request, stage)
        assertCurrent()
        await finish.mutateAsync()
        return true
      } catch {
        if (controller.isCurrent(request.id)) setNotice('Connection could not be verified. Check the key and try again. No new account has been added.')
        return false
      }
    }
    return (
      <ApiKeySetupDialog
        setupNotice={newAccount ? 'Added only after verification.' : 'Your saved account stays unchanged until verified.'}
        connectionTitle={newAccount ? `Connect ${KIND_LABEL[account.kind]}` : `Reconnect ${account.displayName}`}
        connectionHeading={<AccountConnectionSummary account={account} editable={newAccount} busy={busy} saveName={saveName} />}
        errorNotice={notice}
        submitLabel={newAccount ? 'Verify and add account' : 'Verify and reconnect'}
        savingLabel="Verifying…"
        credentialLabel={account.kind === 'claude' ? 'API key or setup token value' : 'API key value'}
        connectionControls={
          <div className="dshx:flex dshx:flex-col dshx:gap-3">
            <AccountConnectionOptions account={account} method={method} busy={busy} configure={input => configure.mutate(input)} />
            {account.kind === 'claude' ? (
              <p className="dshx:text-xs dshx:text-muted-foreground">API keys use separate billing. Setup tokens are also supported.</p>
            ) : null}
            {account.kind === 'commandcode' ? (
              <ConnectionBaseUrl
                key={`${account.instanceId}:${account.apiBaseUrl}`}
                account={account}
                busy={busy}
                save={apiBaseUrl => configure.mutate({ apiBaseUrl })}
              />
            ) : null}
          </div>
        }
        draft={AccountDraftModel.toDraft(account)}
        folderPicker={props.folderPicker}
        open
        onOpenChange={open => {
          if (!open) close()
        }}
        state={{
          credentialInfo: credential.data ?? null,
          storeCredential: async input => {
            if (input.ref !== ref || credential.data?.writable !== true) return false
            return stageAndFinish(() => api.stageAccountConnectionKey({ operationId: request.operationId, value: input.value }))
          },
          importSecretCatalogKey: input => stageAndFinish(() => api.importAccountConnectionKey({ operationId: request.operationId, ...input })),
        }}
      />
    )
  }
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) close()
      }}
    >
      <DialogContent onEscapeKeyDown={preserveAccountNameEditOnEscape} className="dshx-root dshx:max-h-[90dvh] dshx:max-w-lg dshx:overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {account === undefined
              ? newAccount
                ? 'Add account'
                : 'Reconnect account'
              : newAccount
                ? `Connect ${KIND_LABEL[account.kind]}`
                : `Reconnect ${account.displayName}`}
          </DialogTitle>
          <DialogDescription>
            {!newAccount
              ? 'Update your sign-in. Cancel keeps your account unchanged.'
              : account === undefined
                ? 'Choose a provider.'
                : 'Added only after verification.'}
          </DialogDescription>
        </DialogHeader>
        {snapshot.matches('choosing') ? (
          <div className="dshx:grid dshx:grid-cols-2 dshx:gap-2">
            {KIND_GROUPS.map(kind => (
              <Button
                className="dshx:h-auto dshx:justify-start dshx:gap-3 dshx:py-3"
                variant="outline"
                key={kind}
                onClick={() => send({ type: 'choose', kind })}
              >
                <span aria-hidden>
                  <ProviderGlyph kind={kind} className="dshx:size-5 dshx:shrink-0" />
                </span>
                {KIND_LABEL[kind]} account
              </Button>
            ))}
          </div>
        ) : null}
        {snapshot.matches('creating') || (snapshot.matches('connecting') && connection.isLoading) ? (
          <p className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm" role="status">
            <Spinner />
            Preparing a private connection…
          </p>
        ) : null}
        {snapshot.matches('error') ? (
          <div className="dshx:flex dshx:flex-col dshx:gap-3">
            <p role="alert">Setup could not be prepared. No account was added. This Host must support provisional account connections.</p>
            <Button onClick={() => send({ type: 'retry' })}>Try again</Button>
          </div>
        ) : null}
        {resultUnknown || connection.isError || connection.data?.status === 'discarded' ? (
          <div className="dshx:flex dshx:flex-col dshx:gap-3">
            <p role="alert" className="dshx:text-sm dshx:text-destructive">
              {resultUnknown
                ? 'The connection result could not be read. Sign-in may already be saved; close setup and check your accounts.'
                : finish.isError
                  ? 'This connection attempt ended after verification failed. Start a new attempt to sign in again.'
                  : 'This connection is no longer active. Start a new attempt.'}
            </p>
            {resultUnknown ? null : (
              <Button disabled={busy} onClick={startAgain}>
                Start again
              </Button>
            )}
          </div>
        ) : null}
        {account === undefined || resultUnknown ? null : (
          <>
            <AccountConnectionSummary account={account} editable={newAccount} busy={busy} saveName={saveName} />
            {account.kind === 'commandcode' ? (
              <ConnectionBaseUrl
                key={`${account.instanceId}:${account.apiBaseUrl}`}
                account={account}
                busy={busy}
                save={apiBaseUrl => configure.mutate({ apiBaseUrl })}
              />
            ) : null}
            {method === undefined ? null : (
              <AccountConnectionOptions account={account} method={method} busy={busy} configure={input => configure.mutate(input)} />
            )}
            <fieldset disabled={busy} className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3">
              {method === 'subscription' || method === 'cli' ? (
                <>
                  <p className="dshx:text-sm dshx:text-muted-foreground">
                    {account.kind === 'claude' ? 'Use your Claude subscription. No API key needed.' : 'Use an existing CLI login on this Host.'}
                  </p>
                  <details className="dshx:text-xs">
                    <summary className="dshx:cursor-pointer dshx:text-muted-foreground">Sign-in command</summary>
                    <pre className="dshx:mt-2 dshx:overflow-x-auto dshx:rounded-md dshx:bg-muted dshx:p-3 dshx:text-xs">
                      <code>{account.loginHint}</code>
                    </pre>
                  </details>
                  <Button variant="outline" onClick={() => void writeClipboard(account.loginHint ?? '')}>
                    {account.kind === 'claude' ? 'Copy Claude Code sign-in command' : 'Copy CLI sign-in command'}
                  </Button>
                  <Button onClick={complete}>
                    {finish.isPending
                      ? 'Checking sign-in…'
                      : method === 'subscription'
                        ? newAccount
                          ? 'Verify subscription and add account'
                          : 'Verify subscription and reconnect'
                        : newAccount
                          ? 'Verify CLI login and add account'
                          : 'Verify CLI login and reconnect'}
                  </Button>
                </>
              ) : method === 'reference' ? (
                <>
                  <ExistingConnectionReference
                    key={`${account.instanceId}:${ref}`}
                    account={account}
                    method={method}
                    busy={busy}
                    configure={input => configure.mutate(input)}
                  />
                  <p className="dshx:text-xs dshx:text-muted-foreground">
                    Using <code>{ref || 'no credential selected'}</code>
                  </p>
                  <Button disabled={ref === ''} onClick={complete}>
                    {finish.isPending ? 'Verifying…' : newAccount ? 'Verify and add account' : 'Verify and reconnect'}
                  </Button>
                </>
              ) : method === 'device' && account.signedIn && !connectAnother && !(account.kind === 'codex' && !newAccount) ? (
                <>
                  <p className="dshx:text-sm">A credential is available. The Host will check the selected login before saving.</p>
                  <Button onClick={complete}>{finish.isPending ? 'Verifying…' : newAccount ? 'Verify and add account' : 'Verify and reconnect'}</Button>
                  <Button variant="outline" onClick={() => setConnectAnother(true)}>
                    Sign in to another account
                  </Button>
                </>
              ) : account.kind === 'github-copilot' ? (
                <CopilotSignIn instanceId={account.instanceId} operationId={request.operationId} signedIn={false} onConnected={complete} onCancelled={close} />
              ) : account.kind === 'codex' ? (
                <CodexSignIn
                  replaceExisting={!newAccount || (account.signedIn && connectAnother)}
                  instanceId={account.instanceId}
                  operationId={request.operationId}
                  onConnected={complete}
                  onCancelled={close}
                />
              ) : (
                <p className="dshx:text-sm dshx:text-muted-foreground">Credential management is unavailable on this Host. Setup cannot be completed here.</p>
              )}
            </fieldset>
            <details className="dshx:text-xs dshx:text-muted-foreground">
              <summary className="dshx:cursor-pointer">How this works</summary>
              <p className="dshx:mt-2">
                {account.kind === 'claude'
                  ? 'Claude Code checks local sign-in configuration using the selected directory and Host environment, including CLAUDE_CODE_OAUTH_TOKEN. This is not remote token validation; quota may be unavailable. API keys have separate billing; setup-token verification requires access to the free token-count endpoint.'
                  : account.kind === 'codex'
                    ? 'Browser sign-in stages credentials privately before confirmation. Existing CLI homes are read in place, never copied or deleted. Custom shared homes need a distinct auth overlay.'
                    : account.kind === 'cursor'
                      ? 'Cursor tracks quota only, without a DSH model route. CLI login and named credentials stay separate.'
                      : 'Your selected sign-in method is checked before saving. Existing credentials are not replaced unless you explicitly choose to replace them.'}
              </p>
            </details>
          </>
        )}
        {notice === null || resultUnknown ? null : (
          <p role="alert" className="dshx:text-sm dshx:text-destructive">
            {notice}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            {newAccount && !resultUnknown ? 'Cancel' : 'Close'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const ConnectionBaseUrl = (props: { readonly account: AccountProfile; readonly busy: boolean; readonly save: (url: string) => void }): JSX.Element => {
  const [value, setValue] = useState(props.account.apiBaseUrl)
  return (
    <details className="dshx:rounded-md dshx:border dshx:p-3">
      <summary className="dshx:cursor-pointer dshx:text-sm">Connection settings</summary>
      <form
        className="dshx:mt-3 dshx:flex dshx:flex-col dshx:gap-2"
        onSubmit={event => {
          event.preventDefault()
          props.save(value)
        }}
      >
        <label className="dshx:text-sm" htmlFor="account-connection-base-url">
          API base URL
        </label>
        <Input
          id="account-connection-base-url"
          value={value}
          onChange={event => setValue(event.target.value)}
          placeholder="Default provider endpoint"
          disabled={props.busy}
        />
        <Button type="submit" variant="outline" disabled={props.busy || value === props.account.apiBaseUrl}>
          Apply connection settings
        </Button>
      </form>
    </details>
  )
}
