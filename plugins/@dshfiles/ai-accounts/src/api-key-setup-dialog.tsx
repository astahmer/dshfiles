import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@dshfiles/plugin-ui/components/ui/dialog'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { ProjectFolderPicker, type ProjectFolderSelection, type WorkspacePickerPorts } from '@dshfiles/project-folder-picker'
import { useState } from 'react'
import { aiAccountsApi, type AccountDraft, type SecretCatalogKeyOption } from './api.js'
import { aiAccountsQueries } from './accounts-queries.js'
import type { AccountsPanelState } from './use-accounts-panel-state.js'

const catalogOptionKey = (option: SecretCatalogKeyOption): string =>
  JSON.stringify([option.scope, option.alias, option.environment, option.cwd])

export const ApiKeySetupDialog = (props: {
  readonly draft: AccountDraft
  readonly state: AccountsPanelState
  readonly folderPicker: WorkspacePickerPorts
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}): JSX.Element => {
  const api = useApi(aiAccountsApi)
  const [manualValue, setManualValue] = useState('')
  const [selectedCatalogKey, setSelectedCatalogKey] = useState('')
  const [folderPickerOpen, setFolderPickerOpen] = useState(false)
  const [cwd, setCwd] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const catalogQuery = useQuery({ ...aiAccountsQueries.secretCatalogKeys(api, cwd), enabled: props.open && !folderPickerOpen, staleTime: 30_000 })
  const catalogKeys = catalogQuery.data?.items ?? []
  const selectedCatalogEntry = catalogKeys.find(option => catalogOptionKey(option) === selectedCatalogKey)
  const catalogAvailable = catalogQuery.data?.available === true

  const close = (open: boolean): void => {
    if (!open) {
      setManualValue('')
      setSelectedCatalogKey('')
      setFolderPickerOpen(false)
      setCwd(null)
    }
    props.onOpenChange(open)
  }

  const chooseFolder = (selection: ProjectFolderSelection): void => {
    setManualValue('')
    setSelectedCatalogKey('')
    setCwd(selection.canonicalPath)
    setFolderPickerOpen(false)
  }

  const saveManualKey = async (): Promise<void> => {
    if (manualValue.length === 0) return
    setSaving(true)
    let saved = false
    try {
      saved = await props.state.storeCredential({ ref: props.draft.apiKeyEnv.trim(), value: manualValue })
    } catch {
      saved = false
    } finally {
      setSaving(false)
      setManualValue('')
    }
    if (saved) close(false)
  }

  const importCatalogKey = async (): Promise<void> => {
    if (selectedCatalogEntry === undefined) return
    setImporting(true)
    let imported = false
    try {
      imported = await props.state.importSecretCatalogKey({
        alias: selectedCatalogEntry.alias,
        environment: selectedCatalogEntry.environment,
        scope: selectedCatalogEntry.scope,
        cwd: selectedCatalogEntry.cwd,
      })
    } catch {
      imported = false
    } finally {
      setImporting(false)
    }
    if (imported) close(false)
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
        title="Choose a Secret Catalog folder"
      />
    )
  }

  return (
    <Dialog onOpenChange={close} open={props.open}>
      <DialogContent className="dshx-root dshx:max-w-lg">
        <DialogHeader>
          <DialogTitle>Configure {props.draft.displayName} key</DialogTitle>
          <DialogDescription>
            Store a key for <code className="dshx:font-mono!">{props.draft.apiKeyEnv.trim()}</code>. The value never enters AI Accounts JSON or chat.
          </DialogDescription>
        </DialogHeader>

        <div className="dshx:flex dshx:flex-col dshx:gap-4">
          <section className="dshx:flex dshx:flex-col dshx:gap-2">
            <h3 className="dshx:text-sm dshx:font-medium">Use a Secret Catalog entry</h3>
            <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
              <Button
                onClick={() => {
                  setManualValue('')
                  setFolderPickerOpen(true)
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                {cwd === null ? 'Browse project/local secrets…' : 'Choose another folder…'}
              </Button>
              {cwd !== null ? (
                <Button onClick={() => { setCwd(null); setSelectedCatalogKey('') }} size="sm" type="button" variant="ghost">
                  Show global only
                </Button>
              ) : null}
            </div>
            <p className="dshx:break-all dshx:text-xs dshx:text-muted-foreground">
              {cwd === null ? 'Showing global entries.' : `Showing entries for ${cwd}; project and local entries require the selected folder.`}
            </p>
            {catalogQuery.isFetching ? (
              <p className="dshx:text-sm dshx:text-muted-foreground">Loading value-free Secret Catalog metadata…</p>
            ) : catalogAvailable ? (
              catalogKeys.length > 0 ? (
                <>
                  <label className="dshx:text-sm" htmlFor="ai-account-secret-catalog-entry">Secret Catalog entry</label>
                  <select
                    aria-label="Secret Catalog entry"
                    className="dshx:h-9 dshx:w-full dshx:rounded-md dshx:border dshx:border-input dshx:bg-background dshx:px-3 dshx:text-sm"
                    id="ai-account-secret-catalog-entry"
                    onChange={event => setSelectedCatalogKey(event.target.value)}
                    value={selectedCatalogKey}
                  >
                    <option value="">Choose an entry</option>
                    {catalogKeys.map(option => (
                      <option key={catalogOptionKey(option)} value={catalogOptionKey(option)}>
                        {option.alias} · {option.environment} · {option.scope} · {option.service}
                      </option>
                    ))}
                  </select>
                  <p className="dshx:text-xs dshx:text-muted-foreground">
                    The Host imports the value directly into DSH credentials; it never crosses to this page. Unknown or ambiguous scopes are excluded.
                  </p>
                  <Button disabled={selectedCatalogEntry === undefined || importing} onClick={() => void importCatalogKey()} size="sm" type="button">
                    {importing ? 'Importing…' : 'Import selected entry'}
                  </Button>
                </>
              ) : (
                <p className="dshx:text-sm dshx:text-muted-foreground">No unique, supported entries are available for this selection.</p>
              )
            ) : (
              <p className="dshx:text-sm dshx:text-muted-foreground">
                Secret Catalog is unavailable. You can enter a key here or configure the variable in the Host environment.
              </p>
            )}
          </section>

          <section className="dshx:flex dshx:flex-col dshx:gap-2 dshx:border-t dshx:pt-4">
            <h3 className="dshx:text-sm dshx:font-medium">Or enter a key</h3>
            <label className="dshx:text-sm" htmlFor="ai-account-api-key-value">API key value</label>
            <Input
              autoComplete="new-password"
              className="dshx:font-mono! dshx:text-sm"
              id="ai-account-api-key-value"
              onChange={event => setManualValue(event.target.value)}
              placeholder="Enter key"
              spellCheck={false}
              type="password"
              value={manualValue}
            />
            <p className="dshx:text-xs dshx:text-muted-foreground">Stored through DSH’s write-only credential API, not in the account profile.</p>
          </section>
        </div>

        <DialogFooter>
          <Button onClick={() => close(false)} type="button" variant="outline">Cancel</Button>
          <Button disabled={manualValue.length === 0 || saving} onClick={() => void saveManualKey()} type="button">
            {saving ? 'Saving…' : 'Store key'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
