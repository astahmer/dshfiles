import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Combobox, type ComboboxOption } from '@dshfiles/plugin-ui/components/ui/combobox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { useMachine } from '@dshfiles/plugin-ui/machine'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { ProjectFolderPicker, type ProjectFolderSelection, type WorkspacePickerPorts } from '@dshfiles/project-folder-picker'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { aiAccountsQueries } from './accounts-queries.js'
import { AccountsRules, aiAccountsApi, type AccountDraft, type SecretCatalogKeyOption } from './api.js'
import { apiKeySetupMachineWithWriter } from './api-key-setup-machine.js'
import type { AccountsPanelState } from './use-accounts-panel-state.js'
import { preserveAccountNameEditOnEscape } from './account-name-escape.js'

const catalogOptionKey = (option: SecretCatalogKeyOption): string => JSON.stringify([option.scope, option.alias, option.environment, option.cwd])

interface SecretCatalogImportRequest {
  alias: string
  environment: string
  scope: 'global' | 'project' | 'local'
  cwd: string | null
  replaceExisting?: boolean
}

export const ApiKeySetupDialog = (props: {
  readonly draft: AccountDraft
  readonly state: Pick<AccountsPanelState, 'credentialInfo' | 'storeCredential' | 'importSecretCatalogKey'>
  readonly folderPicker: WorkspacePickerPorts
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly setupNotice?: string
  readonly errorNotice?: string | null
  readonly connectionControls?: ReactNode
  readonly submitLabel?: string
  readonly savingLabel?: string
  readonly credentialLabel?: string
  readonly connectionHeading?: ReactNode
  readonly connectionTitle?: string
}): JSX.Element => {
  const api = useApi(aiAccountsApi)
  const { onOpenChange } = props
  const [snapshot, send] = useMachine(apiKeySetupMachineWithWriter)
  const [manualValue, setManualValue] = useState('')
  const [selectedCatalogKey, setSelectedCatalogKey] = useState('')
  const [folderPickerOpen, setFolderPickerOpen] = useState(false)
  const [cwd, setCwd] = useState<string | null>(null)
  const catalogQuery = useQuery({ ...aiAccountsQueries.secretCatalogKeys(api, cwd), enabled: props.open && !folderPickerOpen, staleTime: 30_000 })
  const catalogKeys = catalogQuery.data?.items ?? []
  const catalogOptions: readonly ComboboxOption[] = catalogKeys.map(option => ({
    value: catalogOptionKey(option),
    label: `${option.alias} · ${option.environment} · ${option.scope} · ${option.service}`,
  }))
  const selectedCatalogEntry = catalogKeys.find(option => catalogOptionKey(option) === selectedCatalogKey)
  const catalogAvailable = catalogQuery.data?.available === true
  const validCredentialRef = AccountsRules.isKeyEnvName(props.draft.apiKeyEnv.trim())
  const credentialInfo = props.state.credentialInfo
  const targetWritable = credentialInfo?.writable === true
  const canReplace = credentialInfo?.configured === true && targetWritable
  const canImport = validCredentialRef && targetWritable && credentialInfo?.configured === false
  const busy = snapshot.matches('saving') || snapshot.matches('importing')
  const confirmingReplacement = snapshot.matches('confirming')

  const close = useCallback(
    (open: boolean): void => {
      if (!open) {
        send({ type: 'reset' })
        setManualValue('')
        setSelectedCatalogKey('')
        setFolderPickerOpen(false)
        setCwd(null)
      }
      onOpenChange(open)
    },
    [onOpenChange, send],
  )

  useEffect(() => {
    if (props.open) return
    send({ type: 'reset' })
    setManualValue('')
    setSelectedCatalogKey('')
    setFolderPickerOpen(false)
    setCwd(null)
  }, [props.open, send])

  useEffect(() => {
    send({ type: 'reset' })
    setManualValue('')
    setSelectedCatalogKey('')
    setFolderPickerOpen(false)
    setCwd(null)
  }, [props.draft.instanceId, props.draft.apiKeyEnv, send])

  useEffect(() => {
    if (snapshot.matches('success')) {
      close(false)
      return
    }
    if (snapshot.matches('error') && snapshot.context.operation === 'manual') setManualValue('')
  }, [close, snapshot])

  const chooseFolder = (selection: ProjectFolderSelection): void => {
    send({ type: 'reset' })
    setManualValue('')
    setSelectedCatalogKey('')
    setCwd(selection.canonicalPath)
    setFolderPickerOpen(false)
  }

  const saveManualKey = (): void => {
    if (manualValue.length === 0) return
    const ref = props.draft.apiKeyEnv.trim()
    send({ type: 'manual.submit', write: () => props.state.storeCredential({ ref, value: manualValue }) })
  }

  const importCatalogKey = (): void => {
    if (selectedCatalogEntry === undefined) return
    const request: SecretCatalogImportRequest = {
      alias: selectedCatalogEntry.alias,
      environment: selectedCatalogEntry.environment,
      scope: selectedCatalogEntry.scope,
      cwd: selectedCatalogEntry.cwd,
    }
    if (canReplace) request.replaceExisting = true
    send({ type: 'catalog.submit', requiresConfirmation: canReplace, write: () => props.state.importSecretCatalogKey(request) })
  }

  if (folderPickerOpen) {
    return (
      <ProjectFolderPicker
        directoryPicker={props.folderPicker.directoryPicker}
        onClose={() => setFolderPickerOpen(false)}
        onRegisterWorkspace={props.folderPicker.registerWorkspace}
        onSelect={chooseFolder}
        placeholder="Search projects or type / for a folder…"
        projects={[]}
        recentFolders={cwd === null ? [] : [cwd]}
        heading="Choose a Secret Catalog folder"
      />
    )
  }

  return (
    <Dialog onOpenChange={close} open={props.open}>
      <DialogContent onEscapeKeyDown={preserveAccountNameEditOnEscape} className="dshx-root dshx:max-h-[90dvh] dshx:max-w-lg dshx:overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{props.connectionTitle ?? `Configure ${props.draft.displayName} key`}</DialogTitle>
          <DialogDescription>
            {props.connectionTitle === undefined ? (
              <>
                Store or replace the key for <code className="dshx:font-mono!">{props.draft.apiKeyEnv.trim() || 'Choose a key name first'}</code>. The value
                never enters AI Accounts JSON or chat.
              </>
            ) : (
              'Enter a key to connect.'
            )}
          </DialogDescription>
          {props.connectionHeading}
          {props.setupNotice === undefined ? null : <p className="dshx:text-xs dshx:text-muted-foreground">{props.setupNotice}</p>}
          {props.errorNotice == null ? null : (
            <p className="dshx:text-sm dshx:text-destructive" role="alert">
              {props.errorNotice}
            </p>
          )}
        </DialogHeader>

        <div className="dshx:flex dshx:flex-col dshx:gap-4">
          {props.connectionControls === undefined ? null : <fieldset disabled={busy}>{props.connectionControls}</fieldset>}
          {!validCredentialRef ? (
            <section className="dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-md dshx:border dshx:p-3">
              <h3 className="dshx:text-sm dshx:font-medium">Choose where this account reads its key</h3>
              <p className="dshx:text-sm dshx:text-muted-foreground">
                Close this dialog and set a key name ending in _API_KEY first. Use the suggested name in Runtime paths, then open Set up key again.
              </p>
            </section>
          ) : null}
          <details className="dshx:order-2 dshx:text-sm">
            <summary className="dshx:mb-3 dshx:cursor-pointer dshx:text-xs dshx:text-muted-foreground">Import from Secret Catalog</summary>
            <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
              <Button
                disabled={busy}
                onClick={() => {
                  send({ type: 'reset' })
                  setManualValue('')
                  setSelectedCatalogKey('')
                  setFolderPickerOpen(true)
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                {cwd === null ? 'Browse project/local secrets…' : 'Choose another folder…'}
              </Button>
              {cwd !== null ? (
                <Button
                  disabled={busy}
                  onClick={() => {
                    send({ type: 'reset' })
                    setCwd(null)
                    setSelectedCatalogKey('')
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Show global only
                </Button>
              ) : null}
            </div>
            <p className="dshx:break-all dshx:text-xs dshx:text-muted-foreground">
              {cwd === null ? 'Showing global entries.' : `Showing entries for ${cwd}; project and local entries require the selected folder.`}
            </p>
            {validCredentialRef && catalogQuery.isFetching ? (
              <p className="dshx:text-sm dshx:text-muted-foreground">Loading value-free Secret Catalog metadata…</p>
            ) : null}
            {!validCredentialRef || catalogQuery.isFetching ? null : catalogAvailable ? (
              catalogKeys.length > 0 ? (
                <>
                  <span className="dshx:text-sm">Secret Catalog entry</span>
                  <Combobox
                    disabled={busy}
                    label="Secret Catalog entry"
                    matchTriggerWidth
                    onValueChange={value => {
                      send({ type: 'reset' })
                      setSelectedCatalogKey(value)
                    }}
                    options={catalogOptions}
                    placeholder="Choose an entry"
                    searchAbove={0}
                    searchPlaceholder="Search entries…"
                    value={selectedCatalogKey}
                  />
                  <p className="dshx:text-xs dshx:text-muted-foreground">
                    The Host imports the value directly into DSH credentials; it never crosses to this page. Unknown or ambiguous scopes are excluded.
                  </p>
                  {canReplace ? <p className="dshx:text-xs dshx:text-muted-foreground">This will replace the currently stored key for this account.</p> : null}
                  <Button
                    disabled={selectedCatalogEntry === undefined || busy || (!canImport && !canReplace)}
                    onClick={() => {
                      if (confirmingReplacement) send({ type: 'catalog.confirm' })
                      else importCatalogKey()
                    }}
                    size="sm"
                    type="button"
                  >
                    {snapshot.matches('importing')
                      ? 'Importing…'
                      : canReplace && !confirmingReplacement
                        ? 'Replace with selected entry…'
                        : 'Import selected entry'}
                  </Button>
                </>
              ) : (
                <p className="dshx:text-sm dshx:text-muted-foreground">No unique, supported entries are available for this selection.</p>
              )
            ) : (
              <p className="dshx:text-sm dshx:text-muted-foreground">
                Secret Catalog is unavailable. You can still enter a key below or configure this reference in the Host environment.
              </p>
            )}
          </details>

          <section className="dshx:flex dshx:flex-col dshx:gap-2">
            <label className="dshx:text-sm" htmlFor="ai-account-api-key-value">
              {props.credentialLabel ?? 'API key value'}
            </label>
            <Input
              autoComplete="new-password"
              className="dshx:font-mono! dshx:text-sm"
              disabled={busy}
              id="ai-account-api-key-value"
              onChange={event => setManualValue(event.target.value)}
              placeholder="Enter key"
              spellCheck={false}
              type="password"
              value={manualValue}
            />
            <p className="dshx:text-xs dshx:text-muted-foreground">
              {credentialInfo === null || credentialInfo === undefined
                ? 'Waiting for DSH to confirm this credential source is writable.'
                : targetWritable
                  ? canReplace
                    ? 'This replaces the stored credential.'
                    : 'Stored securely in DSH credentials.'
                  : 'This reference is supplied by a read-only source. Choose a different key name or update that source; DSH cannot replace it here.'}
            </p>
          </section>
        </div>

        <DialogFooter>
          <Button onClick={() => close(false)} type="button" variant="outline">
            Cancel
          </Button>
          <Button disabled={manualValue.length === 0 || busy || !validCredentialRef || !targetWritable} onClick={saveManualKey} type="button">
            {snapshot.matches('saving') ? (props.savingLabel ?? 'Saving…') : (props.submitLabel ?? (canReplace ? 'Replace key' : 'Store key'))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
