import { useState, type FormEvent } from 'react'
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
import styles from './secret-mutation.module.css'

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

  return (
    <div className={styles.dialogOverlay}>
      <section
        aria-labelledby="secret-dialog-title"
        aria-modal="true"
        className={styles.dialog}
        onKeyDown={event => {
          if (event.key === 'Escape' && !props.pending) props.onClose()
        }}
        role="dialog"
      >
        <header className={styles.dialogHeader}>
          <h2 id="secret-dialog-title">{title}</h2>
          <button aria-label={t('closeDialog')} disabled={props.pending} onClick={props.onClose} type="button">
            ×
          </button>
        </header>
        {props.error !== null && (
          <p className={styles.error} role="alert">
            {props.error}
          </p>
        )}
        {props.mode === 'create' && (
          <form className={styles.dialogForm} onSubmit={submitCreate}>
            <label>
              {t('fieldAlias')}
              <input
                autoComplete="off"
                maxLength={128}
                onChange={event => setAlias(event.currentTarget.value)}
                pattern="[A-Za-z_][A-Za-z0-9_-]*"
                required
                value={alias}
              />
            </label>
            <label>
              {t('fieldTargetScope')}
              <select
                onChange={event => {
                  if (isSecretScope(event.currentTarget.value)) setScope(event.currentTarget.value)
                }}
                value={scope}
              >
                <option value="global">{t('targetGlobal')}</option>
                <option value="project">{t('targetProject')}</option>
                <option disabled={!props.hasProjectFolder} value="local">
                  {t('targetLocal')}
                </option>
              </select>
            </label>
            {scope !== 'global' && !props.hasProjectFolder && <p className={styles.formHint}>{t('needsProjectFolder')}</p>}
            <label>
              {t('fieldEnvironment')}
              <input
                autoComplete="off"
                maxLength={256}
                onChange={event => setEnvironment(event.currentTarget.value)}
                pattern="[A-Za-z0-9_-]+"
                required
                value={environment}
              />
            </label>
            <label>
              {t('fieldValueCreation')}
              <select
                onChange={event => {
                  const nextMode = event.currentTarget.value === 'manual' ? 'manual' : 'generate'
                  setValueMode(nextMode)
                  if (nextMode === 'generate') setValue('')
                }}
                value={valueMode}
              >
                <option value="generate">{t('valueGenerate')}</option>
                <option value="manual">{t('valueManual')}</option>
              </select>
            </label>
            {valueMode === 'generate' ? (
              <p className={styles.formHint}>{t('generateHint')}</p>
            ) : (
              <label>
                {t('fieldSecretValue')}
                <input autoComplete="new-password" onChange={event => setValue(event.currentTarget.value)} required type="password" value={value} />
              </label>
            )}
            <label>
              {t('fieldItemName')}
              <input autoComplete="off" onChange={event => setName(event.currentTarget.value)} value={name} />
            </label>
            <label>
              {t('fieldSourceUrl')}
              <input autoComplete="off" onChange={event => setSource(event.currentTarget.value)} value={source} />
            </label>
            <label>
              {t('fieldTags')}
              <input autoComplete="off" onChange={event => setTags(event.currentTarget.value)} placeholder={t('tagsPlaceholder')} value={tags} />
            </label>
            <label>
              {t('fieldItemType')}
              <select onChange={event => setType(event.currentTarget.value)} value={type || 'login'}>
                <option value="login">{t('itemTypeLogin')}</option>
                <option value="secure-note">{t('itemTypeSecureNote')}</option>
              </select>
            </label>
            <label>
              {t('fieldField')}
              <input autoComplete="off" onChange={event => setField(event.currentTarget.value)} placeholder={t('fieldPlaceholder')} value={field} />
            </label>
            <footer className={styles.dialogActions}>
              <button disabled={props.pending} onClick={props.onClose} type="button">
                {t('cancel')}
              </button>
              <button
                disabled={props.pending || (scope !== 'global' && !props.hasProjectFolder) || (valueMode === 'manual' && value.length === 0)}
                type="submit"
              >
                {props.pending ? t('adding') : t('addAlias')}
              </button>
            </footer>
          </form>
        )}
        {props.mode === 'edit' && row !== undefined && (
          <form className={styles.dialogForm} onSubmit={submitUpdate}>
            <p className={styles.formHint}>
              {t('editAliasLabel')} <strong>{row.alias}</strong> · {row.scope} · {row.environment}. {t('editKeepHint')}
            </p>
            <label>
              {t('fieldItemName')}
              <input autoComplete="off" onChange={event => setName(event.currentTarget.value)} placeholder={row.item || t('keepCurrent')} value={name} />
            </label>
            <label>
              {t('fieldSourceUrl')}
              <input autoComplete="off" onChange={event => setSource(event.currentTarget.value)} placeholder={row.service || t('keepCurrent')} value={source} />
            </label>
            <label>
              {t('fieldTags')}
              <input
                autoComplete="off"
                disabled={clearTags}
                onChange={event => setTags(event.currentTarget.value)}
                placeholder={t('tagsPlaceholder')}
                value={tags}
              />
            </label>
            <label className={styles.inlineField}>
              <input checked={clearTags} onChange={event => setClearTags(event.currentTarget.checked)} type="checkbox" />
              {t('clearAllTags')}
            </label>
            <label>
              {t('replaceValue')}
              <input
                autoComplete="new-password"
                onChange={event => {
                  setValue(event.currentTarget.value)
                  setValueReplacementStage('editing')
                }}
                type="password"
                value={value}
              />
            </label>
            {value.length > 0 && valueReplacementStage === 'confirming' && <p className={styles.formHint}>{t('confirmReplacementHint')}</p>}
            <footer className={styles.dialogActions}>
              <button disabled={props.pending} onClick={props.onClose} type="button">
                {t('cancel')}
              </button>
              <button disabled={props.pending || (name.length + source.length + tags.length === 0 && !clearTags && value.length === 0)} type="submit">
                {props.pending
                  ? t('saving')
                  : value.length > 0
                    ? valueReplacementStage === 'editing'
                      ? t('reviewReplacement')
                      : t('confirmReplacement')
                    : t('saveChanges')}
              </button>
            </footer>
          </form>
        )}
        {props.mode === 'remove' && row !== undefined && (
          <div className={styles.dialogForm}>
            {removeState.stage === 'choose' ? (
              <>
                <p>
                  {t('chooseRemovalPrefix')} <strong>{row.alias}</strong>
                  {t('chooseRemovalSuffix')}
                </p>
                <button disabled={props.pending} onClick={() => setRemoveState(chooseRemovalTarget(removeState, 'alias'))} type="button">
                  {t('removeAliasAndOverrides')}
                </button>
                <button
                  className={styles.dangerButton}
                  disabled={props.pending}
                  onClick={() => setRemoveState(chooseRemovalTarget(removeState, 'vault-item'))}
                  type="button"
                >
                  {t('deleteVaultItem')}
                </button>
                <footer className={styles.dialogActions}>
                  <button disabled={props.pending} onClick={props.onClose} type="button">
                    {t('cancel')}
                  </button>
                </footer>
              </>
            ) : (
              <>
                <p className={styles.error} role="alert">
                  {removeState.target === 'alias' ? t('confirmRemoveAlias', { alias: row.alias }) : t('confirmDeleteItem', { alias: row.alias })}
                </p>
                <footer className={styles.dialogActions}>
                  <button disabled={props.pending} onClick={() => setRemoveState({ stage: 'choose' })} type="button">
                    {t('back')}
                  </button>
                  <button className={styles.dangerButton} disabled={props.pending} onClick={finishRemove} type="button">
                    {props.pending ? t('removing') : removeState.target === 'alias' ? t('confirmRemoveAliasAction') : t('confirmDeleteItemAction')}
                  </button>
                </footer>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
