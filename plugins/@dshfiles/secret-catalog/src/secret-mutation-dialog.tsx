import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@dshfiles/plugin-ui/components/ui/alert-dialog'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@dshfiles/plugin-ui/components/ui/collapsible'
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet, FieldTitle } from '@dshfiles/plugin-ui/components/ui/field'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@dshfiles/plugin-ui/components/ui/radio-group'
import { ChevronRightIcon } from '@dshfiles/plugin-ui/icons'
import { revalidateLogic, useAppForm } from '@dshfiles/plugin-ui/form'
import { useId, useState, type FormEvent, type ReactNode } from 'react'
import type { SecretCatalogTranslate } from './locales.js'
import type { SecretMetadata } from './secret-metadata.js'
import {
  defaultFieldForType,
  hasSecretUpdate,
  isSecretScope,
  needsProjectFolder,
  secretCreateFormDefaults,
  secretCreateFormSchema,
  secretUpdateFormDefaults,
  secretUpdateFormSchema,
  toSecretCreateInput,
  toSecretUpdateInput,
  type SecretCreateForm,
  type SecretMutationScope,
  type SecretRemoveTarget,
  type SecretUpdateForm,
} from './secret-mutation-form.js'
import {
  chooseRemovalTarget,
  confirmedRemovalTarget,
  maySubmitValueReplacement,
  requestValueReplacement,
  type RemovalDialogState,
  type ValueReplacementStage,
} from './secret-mutation-model.js'

interface SecretMutationDialogProps {
  readonly mode: 'create' | 'edit' | 'remove'
  readonly row?: SecretMetadata
  /** Loaded aliases, to flag a duplicate alias and environment while typing. */
  readonly rows: readonly SecretMetadata[]
  readonly hasProjectFolder: boolean
  readonly initialCreateScope: SecretMutationScope
  readonly defaultEnvironment: string
  readonly pending: boolean
  readonly error: string | null
  readonly onClose: () => void
  readonly onCreate: (input: SecretCreateForm) => void
  readonly onUpdate: (input: SecretUpdateForm) => void
  readonly onRemove: (target: SecretRemoveTarget, row: SecretMetadata) => void
  readonly t: SecretCatalogTranslate
}

const scopeHintKeys = {
  project: 'targetProjectHint',
  global: 'targetGlobalHint',
  local: 'targetLocalHint',
} satisfies Record<SecretMutationScope, Parameters<SecretCatalogTranslate>[0]>

const submitWith =
  (handleSubmit: () => Promise<void>) =>
  (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void handleSubmit()
  }

const advancedCreateFields = ['name', 'source', 'tags', 'type', 'field'] as const

