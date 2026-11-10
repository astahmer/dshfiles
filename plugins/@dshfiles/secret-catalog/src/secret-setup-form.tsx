import { useApi, useSettings } from '@dshfiles/dshx/client'
import { DEFAULT_SECRET_ENVIRONMENT } from '@dshfiles/credential-port'
import type { SecretScope } from '@dshfiles/credential-port'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { revalidateLogic, useAppForm } from '@dshfiles/plugin-ui/form'
import { useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { type FormEvent } from 'react'
import { secretSetupApi } from './api.js'
import type { SecretCreateInput } from './secret-catalog.js'
import { bindStoredSecret, storeAndBindSecret } from './secret-setup-flow.js'
import type { SecretSetupResult } from './secret-setup-flow.js'
import { SecretSetupModel } from './secret-setup-model.js'
import { SecretSetupSteps, type SecretSetupStep } from './secret-setup-step.js'
import { secretCatalogSettings } from './settings.js'
import type { SecretCatalogTranslate } from './locales.js'

export interface SecretSetupTarget {
  cwd: string | null
  suggestedAlias?: string
  environment?: string
  scope?: SecretScope
}

interface SecretSetupFormProps {
  readonly target: SecretSetupTarget
  readonly t: SecretCatalogTranslate
  /** The step is owned by whoever offers the form, so a requirement keeps its step across renders. */
  readonly step: SecretSetupStep
  readonly onStepChange: (step: SecretSetupStep) => void
  readonly onBound: (reference: string) => void
  readonly onCancel: () => void
  readonly onBind: (reference: string) => Promise<void>
}

const submitWith =
  (handleSubmit: () => Promise<void>) =>
  (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void handleSubmit()
  }

const setupListKey = (cwd: string | null): readonly ['secret-catalog', 'list', string | null] => ['secret-catalog', 'list', cwd]

const defaultScopeFor = (input: { readonly filter: 'all' | SecretScope; readonly cwd: string | null }): SecretScope => {
  if (input.filter !== 'all') {
    if (input.filter === 'global' || input.cwd !== null) return input.filter
    return 'global'
  }
  return input.cwd === null ? 'global' : 'project'
}

const scopeHint = (scope: SecretScope, t: SecretCatalogTranslate): string => {
  if (scope === 'project') return t('targetProjectHint')
  if (scope === 'local') return t('targetLocalHint')
  return t('targetGlobalHint')
}

const messageOf = (step: SecretSetupStep): 'load' | 'folder' | 'create' | 'bind' | null => {
  if (step.kind === 'draft') return step.error
  if (step.kind === 'created') return step.error
  return null
}

const messageTextFor = (message: 'load' | 'folder' | 'create' | 'bind', t: SecretCatalogTranslate): string => {
  if (message === 'load') return t('setupLoadFailed')
  if (message === 'folder') return t('needsProjectFolder')
  if (message === 'create') return t('setupCreateFailed')
  return t('setupBindFailed')
}

export const SecretSetupForm = (props: SecretSetupFormProps): JSX.Element => {
  const api = useApi(secretSetupApi)
  const settings = useSettings(secretCatalogSettings)
  const queryClient = useQueryClient()
  const aliases = useQuery({
    queryKey: setupListKey(props.target.cwd),
    queryFn: ({ signal }) => api.list({ cwd: props.target.cwd }, { signal }),
    retry: false,
    staleTime: 30_000,
  })
  const catalogScope = settings.value?.defaultScope ?? 'all'
  const defaultScope = props.target.scope ?? defaultScopeFor({ filter: catalogScope, cwd: props.target.cwd })
  const defaultEnvironment = settings.value?.defaultEnvironment ?? DEFAULT_SECRET_ENVIRONMENT
  const createMutation = useMutation({
    mutationFn: (request: SecretCreateInput) =>
      storeAndBindSecret({
        request,
        ports: {
          create: input => api.create(input),
          bind: props.onBind,
        },
      }),
    onSuccess: async () => {
      try {
        await queryClient.invalidateQueries({ queryKey: ['secret-catalog'] })
      } catch {
        return
      }
    },
  })
  const storedReference = SecretSetupSteps.createdReference(props.step)
  const busy = SecretSetupSteps.busy(props.step)
  const bindReference = async (input: { readonly reference: string; readonly origin: 'created' | 'existing' }): Promise<void> => {
    const binding = SecretSetupSteps.startBind({ step: props.step, ...input })
    props.onStepChange(binding)
    const bound = await bindStoredSecret({ reference: input.reference, bind: props.onBind })
    props.onStepChange(SecretSetupSteps.bindSettled({ step: binding, bound }))
    if (bound) props.onBound(input.reference)
  }
  const retryBinding = async (reference: string): Promise<void> => {
    await bindReference({ reference, origin: 'created' })
  }
  const draftDefaultsInput = {
    environment: props.target.environment ?? defaultEnvironment,
    scope: props.target.cwd === null && defaultScope !== 'global' ? 'global' : defaultScope,
  }
  const defaultValues =
    props.target.suggestedAlias === undefined
      ? SecretSetupModel.draftDefaults(draftDefaultsInput)
      : SecretSetupModel.draftDefaults({ ...draftDefaultsInput, suggestedAlias: props.target.suggestedAlias })
  const form = useAppForm({
    defaultValues,
    validationLogic: revalidateLogic({ mode: 'blur', modeAfterSubmission: 'change' }),
    validators: { onDynamic: SecretSetupModel.draftSchema },
    onSubmit: async ({ value }) => {
      if (storedReference !== undefined) {
        await retryBinding(storedReference)
        return
      }
      let rows: Awaited<ReturnType<typeof api.list>>
      try {
        rows = await api.list({ cwd: props.target.cwd })
        queryClient.setQueryData(setupListKey(props.target.cwd), rows)
      } catch {
        props.onStepChange(SecretSetupSteps.createFailed({ step: props.step, error: 'load' }))
        return
      }
      const issue = SecretSetupModel.issue({ draft: value, cwd: props.target.cwd, rows })
      if (issue === 'duplicate') {
        form.setFieldValue('value', '')
        props.onStepChange(SecretSetupSteps.draft())
        return
      }
      if (issue === 'folder') {
        props.onStepChange(SecretSetupSteps.createFailed({ step: props.step, error: 'folder' }))
        return
      }
      if (issue !== null) return
      const request = SecretSetupModel.createInput({ draft: value, cwd: props.target.cwd })
      form.setFieldValue('value', '')
      const creating = SecretSetupSteps.startCreate(props.step)
      props.onStepChange(creating)
      let result: SecretSetupResult
      try {
        result = await createMutation.mutateAsync(request)
      } catch {
        try {
          rows = await api.list({ cwd: props.target.cwd })
          queryClient.setQueryData(setupListKey(props.target.cwd), rows)
          const duplicate = SecretSetupModel.issue({ draft: value, cwd: props.target.cwd, rows }) === 'duplicate'
          props.onStepChange(SecretSetupSteps.createFailed({ step: creating, error: duplicate ? null : 'create' }))
        } catch {
          props.onStepChange(SecretSetupSteps.createFailed({ step: creating, error: 'create' }))
        }
        return
      } finally {
        createMutation.reset()
      }
      props.onStepChange(SecretSetupSteps.createSettled({ reference: result.reference, bound: result.status === 'bound' }))
      if (result.status === 'bound') props.onBound(result.reference)
    },
  })

  const message = messageOf(props.step)
  const messageText = message === null ? null : messageTextFor(message, props.t)

  return (
    <form
      className="dshx-root dshx:@container dshx:flex dshx:max-w-xl dshx:flex-col dshx:gap-1.5"
      data-testid="secret-setup-form"
      noValidate
      onSubmit={submitWith(form.handleSubmit)}
    >
      {storedReference !== undefined ? (
        <p className="dshx:text-xs dshx:text-muted-foreground" role="status">
          {props.t('setupStoredReference')}
        </p>
      ) : null}
      {messageText !== null ? (
        <p className="dshx:text-xs dshx:text-destructive" role="alert">
          {messageText}
        </p>
      ) : null}
      {storedReference === undefined ? (
        <>
          <form.AppField
            name="alias"
            validators={{
              onChangeListenTo: ['environment'],
              onChange: ({ value, fieldApi }) => {
                const environment = fieldApi.form.getFieldValue('environment')
                return (aliases.data ?? []).some(row => row.alias === value && row.environment === environment)
                  ? props.t('aliasExists', { alias: value, environment })
                  : undefined
              },
            }}
          >
            {field => (
              <field.TextField description={props.t('aliasHint')} label={props.t('fieldAlias')} monospace placeholder={props.t('aliasPlaceholder')} required />
            )}
          </form.AppField>
          <div className="dshx:grid dshx:gap-2 dshx:grid-cols-2 dshx:@max-pane-narrow:grid-cols-1">
            <form.Subscribe selector={state => state.values.scope}>
              {scope => (
                <form.AppField name="scope">
                  {field => (
                    <field.SelectField
                      description={scope !== 'global' && props.target.cwd === null ? props.t('needsProjectFolder') : scopeHint(scope, props.t)}
                      label={props.t('fieldTargetScope')}
                      options={[
                        { value: 'global', label: props.t('targetGlobal') },
                        { value: 'project', label: props.t('targetProject'), disabled: props.target.cwd === null },
                        { value: 'local', label: props.t('targetLocal'), disabled: props.target.cwd === null },
                      ]}
                    />
                  )}
                </form.AppField>
              )}
            </form.Subscribe>
            <form.AppField name="environment">{field => <field.TextField label={props.t('fieldEnvironment')} monospace required />}</form.AppField>
          </div>
          <form.AppField name="value">
            {field => (
              <field.TextField
                autoComplete="new-password"
                description={props.t('manualValueHint')}
                label={props.t('fieldSecretValue')}
                monospace
                placeholder={props.t('valuePlaceholder')}
                required
                type="password"
              />
            )}
          </form.AppField>
        </>
      ) : null}
      {aliases.isError ? (
        <p className="dshx:text-xs dshx:text-destructive" role="alert">
          {props.t('setupLoadFailed')}
        </p>
      ) : null}
      {storedReference === undefined ? (
        <form.Subscribe selector={state => [state.values.alias, state.values.environment] as const}>
          {([alias, environment]) => {
            const rows = aliases.data ?? []
            const duplicate = rows.some(row => row.alias === alias && row.environment === environment)
            if (!duplicate) return null
            const reference = SecretSetupModel.existingReference({ alias, environment, rows })
            return (
              <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-2 dshx:text-xs dshx:text-destructive" role="alert">
                <span>{props.t(reference === null ? 'setupDuplicateAmbiguous' : 'setupDuplicateDetected')}</span>
                {reference === null ? null : (
                  <Button disabled={busy} onClick={() => void bindReference({ reference, origin: 'existing' })} size="sm" type="button" variant="outline">
                    {props.t('setupUseExisting')}
                  </Button>
                )}
              </div>
            )
          }}
        </form.Subscribe>
      ) : null}
      <div className="dshx:flex dshx:flex-wrap dshx:justify-end dshx:gap-2">
        <Button disabled={busy} onClick={props.onCancel} size="sm" type="button" variant="ghost">
          {props.t('cancel')}
        </Button>
        {storedReference !== undefined ? (
          <Button disabled={busy} onClick={() => void retryBinding(storedReference)} size="sm" type="button">
            {busy ? props.t('saving') : props.t('setupRetryBind')}
          </Button>
        ) : (
          <form.Subscribe selector={state => [state.values, state.isSubmitting] as const}>
            {([draft, submitting]) => {
              const issue = SecretSetupModel.issue({ draft, cwd: props.target.cwd, rows: aliases.data ?? [] })
              return (
                <Button disabled={busy || submitting || aliases.data === undefined || aliases.isError || issue !== null} size="sm" type="submit">
                  {props.step.kind === 'creating' ? props.t('adding') : props.t('setupCreateAndBind')}
                </Button>
              )
            }}
          </form.Subscribe>
        )}
      </div>
    </form>
  )
}
