import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@dshfiles/plugin-ui/components/ui/empty'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { PlusIcon, UsersIcon } from '@dshfiles/plugin-ui/icons'
import { useState } from 'react'
import { AccountDetail } from './account-detail.js'
import { filterPageAccounts } from './account-page-model.js'
import { AccountRail } from './account-rail.js'
import { AccountsToolbar } from './accounts-toolbar.js'
import { QuotaContinuations } from './quota-continuations.js'
import { useAccountsPanelState } from './use-accounts-panel-state.js'
import { NativeProviderDetail } from './native-provider-detail.js'
import type { AccountSection } from './account-connection-status.js'
import type { WorkspacePickerPorts } from '@dshfiles/project-folder-picker'
import type { CredentialSetupPort } from './credential-setup-port.js'

/** The reference's rail and detail share one selection; Query owns data and the existing queue owns writes. */
export const AccountsPanel = (props: {
  readonly onOpenUsageHistory: () => void
  readonly onAddAccount: (onCreated?: (accountId: string) => void) => void
  readonly onConnectAccount: (accountId: string) => void
  readonly credentialSetup?: CredentialSetupPort | undefined
  readonly folderPicker: WorkspacePickerPorts
}): JSX.Element => {
  const state = useAccountsPanelState(props.credentialSetup)
  const [search, setSearch] = useState('')
  const [section, setSection] = useState<AccountSection>('models')
  const [nativeEntry, setNativeEntry] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const selectAccount = (accountId: string): void => {
    setNativeEntry(null)
    setRenaming(null)
    state.setSelectedId(accountId)
  }
  const selectSection = (accountId: string, next: AccountSection): void => {
    selectAccount(accountId)
    setSection(next)
  }
  const renameAccount = (accountId: string): void => {
    selectAccount(accountId)
    setRenaming(accountId)
  }
  const addAccount = (): void =>
    props.onAddAccount(accountId => {
      selectAccount(accountId)
      setSection('models')
    })
  if (state.file === null)
    return (
      <div className="dshx-root dshx:flex dshx:items-center dshx:gap-2 dshx:p-6 dshx:text-muted-foreground" role="status">
        {state.notice === null ? <Spinner /> : null}
        {state.notice ?? 'Loading accounts…'}
      </div>
    )
  const visible = filterPageAccounts(state.file.accounts, search, state.catalog)
  return (
    <TooltipProvider>
      <main data-account-dashboard className="dshx-root dshx:@container dshx:h-full dshx:min-h-0 dshx:overflow-auto dshx:bg-muted/10">
        <div className="dshx:mx-auto dshx:grid dshx:min-h-full dshx:w-full dshx:max-w-[1680px] dshx:grid-cols-[minmax(300px,36%)_minmax(0,1fr)] dshx:items-start dshx:gap-6 dshx:p-6 dshx:@max-pane-compact:grid-cols-1 dshx:@max-pane-narrow:gap-4 dshx:@max-pane-narrow:p-3">
          <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-4">
            <AccountsToolbar file={state.file} onAddAccount={addAccount} onSearchChange={setSearch} search={search} state={state} />
            <AccountRail
              accounts={visible}
              file={state.file}
              searching={search.trim() !== ''}
              search={search}
              state={state}
              activeSection={section}
              selectedNative={nativeEntry}
              onSelect={selectAccount}
              onSection={selectSection}
              onRename={renameAccount}
              onConnect={props.onConnectAccount}
              onSelectNative={entryId => {
                setNativeEntry(entryId)
                setRenaming(null)
              }}
            />
          </div>
          <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3">
            {state.notice === null ? null : (
              <p className="dshx:rounded-lg dshx:border dshx:bg-card dshx:px-4 dshx:py-2 dshx:text-xs dshx:text-muted-foreground" role="status">
                {state.notice}
              </p>
            )}
            {nativeEntry !== null ? (
              <NativeProviderDetail entryId={nativeEntry} section={section} onSectionChange={setSection} onOpenUsageHistory={props.onOpenUsageHistory} />
            ) : state.draft !== null ? (
              <AccountDetail
                key={state.selectedId ?? 'none'}
                activeSection={section}
                onSectionChange={setSection}
                editingName={renaming === state.draft.instanceId}
                onEditingNameChange={editing => setRenaming(editing ? (state.draft?.instanceId ?? null) : null)}
                draft={state.draft}
                file={state.file}
                folderPicker={props.folderPicker}
                onConnectAccount={props.onConnectAccount}
                onOpenUsageHistory={props.onOpenUsageHistory}
                state={state}
              />
            ) : (
              <Empty className="dshx:min-w-0 dshx:rounded-xl dshx:border dshx:bg-card dshx:py-16">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <UsersIcon />
                  </EmptyMedia>
                  <EmptyTitle className="dshx:text-base">Your accounts, side by side.</EmptyTitle>
                  <EmptyDescription>
                    {state.file.accounts.length === 0
                      ? 'Connect a provider to choose your models and track usage.'
                      : 'Select an account to manage its models, settings and usage.'}
                  </EmptyDescription>
                </EmptyHeader>
                <Button className="dshx:bg-info dshx:text-primary-foreground" onClick={addAccount} size="sm" type="button">
                  <PlusIcon />
                  Add account
                </Button>
              </Empty>
            )}
            <details className="dshx:rounded-lg dshx:border dshx:bg-card dshx:px-4 dshx:py-2.5">
              <summary className="dshx:cursor-pointer dshx:text-xs dshx:text-muted-foreground">Quota recovery</summary>
              <QuotaContinuations accountId={state.selectedId} />
            </details>
          </div>
        </div>
      </main>
    </TooltipProvider>
  )
}
