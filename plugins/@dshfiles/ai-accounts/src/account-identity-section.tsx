import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { RefreshCwIcon } from '@dshfiles/plugin-ui/icons'
import { badgeFromName } from './account-draft.js'
import { KIND_LABEL } from './account-labels.js'
import { PROVIDER_ICONS, type AccountDraft } from './api.js'
import { LabelledControl, NumberedSection } from './panel-primitives.js'
import type { AccountsPanelState } from './use-accounts-panel-state.js'

/** The section a route slug is valid under, so the field explains its own rule. */
const SLUG_HINT = 'Letters, digits, dash and underscore. Appears as the provider in the model picker.'

export const AccountIdentitySection = (props: { readonly state: AccountsPanelState; readonly draft: AccountDraft }): JSX.Element => {
  const draft = props.draft
  const { accounts, selected, selectedId, setDraft, setNotice, load } = props.state
  return (
    <NumberedSection
      actions={
        <Button
          disabled={draft.kind !== 'codex' || selectedId === null}
          onClick={() => {
            if (selectedId === null) return
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
      index="01"
      title="Account identity"
    >
      <div className="dshx:grid dshx:grid-cols-1 dshx:gap-x-3 dshx:gap-y-2.5 dshx:rounded-lg dshx:border dshx:bg-muted/30 dshx:p-3 dshx:md:grid-cols-2">
        <LabelledControl hint={SLUG_HINT} label="Route slug">
          {id => <Input id={id} onChange={event => setDraft({ ...draft, instanceId: event.target.value })} value={draft.instanceId} />}
        </LabelledControl>
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
        <LabelledControl label="Signed-in identity">
          {id => (
            <Input
              className="dshx:text-muted-foreground"
              id={id}
              readOnly
              value={
                selected?.identity ??
                (draft.kind === 'codex' ? 'Sign in, then refresh' : `Key from ${draft.apiKeyEnv === '' ? 'the environment' : draft.apiKeyEnv}`)
              }
            />
          )}
        </LabelledControl>
        <LabelledControl hint="Up to 3 characters, shown on the provider mark." label="Picker tag">
          {id => (
            <Input
              id={id}
              maxLength={3}
              onChange={event => setDraft({ ...draft, badge: event.target.value.toUpperCase() })}
              placeholder={badgeFromName(draft.displayName)}
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
        <LabelledControl label="Picker icon">
          {id => (
            <Select onValueChange={providerIcon => setDraft({ ...draft, providerIcon })} value={draft.providerIcon}>
              <SelectTrigger className="dshx:w-full" id={id}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_ICONS.map(icon => (
                  <SelectItem key={icon} value={icon}>
                    {icon}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </LabelledControl>
      </div>
    </NumberedSection>
  )
}
