import { Combobox } from '@dshfiles/plugin-ui/components/ui/combobox'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import type { AccountDraft, AccountsCatalog } from './api.js'
import { AccountModelSettingsModel } from './account-model-settings.js'

const INHERIT_EFFORT = '__inherit__'
export interface AccountModelDefaultsProps {
  readonly draft: AccountDraft
  readonly catalog: readonly AccountsCatalog['models'][number][]
  readonly onChange: (patch: Partial<AccountDraft>) => void
}

export const AccountDefaultReasoningControl = (props: AccountModelDefaultsProps): JSX.Element => {
  const inherited = AccountModelSettingsModel.inheritsModelSettings(props.draft)
  const options = AccountModelSettingsModel.accountReasoningOptions(props.catalog)
  const saved = props.draft.defaultReasoningEffort
  const unavailable = saved != null && !options.some(option => option.value === saved)
  return (
    <div className="dshx-root dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1.5">
      <span className="dshx:text-xs dshx:text-muted-foreground">Default reasoning effort</span>
      <Combobox
        label="Default reasoning effort"
        onValueChange={value => props.onChange({ defaultReasoningEffort: value === INHERIT_EFFORT ? null : value, inheritModelSettings: false })}
        options={[
          { value: INHERIT_EFFORT, label: 'Inherit (Auto)' },
          ...options,
          ...(unavailable ? [{ value: saved, label: `${saved} (unavailable)`, disabled: true }] : []),
        ]}
        value={saved ?? INHERIT_EFFORT}
        triggerClassName="dshx:w-full"
      />
      <p className="dshx:text-xs dshx:text-muted-foreground">
        Used when no model-specific value is set, only on models that support it.{inherited && saved != null ? ' Saved value is paused while inheriting.' : ''}
      </p>
    </div>
  )
}

export const AccountInheritanceControl = (props: AccountModelDefaultsProps): JSX.Element => (
  <label className="dshx-root dshx:flex dshx:items-start dshx:gap-3">
    <Switch
      aria-label="Inherit model settings from provider"
      className="dshx:data-[state=checked]:bg-info"
      checked={AccountModelSettingsModel.inheritsModelSettings(props.draft)}
      onCheckedChange={checked => props.onChange({ inheritModelSettings: checked })}
    />
    <span className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
      <span className="dshx:text-sm">Inherit model settings from provider</span>
      <span className="dshx:text-xs dshx:text-muted-foreground">
        Use the provider’s native catalog and reasoning defaults. Account customizations are kept, but paused.
      </span>
    </span>
  </label>
)

/** One authored draft, shared by the Settings page and the inline Models settings. */
export const AccountModelDefaults = (props: AccountModelDefaultsProps): JSX.Element => (
  <div className="dshx-root dshx:@container dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-4">
    <AccountDefaultReasoningControl {...props} />
    <div className="dshx:border-t dshx:pt-3">
      <AccountInheritanceControl {...props} />
    </div>
  </div>
)
