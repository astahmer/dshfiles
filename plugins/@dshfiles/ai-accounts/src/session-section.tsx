import { Alert, AlertDescription, AlertTitle } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ExternalLinkIcon, TriangleAlertIcon } from '@dshfiles/plugin-ui/icons'
import { DISTRIBUTION_HINT, STATE_LABEL } from './account-labels.js'
import type { AccountDraft, AccountsFile } from './api.js'
import { NumberedSection } from './panel-primitives.js'
import type { AccountsPanelState } from './use-accounts-panel-state.js'

export const SessionSection = (props: { readonly state: AccountsPanelState; readonly draft: AccountDraft; readonly file: AccountsFile }): JSX.Element => {
  const draft = props.draft
  const file = props.file
  const { selected, copy } = props.state
  const facts = [
    { label: 'Route', value: draft.instanceId, mono: true },
    {
      label: 'Mode',
      value: draft.kind === 'codex' ? (draft.shadowHomePath === '' ? 'Shared auth' : 'Shared state, private auth') : 'Key from the environment',
      mono: false,
    },
    { label: 'Account', value: selected?.identity ?? STATE_LABEL[selected?.state ?? 'unconfigured'], mono: false },
  ]
  return (
    <NumberedSection
      actions={
        selected === null || selected.signedIn ? null : (
          <Button onClick={() => void copy(selected.loginHint, 'Sign-in command copied.')} size="xs" type="button" variant="outline">
            <ExternalLinkIcon />
            Copy sign-in command
          </Button>
        )
      }
      index="05"
      title="Session"
    >
      <dl className="dshx:grid dshx:grid-cols-1 dshx:gap-3 dshx:rounded-lg dshx:border dshx:bg-muted/30 dshx:p-3 dshx:md:grid-cols-3">
        {facts.map(fact => (
          <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1" key={fact.label}>
            <dt className="dshx:text-xs dshx:text-muted-foreground">{fact.label}</dt>
            <dd className={fact.mono ? 'dshx:truncate dshx:font-mono dshx:text-xs' : 'dshx:truncate dshx:text-sm'}>{fact.value}</dd>
          </div>
        ))}
      </dl>
      <p className="dshx:text-xs dshx:text-muted-foreground">
        Requests spread by <strong className="dshx:font-semibold dshx:text-foreground">{file.distribution}</strong>. {DISTRIBUTION_HINT[file.distribution]}
      </p>
      {selected !== null && !selected.signedIn ? (
        <Alert role="status" variant="info">
          <AlertTitle>Sign in with</AlertTitle>
          <AlertDescription>
            <code className="dshx:font-mono dshx:text-xs dshx:break-all">{selected.loginHint}</code>
          </AlertDescription>
        </Alert>
      ) : null}
      {selected?.detail == null ? null : (
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertDescription>{selected.detail}</AlertDescription>
        </Alert>
      )}
    </NumberedSection>
  )
}
