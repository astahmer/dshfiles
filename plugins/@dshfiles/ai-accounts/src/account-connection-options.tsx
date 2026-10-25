import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { revalidateLogic, useAppForm } from '@dshfiles/plugin-ui/form'
import { AccountConnectionMethodModel } from './account-connection-method.js'
import { configureAccountConnectionInputSchema, type AccountConnectionMethod, type AccountProfile, type ConfigureAccountConnectionInput } from './api.js'

type ConnectionChange = Omit<ConfigureAccountConnectionInput, 'operationId'>
interface ConnectionOptionsProps {
  readonly account: AccountProfile
  readonly method: AccountConnectionMethod
  readonly busy: boolean
  readonly configure: (change: ConnectionChange) => void
}

const methodLabel = (method: AccountConnectionMethod, account: AccountProfile): string => {
  if (method === 'subscription') return 'Claude account'
  if (method === 'device') return 'Browser sign-in'
  if (method === 'cli') return account.kind === 'codex' ? 'Existing login' : 'CLI login'
  return account.kind === 'cursor' ? 'Access token' : 'API key'
}

/** Keep common choices visible; existing credentials and custom paths remain available on demand. */
export const AccountConnectionOptions = (props: ConnectionOptionsProps): JSX.Element => {
  const methods = AccountConnectionMethodModel.allowedMethods(props.account.kind)
  const primary = methods.filter(method => method !== 'reference')
  return (
    <section aria-label="Sign-in options" className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3">
      {primary.length > 1 || props.method === 'reference' ? (
        <div className="dshx:flex dshx:gap-1 dshx:rounded-lg dshx:bg-muted dshx:p-1" aria-label="Sign-in method">
          {primary.map(method => (
            <Button
              className={
                method === props.method
                  ? 'dshx:min-w-0 dshx:flex-1 dshx:shrink dshx:bg-background dshx:text-xs dshx:shadow-sm'
                  : 'dshx:min-w-0 dshx:flex-1 dshx:shrink dshx:text-xs'
              }
              key={method}
              type="button"
              size="sm"
              variant={method === props.method ? 'secondary' : 'ghost'}
              aria-pressed={method === props.method}
              disabled={props.busy}
              onClick={() => {
                if (method !== props.method) props.configure({ mode: method })
              }}
            >
              {methodLabel(method, props.account)}
            </Button>
          ))}
        </div>
      ) : null}
      <details key={`${props.account.instanceId}:${props.method}`} open={props.method === 'reference'} className="dshx:text-xs">
        <summary className="dshx:cursor-pointer dshx:text-muted-foreground">More options</summary>
        <div className="dshx:mt-3 dshx:flex dshx:flex-col dshx:gap-3">
          {methods.includes('reference') ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-pressed={props.method === 'reference'}
              disabled={props.busy}
              onClick={() => props.configure({ mode: 'reference' })}
            >
              Use existing credential
            </Button>
          ) : null}
          {props.account.kind === 'claude' && props.method === 'subscription' ? (
            <Button type="button" size="sm" variant="outline" disabled={props.busy} onClick={() => props.configure({ homePath: '~/.claude' })}>
              Use default Claude Code login
            </Button>
          ) : null}
          {props.account.kind === 'codex' || props.account.kind === 'claude' ? (
            <ConnectionHomes key={`${props.account.instanceId}:${props.account.homePath}:${props.account.shadowHomePath}`} {...props} />
          ) : null}
        </div>
      </details>
    </section>
  )
}

const ConnectionHomes = (props: ConnectionOptionsProps): JSX.Element => {
  const codex = props.account.kind === 'codex'
  const form = useAppForm({
    defaultValues: { homePath: props.account.homePath, shadowHomePath: props.account.shadowHomePath },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: configureAccountConnectionInputSchema.pick({ homePath: true, shadowHomePath: true }).required() },
    onSubmit: ({ value }) => props.configure(codex ? value : { homePath: value.homePath }),
  })
  return (
    <details className="dshx:rounded-md dshx:border dshx:p-3">
      <summary className="dshx:cursor-pointer dshx:text-xs">Existing or custom CLI home</summary>
      <form
        className="dshx:mt-3 dshx:flex dshx:flex-col dshx:gap-3"
        noValidate
        onSubmit={event => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <fieldset disabled={props.busy} className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3">
          <form.AppField name="homePath">
            {field => (
              <field.TextField
                label={codex ? 'Shared Codex home' : 'CLAUDE_CONFIG_DIR'}
                monospace
                description={codex ? 'Shared state; custom homes need a separate auth overlay.' : 'Directory containing your Claude Code login.'}
              />
            )}
          </form.AppField>
          {codex ? (
            <form.AppField name="shadowHomePath">
              {field => (
                <field.TextField
                  label="Authentication overlay (CODEX_HOME)"
                  monospace
                  description="Existing logins are read in place. Browser sign-in replaces auth only after confirmation."
                />
              )}
            </form.AppField>
          ) : null}
          <Button type="submit" variant="outline" size="sm">
            Apply CLI home settings
          </Button>
        </fieldset>
      </form>
    </details>
  )
}

export const ExistingConnectionReference = (props: ConnectionOptionsProps): JSX.Element => {
  const form = useAppForm({
    defaultValues: { apiKeyEnv: props.account.apiKeyEnv },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: configureAccountConnectionInputSchema.pick({ apiKeyEnv: true }).required() },
    onSubmit: ({ value }) => props.configure(value),
  })
  const example =
    props.account.kind === 'commandcode' ? 'COMMANDCODE_API_KEY' : props.account.kind === 'opencode-go' ? 'OPENCODE_API_KEY' : 'CLAUDE_WORK_API_KEY'
  return (
    <form
      className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3"
      noValidate
      onSubmit={event => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <fieldset disabled={props.busy} className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3">
        <form.AppField name="apiKeyEnv">
          {field => (
            <field.TextField
              label="Existing credential reference"
              monospace
              placeholder={example}
              description="An existing DSH credential or Host environment variable."
            />
          )}
        </form.AppField>
        <Button type="submit" variant="outline" size="sm">
          Apply credential reference
        </Button>
      </fieldset>
    </form>
  )
}
