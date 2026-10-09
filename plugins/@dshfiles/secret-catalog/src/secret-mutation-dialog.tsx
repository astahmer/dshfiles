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
import { Field, FieldLabel } from '@dshfiles/plugin-ui/components/ui/field'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { revalidateLogic, useAppForm } from '@dshfiles/plugin-ui/form'
import { useId, useState, type FormEvent, type ReactNode } from 'react'
import type { SecretCatalogTranslate } from './locales.js'
import type { SecretMetadata } from './secret-metadata.js'
import {
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

const submitWith =
  (handleSubmit: () => Promise<void>) =>
  (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void handleSubmit()
  }

const CreateSecretForm = (props: SecretMutationDialogProps & { readonly footer: (submit: ReactNode) => ReactNode }): JSX.Element => {
  const t = props.t
  const form = useAppForm({
    defaultValues: secretCreateFormDefaults({ scope: props.initialCreateScope, environment: props.defaultEnvironment }),
    validationLogic: revalidateLogic(),
    validators: { onDynamic: secretCreateFormSchema },
    onSubmit: ({ value }) => {
      if (needsProjectFolder({ scope: value.scope, hasProjectFolder: props.hasProjectFolder })) return
      props.onCreate(toSecretCreateInput(value))
    },
  })
  return (
    <form className="dshx:grid dshx:gap-4 dshx:sm:grid-cols-2" noValidate onSubmit={submitWith(form.handleSubmit)}>
      <form.AppField name="alias">{field => <field.TextField label={t('fieldAlias')} monospace required />}</form.AppField>
      <form.AppField name="environment">{field => <field.TextField label={t('fieldEnvironment')} required />}</form.AppField>
      <form.Subscribe selector={state => state.values.scope}>
        {scope => (
          <form.AppField name="scope">
            {field => (
              <field.SelectField
                description={
                  needsProjectFolder({ scope, hasProjectFolder: props.hasProjectFolder }) ? (
                    <span className="dshx:text-destructive">{t('needsProjectFolder')}</span>
                  ) : undefined
                }
                label={t('fieldTargetScope')}
                options={[
                  { value: 'global', label: t('targetGlobal') },
                  { value: 'project', label: t('targetProject') },
                  { value: 'local', label: t('targetLocal'), disabled: !props.hasProjectFolder },
                ]}
              />
            )}
          </form.AppField>
        )}
      </form.Subscribe>
      <form.AppField
        listeners={{
          onChange: ({ value }) => {
            if (value === 'generate') form.setFieldValue('value', '')
          },
        }}
        name="valueMode"
      >
        {field => (
          <field.SelectField
            label={t('fieldValueCreation')}
            options={[
              { value: 'generate', label: t('valueGenerate') },
              { value: 'manual', label: t('valueManual') },
            ]}
          />
        )}
      </form.AppField>
      <form.Subscribe selector={state => state.values.valueMode}>
        {valueMode =>
          valueMode === 'generate' ? (
            <p className="dshx:text-xs dshx:text-muted-foreground dshx:sm:col-span-2">{t('generateHint')}</p>
          ) : (
            <form.AppField name="value">
              {field => (
                <field.TextField autoComplete="new-password" className="dshx:sm:col-span-2" label={t('fieldSecretValue')} monospace required type="password" />
              )}
            </form.AppField>
          )
        }
      </form.Subscribe>
      <form.AppField name="name">{field => <field.TextField label={t('fieldItemName')} />}</form.AppField>
      <form.AppField name="source">{field => <field.TextField label={t('fieldSourceUrl')} />}</form.AppField>
      <form.AppField name="tags">{field => <field.TextField label={t('fieldTags')} placeholder={t('tagsPlaceholder')} />}</form.AppField>
      <form.AppField name="type">
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
      <form.AppField name="field">
        {field => <field.TextField className="dshx:sm:col-span-2" label={t('fieldField')} placeholder={t('fieldPlaceholder')} />}
      </form.AppField>
      {props.footer(
        <form.Subscribe selector={state => [state.values.scope, state.values.valueMode, state.values.value] as const}>
          {([scope, valueMode, value]) => (
            <Button
              disabled={
                props.pending || needsProjectFolder({ scope, hasProjectFolder: props.hasProjectFolder }) || (valueMode === 'manual' && value.length === 0)
              }
              type="submit"
            >
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
      <DialogContent
        {...(props.mode === 'create' ? { 'aria-describedby': undefined } : {})}
        className="dshx-root dshx:max-h-[calc(100%-2rem)] dshx:overflow-y-auto dshx:sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle className="dshx:text-base">{title}</DialogTitle>
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
              <DialogFooter className="dshx:sm:col-span-2">
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
