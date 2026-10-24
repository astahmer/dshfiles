import { AccountGroup } from './account-group.js'
import { KIND_GROUPS } from './account-labels.js'
import type { AccountProfile, AccountsFile } from './api.js'
import { NativeProvidersList } from './native-providers-list.js'
import type { AccountsPanelState } from './use-accounts-panel-state.js'

export const AccountRail = (props: {
  readonly state: AccountsPanelState
  readonly file: AccountsFile
  readonly accounts: readonly AccountProfile[]
  readonly searching: boolean
}): JSX.Element => (
  <aside aria-label="Provider accounts" className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-4">
    <div>
      <div className="dshx:flex dshx:items-baseline dshx:justify-between dshx:gap-2 dshx:pb-1">
        <h2 className="dshx:text-sm dshx:font-semibold">Your accounts</h2>
        <span className="dshx:text-xs dshx:text-muted-foreground">
          {props.searching ? `${props.accounts.length} of ` : ''}
          {props.file.accounts.length}
        </span>
      </div>
      <p className="dshx:text-xs dshx:text-muted-foreground">Priority follows this order within each provider.</p>
      {props.accounts.length === 0 ? (
        <p className="dshx:py-5 dshx:text-sm dshx:text-muted-foreground">
          {props.searching ? 'No accounts match. Search includes known models only.' : 'No accounts yet. Add an account to get started.'}
        </p>
      ) : null}
      <div className="dshx:@max-pane-compact:max-h-72 dshx:@max-pane-compact:overflow-y-auto">
        {KIND_GROUPS.map(kind => (
          <AccountGroup
            accounts={props.file.accounts.filter(profile => profile.kind === kind)}
            visibleIds={props.accounts.map(account => account.instanceId)}
            key={kind}
            kind={kind}
            onMove={(instanceId, direction) => props.state.moveAccount(instanceId, direction)}
            onSelect={props.state.setSelectedId}
            onToggle={profile => void props.state.toggleEnabled(profile)}
            reorderingDisabled={props.state.dirty || props.state.saving || props.state.reordering}
            selectedId={props.state.selectedId}
          />
        ))}
      </div>
    </div>
    <section className="dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-xl dshx:border dshx:bg-card dshx:p-3">
      <h2 className="dshx:text-sm dshx:font-semibold">Native providers</h2>
      <p className="dshx:text-xs dshx:text-muted-foreground">Profile integrations, separate from your accounts. Enable or disable their model routes here.</p>
      <NativeProvidersList compact />
    </section>
    <p className="dshx:text-xs dshx:text-muted-foreground">Credentials stay in their provider&apos;s configured credential store.</p>
  </aside>
)
