import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Combobox } from '@dshfiles/plugin-ui/components/ui/combobox'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { BarChart3Icon, CheckIcon, CopyIcon, PencilIcon, RefreshCwIcon, SlidersHorizontalIcon, UserRoundIcon } from '@dshfiles/plugin-ui/icons'
import { useState } from 'react'
import { useCopyFeedback } from '@dshfiles/plugin-ui/hooks/copy-feedback'
import { KIND_LABEL, routedKind } from './account-labels.js'
import { accountAuthenticationLabel, accountConnectionStatus } from './account-connection-status.js'
import { AccountIdentitySection } from './account-identity-section.js'
import { AccountDefaultReasoningControl, AccountInheritanceControl } from './account-model-defaults.js'
import { RuntimePathsSection } from './runtime-paths-section.js'
import type { AccountDraft, AccountsFile } from './api.js'
import type { AccountsPanelState } from './use-accounts-panel-state.js'
import type { WorkspacePickerPorts } from '@dshfiles/project-folder-picker'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { StatusDot } from '@dshfiles/plugin-ui/components/ui/status-dot'

const cardClass =
  'dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-4 dshx:rounded-lg dshx:border dshx:border-border/70 dshx:bg-card dshx:p-5 dshx:@max-pane-narrow:p-4'
interface SettingsProps {
  readonly draft: AccountDraft
  readonly file: AccountsFile
  readonly state: AccountsPanelState
}
const PriorityControl = (props: SettingsProps): JSX.Element => {
  const peers = props.file.accounts.filter(account => account.kind === props.draft.kind)
  const index = peers.findIndex(account => account.instanceId === props.draft.instanceId)
  return (
    <Combobox
      disabled={props.state.dirty || props.state.saving || props.state.reordering || index < 0}
      label="Routing priority"
      onValueChange={value => {
        const target = peers.find(account => account.instanceId === value)
        if (target === undefined || target.instanceId === props.draft.instanceId) return
        void props.state.accounts
          .reorderAccount({
            instanceId: props.draft.instanceId,
            targetInstanceId: target.instanceId,
            placement: peers.indexOf(target) < index ? 'before' : 'after',
            expectedOrder: peers.map(account => account.instanceId),
          })
          .then(props.state.setFile)
          .catch(() => props.state.setNotice('Could not change routing priority. Refresh and try again.'))
      }}
      options={peers.map((account, i) => ({ value: account.instanceId, label: `${i + 1}${i === 0 ? ' (first)' : ''}` }))}
      value={props.draft.instanceId}
    />
  )
}
const RoutingSwitch = (props: Pick<SettingsProps, 'draft' | 'state'>): JSX.Element => (
  <label className="dshx:flex dshx:items-start dshx:gap-3">
    <Switch
      aria-label={routedKind(props.draft.kind) ? 'Enable for model routing' : 'Enable quota tracking'}
      checked={props.draft.enabled}
      className="dshx:mt-0.5 dshx:data-[state=checked]:bg-info"
      onCheckedChange={enabled => void props.state.persist({ enabled })}
    />
    <span>
      <span className="dshx:block dshx:text-sm">{routedKind(props.draft.kind) ? 'Enable for model routing' : 'Enable quota tracking'}</span>
      <span className="dshx:mt-1 dshx:block dshx:text-xs dshx:text-muted-foreground">
        {routedKind(props.draft.kind) ? 'Allow this account to be used when selecting models.' : 'Include this account in subscription quota readings.'}
      </span>
    </span>
  </label>
)
const AccountRoutingSettings = (props: SettingsProps): JSX.Element => (
  <section aria-label="Routing and priority" className={cardClass}>
    <header className="dshx:flex dshx:items-start dshx:gap-3">
      <BarChart3Icon className="dshx:mt-0.5 dshx:size-5 dshx:shrink-0" />
      <div>
        <h3 className="dshx:text-sm dshx:font-semibold">Routing & priority</h3>
        <p className="dshx:mt-1 dshx:text-xs dshx:text-muted-foreground">Control how this account is used when multiple accounts are available.</p>
      </div>
    </header>
    <div className="dshx:grid dshx:grid-cols-[minmax(120px,0.7fr)_minmax(0,1fr)] dshx:items-center dshx:gap-3 dshx:border-t dshx:pt-4 dshx:@max-pane-narrow:grid-cols-1">
      <span className="dshx:text-xs dshx:text-muted-foreground">Priority</span>
      <div className="dshx:min-w-0">
        <PriorityControl {...props} />
        <p className="dshx:mt-1.5 dshx:text-[11px] dshx:text-muted-foreground">Lower numbers are tried first within {KIND_LABEL[props.draft.kind]}.</p>
      </div>
    </div>
    <RoutingSwitch draft={props.draft} state={props.state} />
  </section>
)

