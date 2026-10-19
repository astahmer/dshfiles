import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@dshfiles/plugin-ui/components/ui/empty'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { UsersIcon } from '@dshfiles/plugin-ui/icons'
import { AccountDetail } from './account-detail.js'
import { AccountRail } from './account-rail.js'
import { AccountsToolbar } from './accounts-toolbar.js'
import { QuotaContinuations } from './quota-continuations.js'
import { useAccountsPanelState } from './use-accounts-panel-state.js'
import type { WorkspacePickerPorts } from '@dshfiles/project-folder-picker'
import type { CredentialSetupPort } from './credential-setup-port.js'

/**
 * The accounts page, in the shape of the reference account page: a rail of
 * toggleable providers on one side, the selected provider's numbered settings
 * sections on the other, inside one bordered shell.
 *
 * Every write goes through the Host, which also owns the file, so the page and an
 * agent share one source of truth. Nothing here holds a credential: an account
 * shows whether it holds a login, who that login belongs to, and the exact
 * command that creates one.
 */
export const AccountsPanel = (props: {
  readonly onOpenUsageHistory: () => void
  readonly credentialSetup?: CredentialSetupPort | undefined
  readonly folderPicker: WorkspacePickerPorts
}): JSX.Element => {
  const state = useAccountsPanelState(props.credentialSetup)

  if (state.file === null) {
    return (
      <div className="dshx-root dshx:flex dshx:items-center dshx:gap-2 dshx:p-6 dshx:text-muted-foreground" role="status">
        {state.notice === null ? <Spinner /> : null}
        {state.notice ?? 'Loading accounts…'}
      </div>
    )
  }

  return (
    <div className="dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:gap-3 dshx:overflow-hidden dshx:px-6 dshx:py-3.5">
      <AccountsToolbar file={state.file} state={state} />
      {state.notice === null ? null : (
        <p className="dshx:text-xs dshx:text-muted-foreground" role="status">
          {state.notice}
        </p>
      )}

      <QuotaContinuations accountId={state.selectedId} />

      <div className="dshx:mx-auto dshx:grid dshx:min-h-0 dshx:w-full dshx:max-w-[1600px] dshx:flex-1 dshx:grid-cols-[minmax(220px,250px)_minmax(0,1fr)] dshx:overflow-hidden dshx:rounded-xl dshx:border dshx:bg-card">
        <AccountRail file={state.file} state={state} />

        {state.draft !== null ? (
          <AccountDetail
            key={state.selectedId ?? 'none'}
            draft={state.draft}
            file={state.file}
            folderPicker={props.folderPicker}
            onOpenUsageHistory={props.onOpenUsageHistory}
            state={state}
          />
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UsersIcon />
              </EmptyMedia>
              <EmptyTitle className="dshx:text-base">Your accounts, side by side.</EmptyTitle>
              <EmptyDescription>
                Create a Codex, Claude, GitHub Copilot, OpenCode Go, Command Code or Cursor profile. Each subscription becomes its own route in the model
                picker; Cursor tracks quota for the Cursor Agent runtime.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </div>
  )
}
