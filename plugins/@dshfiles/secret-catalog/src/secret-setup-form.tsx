import { useApi, useSettings } from '@dshfiles/dshx/client'
import { DEFAULT_SECRET_ENVIRONMENT } from '@dshfiles/credential-port'
import type { SecretScope } from '@dshfiles/credential-port'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { revalidateLogic, useAppForm } from '@dshfiles/plugin-ui/form'
import { useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useEffect, useState, type FormEvent } from 'react'
import { secretSetupApi } from './api.js'
import type { SecretCreateInput } from './secret-operations.js'
import { bindStoredSecret, storeAndBindSecret } from './secret-setup-flow.js'
import type { SecretSetupResult } from './secret-setup-flow.js'
import { SecretSetupModel } from './secret-setup-model.js'
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
  readonly createdReference?: string | undefined
  readonly onCreatedReference: (reference: string) => void
  readonly onBound: (reference: string) => void
  readonly onBusyChange?: (busy: boolean) => void
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
  const [createdReference, setCreatedReference] = useState(props.createdReference)
  const [message, setMessage] = useState<'load' | 'duplicate' | 'folder' | 'create' | 'bind' | null>(null)
  const [binding, setBinding] = useState(false)
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
        await queryClient.invalidateQueries({ queryKey: ['secret-catalog', 'list'] })
      } catch {
        return
      }
    },
  })
  const retryBinding = async (): Promise<void> => {
    if (createdReference === undefined) return
    setBinding(true)
    props.onBusyChange?.(true)
    const bound = await bindStoredSecret({ reference: createdReference, bind: props.onBind })
    setBinding(false)
    props.onBusyChange?.(false)
    setMessage(bound ? null : 'bind')
    if (bound) props.onBound(createdReference)
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
      if (createdReference !== undefined) {
        await retryBinding()
        return
      }
      if (aliases.data === undefined || aliases.isError) {
        setMessage('load')
        return
      }
      const issue = SecretSetupModel.issue({ draft: value, cwd: props.target.cwd, rows: aliases.data })
      if (issue === 'duplicate') {
        setMessage('duplicate')
        return
      }
      if (issue === 'folder') {
        setMessage('folder')
        return
      }
      if (issue !== null) return
      setMessage(null)
      const request = SecretSetupModel.createInput({ draft: value, cwd: props.target.cwd })
      form.setFieldValue('value', '')
      props.onBusyChange?.(true)
      let result: SecretSetupResult
      try {
        result = await createMutation.mutateAsync(request)
      } catch {
        setMessage('create')
        return
      } finally {
        createMutation.reset()
        props.onBusyChange?.(false)
      }
      setCreatedReference(result.reference)
      props.onCreatedReference(result.reference)
      setMessage(result.status === 'bound' ? null : 'bind')
      if (result.status === 'bound') props.onBound(result.reference)
    },
  })

  useEffect(() => setCreatedReference(props.createdReference), [props.createdReference])

  const messageText = (() => {
    if (message === 'load') return props.t('setupLoadFailed')
    if (message === 'duplicate') return props.t('aliasExists', { alias: form.getFieldValue('alias'), environment: form.getFieldValue('environment') })
    if (message === 'folder') return props.t('needsProjectFolder')
    if (message === 'create') return props.t('setupCreateFailed')
    if (message === 'bind') return props.t('setupBindFailed')
    return null
  })()

  return (
    <form
      className="dshx-root dshx:@container dshx:flex dshx:flex-col dshx:gap-3"
      data-testid="secret-setup-form"
      noValidate
      onSubmit={submitWith(form.handleSubmit)}
    >
      {createdReference !== undefined ? (
        <p className="dshx:text-xs dshx:text-muted-foreground" role="status">
          {props.t('setupStoredReference')}
        </p>
      ) : null}
      {messageText !== null ? (
        <p className="dshx:text-xs dshx:text-destructive" role="alert">
          {messageText}
        </p>
      ) : null}
      {createdReference === undefined ? (
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
          <div className="dshx:grid dshx:gap-3 dshx:grid-cols-2 dshx:@max-pane-narrow:grid-cols-1">
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
      <div className="dshx:flex dshx:flex-wrap dshx:justify-end dshx:gap-2">
        <Button disabled={createMutation.isPending || binding} onClick={props.onCancel} size="sm" type="button" variant="ghost">
          {props.t('cancel')}
        </Button>
        {createdReference !== undefined ? (
          <Button disabled={createMutation.isPending || binding} onClick={() => void retryBinding()} size="sm" type="button">
            {binding ? props.t('saving') : props.t('setupRetryBind')}
          </Button>
        ) : (
          <form.Subscribe selector={state => [state.values, state.isSubmitting] as const}>
            {([draft, submitting]) => {
              const issue = SecretSetupModel.issue({ draft, cwd: props.target.cwd, rows: aliases.data ?? [] })
              return (
                <Button
                  disabled={createMutation.isPending || submitting || binding || aliases.data === undefined || aliases.isError || issue !== null}
                  size="sm"
                  type="submit"
                >
                  {createMutation.isPending ? props.t('adding') : props.t('setupCreateAndBind')}
                </Button>
              )
            }}
          </form.Subscribe>
        )}
      </div>
    </form>
  )
}