const AccountAuthenticationDetails = (props: Pick<SettingsProps, 'draft' | 'state'> & { readonly onConnect: () => void }): JSX.Element => {
  const profile = props.state.selected
  const status = profile === null ? null : accountConnectionStatus(profile, props.state.usage)
  return (
    <section aria-label="Authentication" className="dshx:min-w-0 dshx:space-y-3">
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-2">
        <h3 className="dshx:text-sm dshx:font-semibold">Authentication</h3>
        <Button disabled={props.state.dirty || props.state.saving || profile === null} onClick={props.onConnect} size="sm" type="button" variant="outline">
          <RefreshCwIcon />
          Reauthenticate
        </Button>
      </div>
      <dl className="dshx:grid dshx:grid-cols-[minmax(120px,0.7fr)_minmax(0,1fr)] dshx:gap-x-4 dshx:gap-y-3 dshx:text-xs dshx:@max-pane-narrow:grid-cols-1">
        <dt className="dshx:text-muted-foreground">Authentication method</dt>
        <dd>{accountAuthenticationLabel(props.draft)}</dd>
        <dt className="dshx:text-muted-foreground">Signed in as</dt>
        <dd className="dshx:break-words">{profile?.identity ?? 'Not reported by provider'}</dd>
        <dt className="dshx:text-muted-foreground">Token status</dt>
        <dd className={status?.tone === 'success' ? 'dshx:text-success' : 'dshx:text-muted-foreground'}>
          {status?.authenticated ? 'Authenticated' : (status?.label ?? 'Not verified')}
        </dd>
        <dt className="dshx:text-muted-foreground">Last checked</dt>
        <dd>{status?.checkedAt == null ? 'No provider check available' : new Date(status.checkedAt).toLocaleString()}</dd>
      </dl>
    </section>
  )
}

export const AccountInlineSettings = (props: SettingsProps & { readonly onConnect: () => void }): JSX.Element => {
  const modelProps = {
    draft: props.draft,
    catalog: props.state.catalog?.models ?? [],
    onChange: (patch: Partial<AccountDraft>) => props.state.setDraft({ ...props.draft, ...patch }),
  }
  return (
    <section aria-label="Inline account settings" className={cardClass}>
      <header>
        <h3 className="dshx:text-sm dshx:font-semibold">Settings</h3>
        <p className="dshx:mt-1 dshx:text-xs dshx:text-muted-foreground">Account-specific settings. Leave as default to use provider settings.</p>
      </header>
      <div className="dshx:grid dshx:grid-cols-3 dshx:items-start dshx:gap-4 dshx:@max-pane-compact:grid-cols-1">
        <label className="dshx:min-w-0 dshx:space-y-1.5">
          <span className="dshx:text-xs dshx:text-muted-foreground">Account name</span>
          <Input
            aria-label="Account name"
            maxLength={120}
            onChange={event => props.state.setDraft({ ...props.draft, displayName: event.target.value })}
            value={props.draft.displayName}
          />
        </label>
        <div className="dshx:min-w-0 dshx:space-y-1.5">
          <span className="dshx:text-xs dshx:text-muted-foreground">Routing priority</span>
          <PriorityControl {...props} />
        </div>
        <AccountDefaultReasoningControl {...modelProps} />
      </div>
      <div className="dshx:border-t dshx:pt-3">
        <AccountInheritanceControl {...modelProps} />
      </div>
      <RoutingSwitch draft={props.draft} state={props.state} />
      <div className="dshx:border-t dshx:pt-4">
        <AccountAuthenticationDetails draft={props.draft} state={props.state} onConnect={props.onConnect} />
      </div>
    </section>
  )
}

