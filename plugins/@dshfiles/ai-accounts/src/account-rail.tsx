import { AccountGroup } from './account-group.js'
import { KIND_GROUPS } from './account-labels.js'
import type { AccountProfile, AccountsFile } from './api.js'
import { NativeProvidersList } from './native-providers-list.js'
import type { AccountsPanelState } from './use-accounts-panel-state.js'
import type { AccountSection } from './account-connection-status.js'

export const AccountRail = (props: {
  readonly state: AccountsPanelState
  readonly file: AccountsFile
  readonly accounts: readonly AccountProfile[]
  readonly searching: boolean
  readonly search: string
  readonly activeSection: AccountSection
  readonly selectedNative: string | null
  readonly onSelect: (accountId: string) => void
  readonly onSection: (accountId: string, section: AccountSection) => void
  readonly onRename: (accountId: string) => void
  readonly onConnect: (accountId: string) => void
  readonly onSelectNative: (entryId: string) => void
}): JSX.Element => (
  <aside aria-label="Provider accounts" className="dshx:@container dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2">
    <h2 className="dshx:sr-only">Your accounts</h2>
    {props.accounts.length === 0 ? (
      <p className="dshx:py-5 dshx:text-sm dshx:text-muted-foreground">
        {props.searching ? 'No accounts match. Search includes known models only.' : 'No accounts yet. Add an account to get started.'}
      </p>
    ) : null}
    {KIND_GROUPS.map(kind => (
      <AccountGroup
        accounts={props.file.accounts.filter(profile => profile.kind === kind)}
        visibleIds={props.accounts.map(account => account.instanceId)}
        key={kind}
        kind={kind}
        onMove={(instanceId, direction) => props.state.moveAccount(instanceId, direction)}
        onSelect={props.onSelect}
        onToggle={profile => void props.state.toggleEnabled(profile)}
        reorderingDisabled={props.state.dirty || props.state.saving || props.state.reordering}
        selectedId={props.selectedNative === null ? props.state.selectedId : null}
        activeSection={props.activeSection}
        onSection={props.onSection}
        onRename={props.onRename}
        onConnect={props.onConnect}
        usage={props.state.usage}
      />
    ))}
    <section aria-label="Built-in providers">
      <h2 className="dshx:sr-only">Native providers</h2>
      <NativeProvidersList selectedEntryId={props.selectedNative} onSelect={props.onSelectNative} search={props.search} />
    </section>
  </aside>
)
