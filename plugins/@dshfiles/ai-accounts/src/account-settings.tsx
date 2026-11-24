import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Combobox } from '@dshfiles/plugin-ui/components/ui/combobox'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { PageSection } from '@dshfiles/plugin-ui/components/page'
import { CheckIcon, CopyIcon, PencilIcon, RefreshCwIcon } from '@dshfiles/plugin-ui/icons'
import { useState } from 'react'
import { useCopyFeedback } from '@dshfiles/plugin-ui/hooks/copy-feedback'
import { AccountLabels, KIND_LABEL } from './account-labels.js'
import { AccountConnection } from './account-connection-status.js'
import { AccountIdentitySection } from './account-identity-section.js'
import { ExtraUsageMeter } from './extra-usage-view.js'
import { AccountDefaultReasoningControl, AccountInheritanceControl } from './account-model-defaults.js'
import { RuntimePathsSection } from './runtime-paths-section.js'
import type { AccountDraft, AccountsFile } from './api.js'
import type { AccountsPanelState } from './use-accounts-panel-state.js'
import type { WorkspacePickerPorts } from '@dshfiles/workspace-folder-picker/picker'

/** A section of the detail pane: the pane is the card, its sections separate by hairlines. */
const sectionClass = 'dshx:gap-4 dshx:py-4'
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
      aria-label={AccountLabels.routedKind(props.draft.kind) ? 'Enable for model routing' : 'Enable quota tracking'}
      checked={props.draft.enabled}
      className="dshx:mt-0.5"
      onCheckedChange={enabled => void props.state.persist({ enabled })}
    />
    <span>
      <span className="dshx:block dshx:text-sm">{AccountLabels.routedKind(props.draft.kind) ? 'Enable for model routing' : 'Enable quota tracking'}</span>
      <span className="dshx:mt-1 dshx:block dshx:text-xs dshx:text-muted-foreground">
        {AccountLabels.routedKind(props.draft.kind)
          ? 'Allow this account to be used when selecting models.'
          : 'Include this account in subscription quota readings.'}
      </span>
    </span>
  </label>
)
const AccountRoutingSettings = (props: SettingsProps): JSX.Element => (
  <PageSection className={sectionClass} description="How this account is used when several are available." heading="Routing and priority">
    <div className="dshx:grid dshx:grid-cols-[minmax(120px,0.7fr)_minmax(0,1fr)] dshx:items-center dshx:gap-3 dshx:@max-pane-narrow:grid-cols-1">
      <span className="dshx:text-xs dshx:text-muted-foreground">Priority</span>
      <div className="dshx:min-w-0">
        <PriorityControl {...props} />
        <p className="dshx:mt-1.5 dshx:text-2xs dshx:text-muted-foreground">Lower numbers are tried first within {KIND_LABEL[props.draft.kind]}.</p>
      </div>
    </div>
    <RoutingSwitch draft={props.draft} state={props.state} />
  </PageSection>
)

const ExtraUsageSettings = (props: SettingsProps): JSX.Element | null => {
  const usage = props.state.usage
  const card = usage?.cards.find(candidate => candidate.instanceId === props.draft.instanceId)?.usage
  if (card?.status !== 'ok' || card.extraUsage === undefined) return null
  const allowed = props.draft.useExtraUsage === true
  return (
    <PageSection className={sectionClass} description="Paid overage past the plan limits, as this account's quota reports it." heading="Extra usage">
      <ExtraUsageMeter extra={card.extraUsage} now={usage?.readAt ?? 0} />
      <label className="dshx:flex dshx:items-start dshx:gap-3">
        <Switch
          aria-label="Use extra usage"
          checked={allowed}
          className="dshx:mt-0.5"
          onCheckedChange={enabled => void props.state.persist({ useExtraUsage: enabled })}
        />
        <span>
          <span className="dshx:block dshx:text-sm">Use extra usage</span>
          <span className="dshx:mt-1 dshx:block dshx:text-xs dshx:text-muted-foreground">
            {allowed
              ? 'A spent 5-hour or weekly window draws the provider’s extra usage.'
              : 'Off: once the 5-hour or weekly window is spent, routing skips this account and a turn stops with its reset time.'}
          </span>
        </span>
      </label>
    </PageSection>
  )
}

