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
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@dshfiles/plugin-ui/components/ui/field'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useId, useState, type FormEvent } from 'react'
import type { SecretCatalogTranslate } from './locales.js'
import type { SecretMetadata } from './secret-metadata.js'
import {
  chooseRemovalTarget,
  confirmedRemovalTarget,
  maySubmitValueReplacement,
  requestValueReplacement,
  type RemovalDialogState,
  type ValueReplacementStage,
} from './secret-mutation-model.js'

export type SecretMutationScope = 'global' | 'project' | 'local'
export type SecretRemoveTarget = 'alias' | 'vault-item'

export interface SecretCreateForm {
  readonly alias: string
  readonly scope: SecretMutationScope
  readonly environment: string
  readonly valueMode: 'generate' | 'manual'
  readonly value: string | null
  readonly name?: string
  readonly source?: string
  readonly tags?: string
  readonly type?: string
  readonly field?: string
}

export interface SecretUpdateForm {
  readonly alias: string
  readonly scope: SecretMutationScope
  readonly environment: string
  readonly value: string | null
  readonly name?: string
  readonly source?: string
  readonly tags?: string
}

interface SecretMutationDialogProps {
  readonly mode: 'create' | 'edit' | 'remove'
  readonly row?: SecretMetadata
  readonly hasProjectFolder: boolean
  readonly initialCreateScope: SecretMutationScope
  readonly pending: boolean
  readonly error: string | null
  readonly onClose: () => void
  readonly onCreate: (input: SecretCreateForm) => void
  readonly onUpdate: (input: SecretUpdateForm) => void
  readonly onRemove: (target: SecretRemoveTarget, row: SecretMetadata) => void
  readonly t: SecretCatalogTranslate
}

const optionalText = (value: string): string | undefined => (value.length === 0 ? undefined : value)
const isSecretScope = (value: string): value is SecretMutationScope => value === 'global' || value === 'project' || value === 'local'