const CreateSecretForm = (props: SecretMutationDialogProps & { readonly footer: (submit: ReactNode) => ReactNode }): JSX.Element => {
  const t = props.t
  const valueModeId = useId()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const form = useAppForm({
    defaultValues: secretCreateFormDefaults({ scope: props.initialCreateScope, environment: props.defaultEnvironment }),
    validationLogic: revalidateLogic({ mode: 'blur', modeAfterSubmission: 'change' }),
    validators: { onDynamic: secretCreateFormSchema },
    onSubmit: ({ value }) => {
      if (needsProjectFolder({ scope: value.scope, hasProjectFolder: props.hasProjectFolder })) return
      props.onCreate(toSecretCreateInput(value))
    },
    onSubmitInvalid: ({ formApi }) => {
      if (advancedCreateFields.some(name => (formApi.getFieldMeta(name)?.errors.length ?? 0) > 0)) setAdvancedOpen(true)
    },
  })
  return (
    <form className="dshx:flex dshx:flex-col dshx:gap-5" noValidate onSubmit={submitWith(form.handleSubmit)}>
      <form.AppField
        name="alias"
        validators={{
          onChangeListenTo: ['environment'],
          onChange: ({ value, fieldApi }) => {
            const environment = fieldApi.form.getFieldValue('environment')
            return props.rows.some(row => row.alias === value && row.environment === environment) ? t('aliasExists', { alias: value, environment }) : undefined
          },
        }}
      >
        {field => <field.TextField description={t('aliasHint')} label={t('fieldAlias')} monospace placeholder={t('aliasPlaceholder')} required />}
      </form.AppField>
      <div className="dshx:grid dshx:gap-4 dshx:sm:grid-cols-[minmax(0,1fr)_10rem]">
        <form.Subscribe selector={state => state.values.scope}>
          {scope => (
            <form.AppField name="scope">
              {field => (
                <field.SelectField
                  description={
                    needsProjectFolder({ scope, hasProjectFolder: props.hasProjectFolder }) ? (
                      <span className="dshx:text-destructive">{t('needsProjectFolder')}</span>
                    ) : (
                      t(scopeHintKeys[scope])
                    )
                  }
                  label={t('fieldTargetScope')}
                  options={[
                    { value: 'project', label: t('targetProject'), disabled: !props.hasProjectFolder },
                    { value: 'global', label: t('targetGlobal') },
                    { value: 'local', label: t('targetLocal'), disabled: !props.hasProjectFolder },
                  ]}
                />
              )}
            </form.AppField>
          )}
        </form.Subscribe>
        <form.AppField name="environment">{field => <field.TextField label={t('fieldEnvironment')} monospace required />}</form.AppField>
      </div>
      <form.Field
        listeners={{
          onChange: ({ value }) => {
            if (value === 'generate') form.setFieldValue('value', '')
          },
        }}
        name="valueMode"
      >
        {field => (
          <FieldSet className="dshx:gap-3">
            <FieldLegend variant="label">{t('fieldValueCreation')}</FieldLegend>
            <RadioGroup
              className="dshx:grid dshx:gap-2 dshx:sm:grid-cols-2"
              onValueChange={value => {
                if (value === 'generate' || value === 'manual') field.handleChange(value)
              }}
              value={field.state.value}
            >
              {(['generate', 'manual'] as const).map(mode => (
                <FieldLabel htmlFor={`${valueModeId}-${mode}`} key={mode}>
                  <Field orientation="horizontal">
                    <RadioGroupItem id={`${valueModeId}-${mode}`} value={mode} />
                    <FieldContent>
                      <FieldTitle>{mode === 'generate' ? t('valueGenerate') : t('valueManual')}</FieldTitle>
                      <FieldDescription className="dshx:text-xs">{mode === 'generate' ? t('generateHint') : t('manualHint')}</FieldDescription>
                    </FieldContent>
                  </Field>
                </FieldLabel>
              ))}
            </RadioGroup>
          </FieldSet>
        )}
      </form.Field>
      <form.Subscribe selector={state => state.values.valueMode}>
        {valueMode =>
          valueMode === 'manual' && (
            <form.AppField name="value">
              {field => (
                <field.TextField
                  autoComplete="new-password"
                  description={t('manualValueHint')}
                  label={t('fieldSecretValue')}
                  monospace
                  placeholder={t('valuePlaceholder')}
                  required
                  type="password"
                />
              )}
            </form.AppField>
          )
        }
      </form.Subscribe>
      <Collapsible className="dshx:rounded-md dshx:border" onOpenChange={setAdvancedOpen} open={advancedOpen}>
        <CollapsibleTrigger asChild>
          <Button className="dshx:group dshx:w-full dshx:justify-start dshx:rounded-md dshx:px-3 dshx:font-normal" type="button" variant="ghost">
            <ChevronRightIcon aria-hidden className="dshx:transition-transform dshx:group-data-[state=open]:rotate-90" />
            <span className="dshx:font-medium">{t('advanced')}</span>
            <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">{t('advancedSummary')}</span>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="dshx:grid dshx:gap-4 dshx:border-t dshx:p-3 dshx:sm:grid-cols-2">
          <form.AppField name="name">{field => <field.TextField description={t('itemNameHint')} label={t('fieldItemName')} />}</form.AppField>
          <form.AppField name="source">{field => <field.TextField label={t('fieldSourceUrl')} placeholder="https://" type="url" />}</form.AppField>
          <form.AppField name="tags">{field => <field.TextField label={t('fieldTags')} placeholder={t('tagsPlaceholder')} />}</form.AppField>
          <form.AppField
            listeners={{
              onChange: ({ value }) => {
                const field = form.getFieldValue('field')
                if (field === defaultFieldForType('login') || field === defaultFieldForType('secure-note'))
                  form.setFieldValue('field', defaultFieldForType(value))
              },
            }}
            name="type"
          >
            {field => (
              <field.SelectField
                label={t('fieldItemType')}
                options={[
                  { value: 'login', label: t('itemTypeLogin') },
                  { value: 'secure-note', label: t('itemTypeSecureNote') },
                ]}
              />
            )}
          </form.AppField>
          <form.AppField name="field">{field => <field.TextField description={t('fieldHint')} label={t('fieldField')} monospace />}</form.AppField>
        </CollapsibleContent>
      </Collapsible>
      {props.footer(
        <form.Subscribe selector={state => [state.values.scope, state.isSubmitting] as const}>
          {([scope, isSubmitting]) => (
            <Button disabled={props.pending || isSubmitting || needsProjectFolder({ scope, hasProjectFolder: props.hasProjectFolder })} type="submit">
              {props.pending ? t('adding') : t('addAlias')}
            </Button>
          )}
        </form.Subscribe>,
      )}
    </form>
  )
}