const AccountAuthenticationDetails = (props: Pick<SettingsProps, 'draft' | 'state'> & { readonly onConnect: () => void }): JSX.Element => {
  const profile = props.state.selected
  const status = profile === null ? null : AccountConnection.status(profile, props.state.usage)
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
        <dd>{AccountConnection.authenticationLabel(props.draft)}</dd>
        <dt className="dshx:text-muted-foreground">Signed in as</dt>
        <dd className="dshx:break-words">{profile?.identity ?? 'Not reported by provider'}</dd>
        <dt className="dshx:text-muted-foreground">Token status</dt>
        <dd className={status?.tone === 'warning' ? 'dshx:text-warning' : undefined}>
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
    <PageSection className={sectionClass} description="Account-specific settings. Leave as default to use provider settings." heading="Settings">
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
    </PageSection>
  )
}

export const AccountSettings = (props: SettingsProps & { readonly folderPicker: WorkspacePickerPorts; readonly onConnect: () => void }): JSX.Element => {
  const [editing, setEditing] = useState(false)
  const accountIdCopy = useCopyFeedback()
  const selected = props.state.selected
  const status = selected === null ? null : AccountConnection.status(selected, props.state.usage)
  return (
    <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:divide-y">
      <PageSection
        actions={
          <Button aria-pressed={editing} onClick={() => setEditing(!editing)} size="sm" type="button" variant="outline">
            <PencilIcon />
            {editing ? 'Done' : 'Edit'}
          </Button>
        }
        className={sectionClass}
        description="Basic information and authentication."
        heading="Account details"
      >
        <dl className="dshx:grid dshx:grid-cols-[minmax(120px,0.7fr)_minmax(0,1fr)] dshx:items-center dshx:gap-x-6 dshx:gap-y-4 dshx:text-sm dshx:@max-pane-narrow:grid-cols-1">
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
          <dd>{selected?.plan == null ? 'Not reported by provider' : AccountLabels.planLabel(selected.plan)}</dd>
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
          <dd>{AccountConnection.authenticationLabel(props.draft)}</dd>
          <dt className="dshx:text-xs dshx:text-muted-foreground">Token status</dt>
          <dd className={status?.tone === 'warning' ? 'dshx:text-warning' : undefined}>
            {status?.authenticated ? 'Authenticated' : (status?.label ?? 'Not verified')}
          </dd>
          <dt className="dshx:text-xs dshx:text-muted-foreground">Last checked</dt>
          <dd className="dshx:text-xs dshx:text-muted-foreground">
            {status?.checkedAt == null ? 'No provider check available' : new Date(status.checkedAt).toLocaleString()}
          </dd>
        </dl>
        <p className="dshx:text-2xs dshx:text-muted-foreground">
          The account ID is its DSH route. Status reflects the last provider check, not a guarantee of future token validity.
        </p>
        <div className="dshx:flex dshx:justify-end">
          <Button disabled={props.state.dirty || props.state.saving || selected === null} onClick={props.onConnect} size="sm" type="button" variant="outline">
            <RefreshCwIcon />
            Reauthenticate
          </Button>
        </div>
      </PageSection>
      <AccountRoutingSettings {...props} />
      <ExtraUsageSettings {...props} />
      <details className="dshx:py-4">
        <summary className="dshx:cursor-pointer">
          <strong className="dshx:text-sm dshx:font-semibold">Advanced settings</strong>
          <span className="dshx:ml-2 dshx:text-xs dshx:text-muted-foreground">Runtime, paths and other account-specific settings.</span>
        </summary>
        <div>
          <AccountIdentitySection advanced draft={props.draft} state={props.state} />
          <RuntimePathsSection draft={props.draft} folderPicker={props.folderPicker} state={props.state} />
        </div>
      </details>
    </div>
  )
}
