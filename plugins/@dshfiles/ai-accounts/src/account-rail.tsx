import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { PlusIcon } from '@dshfiles/plugin-ui/icons'
import { AccountGroup } from './account-group.js'
import { KIND_ACCENT, KIND_GROUPS, KIND_LABEL } from './account-labels.js'
import type { AccountsFile } from './api.js'
import { NativeProvidersList } from './native-providers-list.js'
import { ProviderMark } from './panel-primitives.js'
import type { AccountsPanelState } from './use-accounts-panel-state.js'

export const AccountRail = (props: { readonly state: AccountsPanelState; readonly file: AccountsFile }): JSX.Element => (
  <aside aria-label="Provider accounts" className="dshx:flex dshx:min-h-0 dshx:flex-col dshx:overflow-y-auto dshx:border-r dshx:px-2 dshx:py-3">
    <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2 dshx:px-2 dshx:pb-1.5">
      <span className="dshx:text-[11px] dshx:font-semibold dshx:tracking-wider dshx:whitespace-nowrap dshx:text-muted-foreground">
        YOUR ACCOUNTS <span className="dshx:ml-0.5 dshx:opacity-70">{props.file.accounts.length}</span>
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label="Add account" size="icon-xs" type="button" variant="outline">
            <PlusIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="dshx-root dshx:w-48">
          {KIND_GROUPS.map(kind => (
            <DropdownMenuItem disabled={props.state.saving} key={kind} onSelect={() => void props.state.createAccount(kind)}>
              <ProviderMark badge={KIND_LABEL[kind].slice(0, 2).toUpperCase()} color={KIND_ACCENT[kind]} />
              {KIND_LABEL[kind]} account
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    {props.file.accounts.length === 0 ? (
      <p className="dshx:px-2 dshx:py-1 dshx:text-xs dshx:text-muted-foreground">Add an account to publish its own model route.</p>
    ) : null}
    {KIND_GROUPS.map(kind => (
      <AccountGroup
        accounts={props.file.accounts.filter(profile => profile.kind === kind)}
        key={kind}
        kind={kind}
        onSelect={props.state.setSelectedId}
        onToggle={profile => void props.state.toggleEnabled(profile)}
        selectedId={props.state.selectedId}
      />
    ))}
    <section className="dshx:flex dshx:flex-col dshx:gap-0.5 dshx:pt-3">
      <h2 className="dshx:px-2 dshx:pb-1 dshx:text-[11px] dshx:font-semibold dshx:tracking-wider dshx:text-muted-foreground dshx:uppercase">
        Native providers
      </h2>
      <NativeProvidersList compact />
    </section>
    <p className="dshx:mt-auto dshx:px-2 dshx:pt-3.5 dshx:text-xs dshx:text-muted-foreground">
      Credentials stay in their provider&apos;s configured credential store.
    </p>
  </aside>
)