export const AccountSettings = (props: SettingsProps & { readonly folderPicker: WorkspacePickerPorts; readonly onConnect: () => void }): JSX.Element => {
  const [editing, setEditing] = useState(false)
  const accountIdCopy = useCopyFeedback()
  const selected = props.state.selected
  const status = selected === null ? null : accountConnectionStatus(selected, props.state.usage)
  return (
    <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-4">
      <section aria-label="Account details" className={cardClass}>
        <header className="dshx:flex dshx:items-start dshx:gap-3">
          <UserRoundIcon className="dshx:mt-0.5 dshx:size-5 dshx:shrink-0" />
          <div className="dshx:min-w-0 dshx:flex-1">
            <h3 className="dshx:text-sm dshx:font-semibold">Account details</h3>
            <p className="dshx:mt-1 dshx:text-xs dshx:text-muted-foreground">Basic information and authentication.</p>
          </div>
          <Button aria-pressed={editing} onClick={() => setEditing(!editing)} size="sm" type="button" variant="outline">
            <PencilIcon />
            {editing ? 'Done' : 'Edit'}
          </Button>
        </header>
        <dl className="dshx:grid dshx:grid-cols-[minmax(120px,0.7fr)_minmax(0,1fr)] dshx:items-center dshx:gap-x-6 dshx:gap-y-4 dshx:border-t dshx:pt-4 dshx:text-sm dshx:@max-pane-narrow:grid-cols-1">
          <dt className="dshx:text-xs dshx:text-muted-foreground">Name</dt>
          <dd className="dshx:min-w-0">
            {editing ? (
              <Input
                aria-label="Display name"
                maxLength={120}
                onChange={event => props.state.setDraft({ ...props.draft, displayName: event.target.value })}
                value={props.draft.displayName}
              />
            ) : (
              <span>{props.draft.displayName}</span>
            )}
          </dd>
          <dt className="dshx:text-xs dshx:text-muted-foreground">Provider</dt>
          <dd>{KIND_LABEL[props.draft.kind]}</dd>
          <dt className="dshx:text-xs dshx:text-muted-foreground">Account type</dt>
          <dd>{selected?.plan ?? 'Not reported by provider'}</dd>
          <dt className="dshx:text-xs dshx:text-muted-foreground">Email / identity</dt>
          <dd className="dshx:break-words">{selected?.identity ?? 'Not reported by provider'}</dd>
          <dt className="dshx:text-xs dshx:text-muted-foreground">Account ID</dt>
          <dd className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
            <code className="dshx:truncate dshx:text-xs">{props.draft.instanceId}</code>
            <Button
              aria-label="Copy account ID"
              onClick={() =>
                void accountIdCopy.copy(props.draft.instanceId).then(success => {
                  if (!success) props.state.setNotice('Could not copy the account ID. Select and copy the route text instead.')
                })
              }
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              {accountIdCopy.copied ? <CheckIcon /> : <CopyIcon />}
            </Button>
          </dd>
          <dt className="dshx:text-xs dshx:text-muted-foreground">Authentication</dt>
          <dd>{accountAuthenticationLabel(props.draft)}</dd>
          <dt className="dshx:text-xs dshx:text-muted-foreground">Token status</dt>
          <dd className={cn('dshx:inline-flex dshx:items-center dshx:gap-2', status?.tone === 'success' ? 'dshx:text-success' : 'dshx:text-muted-foreground')}>
            <StatusDot tone="current" />
            {status?.authenticated ? 'Authenticated' : (status?.label ?? 'Not verified')}
          </dd>
          <dt className="dshx:text-xs dshx:text-muted-foreground">Last checked</dt>
          <dd className="dshx:text-xs dshx:text-muted-foreground">
            {status?.checkedAt == null ? 'No provider check available' : new Date(status.checkedAt).toLocaleString()}
          </dd>
        </dl>
        <p className="dshx:text-[11px] dshx:text-muted-foreground">
          The account ID is its DSH route. Status reflects the last provider check, not a guarantee of future token validity.
        </p>
        <div className="dshx:flex dshx:justify-end">
          <Button disabled={props.state.dirty || props.state.saving || selected === null} onClick={props.onConnect} size="sm" type="button" variant="outline">
            <RefreshCwIcon />
            Reauthenticate
          </Button>
        </div>
      </section>
      <AccountRoutingSettings {...props} />
      <details className="dshx:rounded-lg dshx:border dshx:bg-card">
        <summary className="dshx:flex dshx:cursor-pointer dshx:items-center dshx:gap-3 dshx:p-5">
          <SlidersHorizontalIcon className="dshx:size-5" />
          <span>
            <strong className="dshx:block dshx:text-sm dshx:font-semibold">Advanced settings</strong>
            <span className="dshx:mt-1 dshx:block dshx:text-xs dshx:text-muted-foreground">Runtime, paths and other account-specific settings.</span>
          </span>
        </summary>
        <div className="dshx:border-t dshx:px-5">
          <AccountIdentitySection advanced draft={props.draft} state={props.state} />
          <RuntimePathsSection draft={props.draft} folderPicker={props.folderPicker} state={props.state} />
        </div>
      </details>
    </div>
  )
}