export const SecretMutationDialog = (props: SecretMutationDialogProps): JSX.Element => {
  const [alias, setAlias] = useState('')
  const [scope, setScope] = useState<SecretMutationScope>(props.initialCreateScope)
  const [environment, setEnvironment] = useState('prod')
  const [valueMode, setValueMode] = useState<'generate' | 'manual'>('generate')
  const [value, setValue] = useState('')
  const [name, setName] = useState('')
  const [source, setSource] = useState('')
  const [tags, setTags] = useState('')
  const [clearTags, setClearTags] = useState(false)
  const [type, setType] = useState('')
  const [field, setField] = useState('')
  const [removeState, setRemoveState] = useState<RemovalDialogState>({ stage: 'choose' })
  const [valueReplacementStage, setValueReplacementStage] = useState<ValueReplacementStage>('editing')
  const row = props.row
  const fieldId = useId()
  const t = props.t
  const titleAlias = row?.alias ?? t('aliasFallback')

  const title =
    props.mode === 'create'
      ? t('dialogAddTitle')
      : props.mode === 'edit'
        ? t('dialogEditTitle', { alias: titleAlias })
        : t('dialogRemoveTitle', { alias: titleAlias })

  const submitCreate = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (props.mode !== 'create') return
    if (scope !== 'global' && !props.hasProjectFolder) return
    if (valueMode === 'manual' && value.length === 0) return
    props.onCreate({
      alias,
      scope,
      environment,
      valueMode,
      value: valueMode === 'manual' ? value : null,
      ...(optionalText(name) === undefined ? {} : { name }),
      ...(optionalText(source) === undefined ? {} : { source }),
      ...(optionalText(tags) === undefined ? {} : { tags }),
      ...(type.length === 0 ? {} : { type }),
      ...(optionalText(field) === undefined ? {} : { field }),
    })
  }

  const submitUpdate = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (props.mode !== 'edit' || row === undefined) return
    if (value.length > 0 && !maySubmitValueReplacement(valueReplacementStage)) {
      setValueReplacementStage(requestValueReplacement(valueReplacementStage))
      return
    }
    if (!isSecretScope(row.scope)) return
    props.onUpdate({
      alias: row.alias,
      scope: row.scope,
      environment: row.environment,
      value: value.length === 0 ? null : value,
      ...(optionalText(name) === undefined ? {} : { name }),
      ...(optionalText(source) === undefined ? {} : { source }),
      ...(clearTags ? { tags: '' } : optionalText(tags) === undefined ? {} : { tags }),
    })
  }

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

  const fieldClassName = 'dshx:flex-col dshx:gap-1.5'

  return (
    <Dialog onOpenChange={closeUnlessPending} open>
      <DialogContent {...(props.mode === 'create' ? { 'aria-describedby': undefined } : {})} className="dshx-root dshx:max-h-[calc(100%-2rem)] dshx:overflow-y-auto dshx:sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="dshx:text-base">{title}</DialogTitle>
          {props.mode === 'edit' && row !== undefined && (
            <DialogDescription>
              {t('editAliasLabel')} <strong className="dshx:font-mono dshx:text-foreground">{row.alias}</strong> · {row.scope} · {row.environment}. {t('editKeepHint')}
            </DialogDescription>
          )}
        </DialogHeader>
        {errorAlert}
        {props.mode === 'create' && (
          <form className="dshx:grid dshx:gap-4 dshx:sm:grid-cols-2" onSubmit={submitCreate}>
            <Field className={fieldClassName}>
              <FieldLabel htmlFor={`${fieldId}-alias`}>{t('fieldAlias')}</FieldLabel>
              <Input
                autoComplete="off"
                className="dshx:font-mono!"
                id={`${fieldId}-alias`}
                maxLength={128}
                onChange={event => setAlias(event.currentTarget.value)}
                pattern="[A-Za-z_][A-Za-z0-9_-]*"
                required
                value={alias}
              />
            </Field>
            <Field className={fieldClassName}>
              <FieldLabel htmlFor={`${fieldId}-environment`}>{t('fieldEnvironment')}</FieldLabel>
              <Input
                autoComplete="off"
                id={`${fieldId}-environment`}
                maxLength={256}
                onChange={event => setEnvironment(event.currentTarget.value)}
                pattern="[A-Za-z0-9_-]+"
                required
                value={environment}
              />
            </Field>
            <Field className={fieldClassName}>
              <FieldLabel htmlFor={`${fieldId}-scope`}>{t('fieldTargetScope')}</FieldLabel>
              <Select
                onValueChange={next => {
                  if (isSecretScope(next)) setScope(next)
                }}
                value={scope}
              >
                <SelectTrigger className="dshx:w-full" id={`${fieldId}-scope`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">{t('targetGlobal')}</SelectItem>
                  <SelectItem value="project">{t('targetProject')}</SelectItem>
                  <SelectItem disabled={!props.hasProjectFolder} value="local">
                    {t('targetLocal')}
                  </SelectItem>
                </SelectContent>
              </Select>
              {scope !== 'global' && !props.hasProjectFolder && <FieldDescription className="dshx:text-xs dshx:text-destructive">{t('needsProjectFolder')}</FieldDescription>}
            </Field>
            <Field className={fieldClassName}>
              <FieldLabel htmlFor={`${fieldId}-value-mode`}>{t('fieldValueCreation')}</FieldLabel>
              <Select
                onValueChange={next => {
                  const nextMode = next === 'manual' ? 'manual' : 'generate'
                  setValueMode(nextMode)
                  if (nextMode === 'generate') setValue('')
                }}
                value={valueMode}
              >
                <SelectTrigger className="dshx:w-full" id={`${fieldId}-value-mode`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="generate">{t('valueGenerate')}</SelectItem>
                  <SelectItem value="manual">{t('valueManual')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {valueMode === 'generate' ? (
              <p className="dshx:text-xs dshx:text-muted-foreground dshx:sm:col-span-2">{t('generateHint')}</p>
            ) : (
              <Field className={cn(fieldClassName, 'dshx:sm:col-span-2')}>
                <FieldLabel htmlFor={`${fieldId}-value`}>{t('fieldSecretValue')}</FieldLabel>
                <Input
                  autoComplete="new-password"
                  className="dshx:font-mono!"
                  id={`${fieldId}-value`}
                  onChange={event => setValue(event.currentTarget.value)}
                  required
                  type="password"
                  value={value}
                />
              </Field>
            )}
            <Field className={fieldClassName}>
              <FieldLabel htmlFor={`${fieldId}-name`}>{t('fieldItemName')}</FieldLabel>
              <Input autoComplete="off" id={`${fieldId}-name`} onChange={event => setName(event.currentTarget.value)} value={name} />
            </Field>
            <Field className={fieldClassName}>
              <FieldLabel htmlFor={`${fieldId}-source`}>{t('fieldSourceUrl')}</FieldLabel>
              <Input autoComplete="off" id={`${fieldId}-source`} onChange={event => setSource(event.currentTarget.value)} value={source} />
            </Field>
            <Field className={fieldClassName}>
              <FieldLabel htmlFor={`${fieldId}-tags`}>{t('fieldTags')}</FieldLabel>
              <Input autoComplete="off" id={`${fieldId}-tags`} onChange={event => setTags(event.currentTarget.value)} placeholder={t('tagsPlaceholder')} value={tags} />
            </Field>
            <Field className={fieldClassName}>
              <FieldLabel htmlFor={`${fieldId}-type`}>{t('fieldItemType')}</FieldLabel>
              <Select onValueChange={setType} value={type || 'login'}>
                <SelectTrigger className="dshx:w-full" id={`${fieldId}-type`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="login">{t('itemTypeLogin')}</SelectItem>
                  <SelectItem value="secure-note">{t('itemTypeSecureNote')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field className={cn(fieldClassName, 'dshx:sm:col-span-2')}>
              <FieldLabel htmlFor={`${fieldId}-field`}>{t('fieldField')}</FieldLabel>
              <Input autoComplete="off" id={`${fieldId}-field`} onChange={event => setField(event.currentTarget.value)} placeholder={t('fieldPlaceholder')} value={field} />
            </Field>
            <DialogFooter className="dshx:sm:col-span-2">
              <Button disabled={props.pending} onClick={props.onClose} type="button" variant="outline">
                {t('cancel')}
              </Button>
              <Button disabled={props.pending || (scope !== 'global' && !props.hasProjectFolder) || (valueMode === 'manual' && value.length === 0)} type="submit">
                {props.pending ? t('adding') : t('addAlias')}
              </Button>
            </DialogFooter>
          </form>
        )}
        {props.mode === 'edit' && row !== undefined && (
          <form className="dshx:grid dshx:gap-4" onSubmit={submitUpdate}>
            <Field className={fieldClassName}>
              <FieldLabel htmlFor={`${fieldId}-name`}>{t('fieldItemName')}</FieldLabel>
              <Input
                autoComplete="off"
                id={`${fieldId}-name`}
                onChange={event => setName(event.currentTarget.value)}
                placeholder={row.item || t('keepCurrent')}
                value={name}
              />
            </Field>
            <Field className={fieldClassName}>
              <FieldLabel htmlFor={`${fieldId}-source`}>{t('fieldSourceUrl')}</FieldLabel>
              <Input
                autoComplete="off"
                id={`${fieldId}-source`}
                onChange={event => setSource(event.currentTarget.value)}
                placeholder={row.service || t('keepCurrent')}
                value={source}
              />
            </Field>
            <Field className={fieldClassName}>
              <FieldLabel htmlFor={`${fieldId}-tags`}>{t('fieldTags')}</FieldLabel>
              <Input
                autoComplete="off"
                disabled={clearTags}
                id={`${fieldId}-tags`}
                onChange={event => setTags(event.currentTarget.value)}
                placeholder={t('tagsPlaceholder')}
                value={tags}
              />
            </Field>
            <Field className="dshx:flex-row dshx:items-center dshx:gap-2" orientation="horizontal">
              <Checkbox checked={clearTags} id={`${fieldId}-clear-tags`} onCheckedChange={checked => setClearTags(checked === true)} />
              <FieldLabel className="dshx:font-normal" htmlFor={`${fieldId}-clear-tags`}>
                {t('clearAllTags')}
              </FieldLabel>
            </Field>
            <Field className={fieldClassName}>
              <FieldLabel htmlFor={`${fieldId}-value`}>{t('replaceValue')}</FieldLabel>
              <Input
                autoComplete="new-password"
                className="dshx:font-mono!"
                id={`${fieldId}-value`}
                onChange={event => {
                  setValue(event.currentTarget.value)
                  setValueReplacementStage('editing')
                }}
                type="password"
                value={value}
              />
              {value.length > 0 && valueReplacementStage === 'confirming' && (
                <FieldDescription className="dshx:text-xs dshx:text-warning">{t('confirmReplacementHint')}</FieldDescription>
              )}
            </Field>
            <DialogFooter>
              <Button disabled={props.pending} onClick={props.onClose} type="button" variant="outline">
                {t('cancel')}
              </Button>
              <Button
                disabled={props.pending || (name.length + source.length + tags.length === 0 && !clearTags && value.length === 0)}
                type="submit"
                variant={value.length > 0 && valueReplacementStage === 'confirming' ? 'destructive' : 'default'}
              >
                {props.pending
                  ? t('saving')
                  : value.length > 0
                    ? valueReplacementStage === 'editing'
                      ? t('reviewReplacement')
                      : t('confirmReplacement')
                    : t('saveChanges')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
