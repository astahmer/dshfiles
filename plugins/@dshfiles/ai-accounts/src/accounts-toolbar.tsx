import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Combobox } from '@dshfiles/plugin-ui/components/ui/combobox'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { CopyIcon, PlusIcon, SearchIcon } from '@dshfiles/plugin-ui/icons'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { useId } from 'react'
import { DISTRIBUTION_HINT, DISTRIBUTION_LABEL, DISTRIBUTIONS } from './account-labels.js'
import type { AccountsFile } from './api.js'
import type { AccountsPanelState } from './use-accounts-panel-state.js'

const OverlaySwitch = (props: { readonly label: string; readonly checked: boolean; readonly onChange: (checked: boolean) => void }): JSX.Element => {
  const id = useId()
  return (
    <span className="dshx:flex dshx:items-center dshx:gap-2">
      <Switch checked={props.checked} id={id} onCheckedChange={props.onChange} size="sm" />
      <Label className="dshx:text-xs dshx:font-normal dshx:text-muted-foreground" htmlFor={id}>
        {props.label}
      </Label>
    </span>
  )
}

export const AccountsToolbar = (props: {
  readonly state: AccountsPanelState
  readonly file: AccountsFile
  readonly search: string
  readonly onSearchChange: (value: string) => void
  readonly onAddAccount: () => void
}): JSX.Element => (
  <header className="dshx:flex dshx:flex-col dshx:gap-4">
    <div className="dshx:flex dshx:items-start dshx:justify-between dshx:gap-3">
      <div className="dshx:min-w-0">
        <h1 className="dshx:text-2xl dshx:font-semibold dshx:tracking-tight">AI Accounts</h1>
        <p className="dshx:mt-1 dshx:text-sm dshx:text-muted-foreground">Manage your connected providers, models and quota.</p>
      </div>
      <Button className="dshx:shrink" onClick={props.onAddAccount} size="sm" type="button">
        <PlusIcon /> Add account
      </Button>
    </div>
    <div className="dshx:relative">
      <SearchIcon aria-hidden className="dshx:pointer-events-none dshx:absolute dshx:top-2.5 dshx:left-3 dshx:size-4 dshx:text-muted-foreground" />
      <Input
        aria-label="Search accounts and known models"
        className="dshx:pl-9"
        onChange={event => props.onSearchChange(event.target.value)}
        placeholder="Search accounts or known models…"
        type="search"
        value={props.search}
      />
    </div>
    <details className="dshx:rounded-lg dshx:border dshx:bg-card dshx:px-3 dshx:py-2 dshx:text-xs">
      <summary className="dshx:cursor-pointer dshx:text-muted-foreground">Page options · routing and display</summary>
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-4 dshx:pt-3">
        <Button onClick={() => void props.state.copyPath()} size="xs" type="button" variant="outline">
          <CopyIcon />
          Copy accounts file path
        </Button>
        <OverlaySwitch
          checked={props.state.preferences.edgeWidget}
          label="Edge overlay"
          onChange={edgeWidget =>
            void props.state.preferences.settings.set('edgeWidget', edgeWidget).catch(() => props.state.setNotice('Settings are read-only here.'))
          }
        />
        <OverlaySwitch
          checked={props.state.preferences.footerButton}
          label="Sidebar foot"
          onChange={footerButton =>
            void props.state.preferences.settings.set('footerButton', footerButton).catch(() => props.state.setNotice('Settings are read-only here.'))
          }
        />
        <div className="dshx:min-w-0 dshx:w-48">
          <Combobox
            label="Request distribution"
            onValueChange={value => {
              const distribution = DISTRIBUTIONS.find(candidate => candidate === value)
              if (distribution === undefined) return
              void props.state.accounts
                .setDistribution({ distribution })
                .then(props.state.setFile)
                .catch(error => props.state.setNotice(`Could not change distribution: ${String(error)}`))
            }}
            options={DISTRIBUTIONS.map(value => ({ value, label: DISTRIBUTION_LABEL[value], description: DISTRIBUTION_HINT[value] }))}
            value={props.file.distribution}
          />
        </div>
        <p className="dshx:w-full dshx:text-muted-foreground">
          Routing and display options apply to all accounts on this host. {DISTRIBUTION_HINT[props.file.distribution]}
        </p>
      </div>
    </details>
  </header>
)