const EditSecretForm = (
  props: SecretMutationDialogProps & { readonly row: SecretMetadata; readonly footer: (submit: ReactNode) => ReactNode },
): JSX.Element => {
  const t = props.t
  const row = props.row
  const clearTagsId = useId()
  const [valueReplacementStage, setValueReplacementStage] = useState<ValueReplacementStage>('editing')
  const form = useAppForm({
    defaultValues: secretUpdateFormDefaults(row.alias),
    validationLogic: revalidateLogic(),
    validators: { onDynamic: secretUpdateFormSchema },
    onSubmit: ({ value }) => {
      if (value.value.length > 0 && !maySubmitValueReplacement(valueReplacementStage)) {
        setValueReplacementStage(requestValueReplacement(valueReplacementStage))
        return
      }
      if (!isSecretScope(row.scope)) return
      props.onUpdate(toSecretUpdateInput({ target: { alias: row.alias, scope: row.scope, environment: row.environment }, form: value }))
    },
  })
  return (
    <form className="dshx:grid dshx:gap-4" noValidate onSubmit={submitWith(form.handleSubmit)}>
      <form.AppField name="renameTo">{field => <field.TextField description={t('renameHint')} label={t('fieldAlias')} monospace required />}</form.AppField>
      <form.AppField name="name">{field => <field.TextField label={t('fieldItemName')} placeholder={row.item || t('keepCurrent')} />}</form.AppField>
      <form.AppField name="source">{field => <field.TextField label={t('fieldSourceUrl')} placeholder={row.service || t('keepCurrent')} />}</form.AppField>
      <form.Subscribe selector={state => state.values.clearTags}>
        {clearTags => (
          <form.Field name="tags">
            {field => (
              <Field className="dshx:flex-col dshx:gap-1.5">
                <FieldLabel htmlFor={`${clearTagsId}-tags`}>{t('fieldTags')}</FieldLabel>
                <Input
                  autoComplete="off"
                  disabled={clearTags}
                  id={`${clearTagsId}-tags`}
                  name={field.name}
                  onBlur={field.handleBlur}
                  onChange={event => field.handleChange(event.currentTarget.value)}
                  placeholder={t('tagsPlaceholder')}
                  value={field.state.value}
                />
              </Field>
            )}
          </form.Field>
        )}
      </form.Subscribe>
      <form.AppField name="clearTags">{field => <field.CheckboxField label={t('clearAllTags')} />}</form.AppField>
      <form.AppField listeners={{ onChange: () => setValueReplacementStage('editing') }} name="value">
        {field => (
          <field.TextField
            autoComplete="new-password"
            description={
              field.state.value.length > 0 && valueReplacementStage === 'confirming' ? (
                <span className="dshx:text-warning">{t('confirmReplacementHint')}</span>
              ) : undefined
            }
            label={t('replaceValue')}
            monospace
            type="password"
          />
        )}
      </form.AppField>
      {props.footer(
        <form.Subscribe selector={state => state.values}>
          {values => {
            const replacing = values.value.length > 0
            return (
              <Button
                disabled={props.pending || !hasSecretUpdate({ alias: row.alias, form: values })}
                type="submit"
                variant={replacing && valueReplacementStage === 'confirming' ? 'destructive' : 'default'}
              >
                {props.pending
                  ? t('saving')
                  : replacing
                    ? valueReplacementStage === 'editing'
                      ? t('reviewReplacement')
                      : t('confirmReplacement')
                    : t('saveChanges')}
              </Button>
            )
          }}
        </form.Subscribe>,
      )}
    </form>
  )
}

