import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Combobox } from '@dshfiles/plugin-ui/components/ui/combobox'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { CopyIcon, MoreHorizontalIcon, PlusIcon, SearchIcon } from '@dshfiles/plugin-ui/icons'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { useEffect, useId, useRef } from 'react'
import { DISTRIBUTION_HINT, DISTRIBUTION_LABEL, DISTRIBUTIONS } from './account-labels.js'
import type { AccountsFile } from './api.js'
import type { AccountsPanelState } from './use-accounts-panel-state.js'
const OverlaySwitch = (props: { readonly label: string; readonly checked: boolean; readonly onChange: (checked: boolean) => void }): JSX.Element => {
  const id = useId()
  return (
    <span className="dshx:flex dshx:items-center dshx:gap-2">
      <Switch checked={props.checked} className="dshx:data-[state=checked]:bg-info" id={id} onCheckedChange={props.onChange} size="sm" />
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
}): JSX.Element => {
  const searchRef = useRef<HTMLInputElement>(null)
  const headerRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLocaleLowerCase() !== 'k' || event.altKey || event.shiftKey) return
      if (!headerRef.current?.getClientRects().length || document.querySelector('[role="dialog"][data-state="open"]') !== null) return
      event.preventDefault()
      event.stopImmediatePropagation()
      searchRef.current?.focus()
    }
    document.addEventListener('keydown', focusSearch, true)
    return () => document.removeEventListener('keydown', focusSearch, true)
  }, [])
  return (
    <header ref={headerRef} className="dshx:flex dshx:flex-col dshx:gap-5 dshx:pb-1">
      <div className="dshx:flex dshx:items-start dshx:justify-between dshx:gap-3">
        <div className="dshx:min-w-0">
          <h1 className="dshx:text-2xl dshx:font-semibold dshx:tracking-tight">AI Accounts</h1>
          <p className="dshx:mt-1 dshx:text-sm dshx:text-muted-foreground">Manage your accounts and model settings.</p>
        </div>
        <Button className="dshx:h-10 dshx:shrink dshx:bg-info dshx:text-primary-foreground dshx:hover:bg-info/90" onClick={props.onAddAccount} type="button">
          <PlusIcon />
          Add account
        </Button>
      </div>
      <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
        <div className="dshx:relative dshx:min-w-0 dshx:flex-1">
          <SearchIcon aria-hidden className="dshx:pointer-events-none dshx:absolute dshx:top-3 dshx:left-3 dshx:size-4 dshx:text-muted-foreground" />
          <Input
            aria-label="Search accounts and known models"
            aria-keyshortcuts="Control+K Meta+K"
            className="dshx:h-10 dshx:pr-12 dshx:pl-9"
            onChange={event => props.onSearchChange(event.target.value)}
            placeholder="Search accounts or models…"
            ref={searchRef}
            type="search"
            value={props.search}
          />
          <kbd className="dshx:pointer-events-none dshx:absolute dshx:top-2.5 dshx:right-3 dshx:rounded dshx:bg-muted dshx:px-1 dshx:text-[11px] dshx:text-muted-foreground">
            ⌘K
          </kbd>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button aria-label="Account page options" size="icon-sm" type="button" variant="ghost">
              <MoreHorizontalIcon />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="dshx-root dshx:w-80 dshx:space-y-4">
            <h2 className="dshx:text-sm dshx:font-semibold">Routing and display</h2>
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
            <Combobox
              label="Request distribution"
              onValueChange={value => {
                const distribution = DISTRIBUTIONS.find(candidate => candidate === value)
                if (distribution !== undefined)
                  void props.state.accounts
                    .setDistribution({ distribution })
                    .then(props.state.setFile)
                    .catch(() => props.state.setNotice('Could not change request distribution.'))
              }}
              options={DISTRIBUTIONS.map(value => ({ value, label: DISTRIBUTION_LABEL[value], description: DISTRIBUTION_HINT[value] }))}
              value={props.file.distribution}
            />
            <p className="dshx:text-xs dshx:text-muted-foreground">{DISTRIBUTION_HINT[props.file.distribution]}</p>
          </PopoverContent>
        </Popover>
      </div>
    </header>
  )
}
