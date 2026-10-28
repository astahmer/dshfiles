import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Combobox } from '@dshfiles/plugin-ui/components/ui/combobox'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { RefreshCwIcon } from '@dshfiles/plugin-ui/icons'
import { AccountDraftModel, ROUTE_SLUG_HINT } from './account-draft.js'
import { KIND_LABEL } from './account-labels.js'
import { PROVIDER_ICONS, type AccountDraft } from './api.js'
import { LabelledControl, NumberedSection } from './panel-primitives.js'
import type { AccountsPanelState } from './use-accounts-panel-state.js'

export const AccountIdentitySection = (props: {
  readonly state: AccountsPanelState
  readonly draft: AccountDraft
  readonly advanced?: boolean
}): JSX.Element => {
  const draft = props.draft
  const { accounts, selected, selectedId, setDraft, setNotice, load, commitRename, saveMode } = props.state
  const managedCodexRoute = draft.kind === 'codex' && draft.homePath !== '' && draft.homePath === draft.shadowHomePath
  if (props.advanced === true)
    return (
      <div className="dshx:grid dshx:grid-cols-2 dshx:gap-4 dshx:py-4 dshx:@max-pane-narrow:grid-cols-1">
        <LabelledControl
          hint={
            managedCodexRoute
              ? 'This route identifies its managed private login home. Use Display name to rename the account.'
              : saveMode === 'auto'
                ? `${ROUTE_SLUG_HINT} Saved when you leave the field.`
                : ROUTE_SLUG_HINT
          }
          label="Route slug"
        >
          {id => (
            <Input
              id={id}
              onBlur={() => void commitRename()}
              onChange={event => setDraft({ ...draft, instanceId: event.target.value })}
              onKeyDown={event => {
                if (event.key === 'Enter') void commitRename()
              }}
              value={draft.instanceId}
              readOnly={managedCodexRoute}
            />
          )}
        </LabelledControl>
        <LabelledControl hint="Up to 3 characters, shown on the provider mark and the sidebar usage strip." label="Picker tag">
          {id => (
            <Input
              id={id}
              maxLength={3}
              onChange={event => setDraft({ ...draft, badge: event.target.value.toUpperCase() })}
              placeholder={AccountDraftModel.badgeFromName(draft.displayName)}
              value={draft.badge}
            />
          )}
        </LabelledControl>
        <LabelledControl label="Tag color">
          {id => (
            <Input
              className="dshx:w-14! dshx:cursor-pointer dshx:p-1"
              id={id}
              onChange={event => setDraft({ ...draft, accentColor: event.target.value })}
              type="color"
              value={draft.accentColor}
            />
          )}
        </LabelledControl>
        <div className="dshx:min-w-0 dshx:space-y-1.5">
          <p className="dshx:text-xs dshx:text-muted-foreground">Picker icon</p>
          <Combobox
            label="Picker icon"
            onValueChange={providerIcon => setDraft({ ...draft, providerIcon })}
            options={PROVIDER_ICONS.map(icon => ({ value: icon, label: icon }))}
            value={draft.providerIcon}
          />
        </div>
      </div>
    )
  return (
    <NumberedSection
      actions={
        <Button
          disabled={selectedId === null}
          onClick={() => {
            if (selectedId === null) return
            if (draft.kind !== 'codex') {
              void load()
                .then(() => setNotice('Account identity refreshed.'))
                .catch(() => setNotice('Could not read the account identity.'))
              return
            }
            void accounts
              .identity({ instanceId: selectedId })
              .then(identity => {
                setNotice(identity.signedIn ? 'Codex account identity refreshed.' : 'No signed-in account was found at this home yet.')
                if (identity.signedIn) void load()
              })
              .catch(() => setNotice('Could not read the Codex account identity.'))
          }}
          size="xs"
          type="button"
          variant="outline"
        >
          <RefreshCwIcon />
          Refresh
        </Button>
      }
      title="Account details"
    >
      <LabelledControl label="Display name">
        {id => (
          <Input
            id={id}
            onChange={event => setDraft({ ...draft, displayName: event.target.value })}
            placeholder={KIND_LABEL[draft.kind]}
            value={draft.displayName}
          />
        )}
      </LabelledControl>
      <dl className="dshx:mt-3 dshx:grid dshx:grid-cols-2 dshx:gap-4 dshx:rounded-lg dshx:bg-muted/30 dshx:p-4 dshx:@max-pane-narrow:grid-cols-1">
        <div className="dshx:min-w-0">
          <dt className="dshx:text-xs dshx:text-muted-foreground">Provider</dt>
          <dd className="dshx:mt-1 dshx:text-sm">{KIND_LABEL[draft.kind]}</dd>
        </div>
        <div className="dshx:min-w-0">
          <dt className="dshx:text-xs dshx:text-muted-foreground">Plan</dt>
          <dd className="dshx:mt-1 dshx:text-sm">{selected?.plan ?? 'Not reported by provider'}</dd>
        </div>
        <div className="dshx:min-w-0">
          <dt className="dshx:text-xs dshx:text-muted-foreground">Signed-in identity</dt>
          <dd className="dshx:mt-1 dshx:break-words dshx:text-sm">{selected?.identity ?? 'Not reported by provider'}</dd>
        </div>
        <div className="dshx:min-w-0">
          <dt className="dshx:text-xs dshx:text-muted-foreground">Authentication</dt>
          <dd className="dshx:mt-1 dshx:text-sm">{selected?.signedIn ? 'Credentials available' : 'No credentials found'}</dd>
        </div>
      </dl>
      <p className="dshx:text-xs dshx:text-muted-foreground">
        Identity and plan are observed, not editable. Credential availability does not verify token validity.
      </p>
      {selected?.detail == null ? null : (
        <p className="dshx:text-xs dshx:text-warning" role="status">
          {selected.detail}
        </p>
      )}
    </NumberedSection>
  )
}