export const SecretMutationDialog = (props: SecretMutationDialogProps): JSX.Element => {
  const [removeState, setRemoveState] = useState<RemovalDialogState>({ stage: 'choose' })
  const row = props.row
  const t = props.t
  const titleAlias = row?.alias ?? t('aliasFallback')

  const title =
    props.mode === 'create'
      ? t('dialogAddTitle')
      : props.mode === 'edit'
        ? t('dialogEditTitle', { alias: titleAlias })
        : t('dialogRemoveTitle', { alias: titleAlias })

  const finishRemove = (): void => {
    if (props.mode !== 'remove' || row === undefined) return
    const target = confirmedRemovalTarget(removeState)
    if (target === null) return
    props.onRemove(target, row)
  }

  const closeUnlessPending = (open: boolean): void => {
    if (!open && !props.pending) props.onClose()
  }

  const errorAlert = props.error !== null && (
    <Alert variant="destructive">
      <AlertDescription>{props.error}</AlertDescription>
    </Alert>
  )

  if (props.mode === 'remove') {
    return (
      <AlertDialog onOpenChange={closeUnlessPending} open>
        <AlertDialogContent className="dshx-root">
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            {row !== undefined && (
              <AlertDialogDescription>
                {removeState.stage === 'choose' ? (
                  <>
                    {t('chooseRemovalPrefix')} <strong className="dshx:font-mono dshx:text-foreground">{row.alias}</strong>
                    {t('chooseRemovalSuffix')}
                  </>
                ) : removeState.target === 'alias' ? (
                  t('confirmRemoveAlias', { alias: row.alias })
                ) : (
                  t('confirmDeleteItem', { alias: row.alias })
                )}
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          {errorAlert}
          {row !== undefined && removeState.stage === 'choose' && (
            <div className="dshx:flex dshx:flex-col dshx:gap-2">
              <Button
                className="dshx:justify-start"
                disabled={props.pending}
                onClick={() => setRemoveState(chooseRemovalTarget(removeState, 'alias'))}
                type="button"
                variant="outline"
              >
                {t('removeAliasAndOverrides')}
              </Button>
              <Button
                className="dshx:justify-start"
                disabled={props.pending}
                onClick={() => setRemoveState(chooseRemovalTarget(removeState, 'vault-item'))}
                type="button"
                variant="destructive"
              >
                {t('deleteVaultItem')}
              </Button>
            </div>
          )}
          <AlertDialogFooter>
            {removeState.stage === 'choose' ? (
              <Button disabled={props.pending} onClick={props.onClose} type="button" variant="outline">
                {t('cancel')}
              </Button>
            ) : (
              <>
                <Button disabled={props.pending} onClick={() => setRemoveState({ stage: 'choose' })} type="button" variant="outline">
                  {t('back')}
                </Button>
                <Button disabled={props.pending} onClick={finishRemove} type="button" variant="destructive">
                  {props.pending ? t('removing') : removeState.target === 'alias' ? t('confirmRemoveAliasAction') : t('confirmDeleteItemAction')}
                </Button>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  const cancelButton = (
    <Button disabled={props.pending} onClick={props.onClose} type="button" variant="outline">
      {t('cancel')}
    </Button>
  )

  return (
    <Dialog onOpenChange={closeUnlessPending} open>
      <DialogContent className="dshx-root dshx:max-h-[calc(100%-2rem)] dshx:overflow-y-auto dshx:sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="dshx:text-base">{title}</DialogTitle>
          {props.mode === 'create' && <DialogDescription>{t('dialogAddDescription')}</DialogDescription>}
          {props.mode === 'edit' && row !== undefined && (
            <DialogDescription>
              {t('editAliasLabel')} <strong className="dshx:font-mono dshx:text-foreground">{row.alias}</strong> · {row.scope} · {row.environment}.{' '}
              {t('editKeepHint')}
            </DialogDescription>
          )}
        </DialogHeader>
        {errorAlert}
        {props.mode === 'create' && (
          <CreateSecretForm
            {...props}
            footer={submit => (
              <DialogFooter>
                {cancelButton}
                {submit}
              </DialogFooter>
            )}
          />
        )}
        {props.mode === 'edit' && row !== undefined && (
          <EditSecretForm
            {...props}
            footer={submit => (
              <DialogFooter>
                {cancelButton}
                {submit}
              </DialogFooter>
            )}
            row={row}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
