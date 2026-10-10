import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
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

export const AccountsToolbar = (props: { readonly state: AccountsPanelState; readonly file: AccountsFile }): JSX.Element => (
  <header className="dshx:mx-auto dshx:flex dshx:w-full dshx:max-w-[1600px] dshx:flex-wrap dshx:items-center dshx:justify-center dshx:gap-x-5 dshx:gap-y-2 dshx:text-xs dshx:text-muted-foreground">
    <span>
      Applying settings for <strong className="dshx:font-semibold dshx:text-foreground">All accounts</strong> on{' '}
      <strong className="dshx:font-semibold dshx:text-foreground">this host</strong>
    </span>
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
    <span className="dshx:flex dshx:items-center dshx:gap-2">
      <span>Spreading requests</span>
      <Select
        onValueChange={value => {
          const distribution = DISTRIBUTIONS.find(candidate => candidate === value)
          if (distribution === undefined) return
          void props.state.accounts
            .setDistribution({ distribution })
            .then(props.state.setFile)
            .catch(error => props.state.setNotice(`Could not change distribution: ${String(error)}`))
        }}
        value={props.file.distribution}
      >
        <SelectTrigger aria-label="Request distribution" className="dshx:h-6 dshx:text-xs" size="sm">
          <SelectValue>{DISTRIBUTION_LABEL[props.file.distribution]}</SelectValue>
        </SelectTrigger>
        <SelectContent className="dshx:w-80 dshx:max-w-[calc(100vw-2rem)]">
          {DISTRIBUTIONS.map(value => (
            <SelectItem className="dshx:items-start dshx:py-2" key={value} value={value}>
              <span className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5">
                <span>{DISTRIBUTION_LABEL[value]}</span>
                <span className="dshx:whitespace-normal dshx:text-xs dshx:text-muted-foreground">{DISTRIBUTION_HINT[value]}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </span>
  </header>
)
