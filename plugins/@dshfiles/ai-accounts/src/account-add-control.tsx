import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { PlusIcon } from '@dshfiles/plugin-ui/icons'
import { KIND_ACCENT, KIND_GROUPS, KIND_LABEL } from './account-labels.js'
import { ProviderMark } from './panel-primitives.js'
import type { AccountsPanelState } from './use-accounts-panel-state.js'

/** Keep the existing provider creation path independent of any setup wizard. */
export const AccountAddControl = (props: { readonly state: Pick<AccountsPanelState, 'saving' | 'createAccount'>; readonly label?: string }): JSX.Element => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button className="dshx:shrink dshx:@max-pane-narrow:w-full" size="sm" type="button">
        <PlusIcon /> {props.label ?? 'Add account'}
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
)
