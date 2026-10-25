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
import type { WorkspacePickerPorts } from '@dshfiles/project-folder-picker'
import type { CredentialSetupPort } from './credential-setup-port.js'

/** Account data and writes stay owned by the existing panel state; only search is local. */
export const AccountsPanel = (props: {
  readonly onOpenUsageHistory: () => void
  readonly onAddAccount: (onCreated?: (accountId: string) => void) => void
  readonly onConnectAccount: (accountId: string) => void
  readonly credentialSetup?: CredentialSetupPort | undefined
  readonly folderPicker: WorkspacePickerPorts
}): JSX.Element => {
  const state = useAccountsPanelState(props.credentialSetup)
  const [search, setSearch] = useState('')
  const addAccount = (): void => props.onAddAccount(state.setSelectedId)

  if (state.file === null) {
    return (
      <div className="dshx-root dshx:flex dshx:items-center dshx:gap-2 dshx:p-6 dshx:text-muted-foreground" role="status">
        {state.notice === null ? <Spinner /> : null}
        {state.notice ?? 'Loading accounts…'}
      </div>
    )
  }
  const visibleAccounts = filterPageAccounts(state.file.accounts, search, state.catalog)

  return (
    <TooltipProvider>
      <div className="dshx-root dshx:@container dshx:h-full dshx:min-h-0 dshx:overflow-auto dshx:bg-background">
        <div className="dshx:mx-auto dshx:flex dshx:min-h-full dshx:w-full dshx:max-w-[1440px] dshx:flex-col dshx:gap-5 dshx:p-6 dshx:@max-pane-narrow:gap-3 dshx:@max-pane-narrow:p-3">
          <AccountsToolbar file={state.file} onAddAccount={addAccount} onSearchChange={setSearch} search={search} state={state} />
          {state.notice === null ? null : (
            <p className="dshx:text-xs dshx:text-muted-foreground" role="status">
              {state.notice}
            </p>
          )}
          <QuotaContinuations accountId={state.selectedId} />
          <div className="dshx:grid dshx:min-w-0 dshx:flex-1 dshx:grid-cols-[minmax(250px,320px)_minmax(0,1fr)] dshx:items-start dshx:gap-5 dshx:@max-pane-compact:grid-cols-1 dshx:@max-pane-narrow:gap-3">
            <AccountRail accounts={visibleAccounts} file={state.file} searching={search.trim() !== ''} state={state} />
            {state.draft !== null ? (
              <AccountDetail
                key={state.selectedId ?? 'none'}
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
                      ? 'Connect a provider to choose your models and track real subscription quota.'
                      : 'Select an account to manage its models, settings and usage.'}
                  </EmptyDescription>
                </EmptyHeader>
                <Button onClick={addAccount} size="sm" type="button">
                  <PlusIcon />
                  Add account
                </Button>
              </Empty>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
