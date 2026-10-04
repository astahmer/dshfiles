import { useState, type FormEvent } from 'react'
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

  const title = props.mode === 'create' ? 'Add secret alias' : props.mode === 'edit' ? 'Edit ' + (row?.alias ?? 'alias') : 'Remove ' + (row?.alias ?? 'alias')

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
          <button aria-label="Close dialog" disabled={props.pending} onClick={props.onClose} type="button">
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
              Alias
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
              Target scope
              <select
                onChange={event => {
                  if (isSecretScope(event.currentTarget.value)) setScope(event.currentTarget.value)
                }}
                value={scope}
              >
                <option value="global">Global aliases</option>
                <option value="project">Selected project</option>
                <option disabled={!props.hasProjectFolder} value="local">
                  Machine-local override
                </option>
              </select>
            </label>
            {scope !== 'global' && !props.hasProjectFolder && <p className={styles.formHint}>Choose a project folder before adding this alias.</p>}
            <label>
              Environment
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
              Value creation
              <select
                onChange={event => {
                  const nextMode = event.currentTarget.value === 'manual' ? 'manual' : 'generate'
                  setValueMode(nextMode)
                  if (nextMode === 'generate') setValue('')
                }}
                value={valueMode}
              >
                <option value="generate">Generate on this Host</option>
                <option value="manual">Enter value</option>
              </select>
            </label>
            {valueMode === 'generate' ? (
              <p className={styles.formHint}>The CLI generates the value on this Host; it never enters the form.</p>
            ) : (
              <label>
                Secret value
                <input autoComplete="new-password" onChange={event => setValue(event.currentTarget.value)} required type="password" value={value} />
              </label>
            )}
            <label>
              Item name
              <input autoComplete="off" onChange={event => setName(event.currentTarget.value)} value={name} />
            </label>
            <label>
              Source URL
              <input autoComplete="off" onChange={event => setSource(event.currentTarget.value)} value={source} />
            </label>
            <label>
              Tags
              <input autoComplete="off" onChange={event => setTags(event.currentTarget.value)} placeholder="Comma-separated" value={tags} />
            </label>
            <label>
              Item type
              <select onChange={event => setType(event.currentTarget.value)} value={type || 'login'}>
                <option value="login">Login</option>
                <option value="secure-note">Secure Note</option>
              </select>
            </label>
            <label>
              Field
              <input autoComplete="off" onChange={event => setField(event.currentTarget.value)} placeholder="password" value={field} />
            </label>
            <footer className={styles.dialogActions}>
              <button disabled={props.pending} onClick={props.onClose} type="button">
                Cancel
              </button>
              <button
                disabled={props.pending || (scope !== 'global' && !props.hasProjectFolder) || (valueMode === 'manual' && value.length === 0)}
                type="submit"
              >
                {props.pending ? 'Adding…' : 'Add alias'}
              </button>
            </footer>
          </form>
        )}
        {props.mode === 'edit' && row !== undefined && (
          <form className={styles.dialogForm} onSubmit={submitUpdate}>
            <p className={styles.formHint}>
              Alias: <strong>{row.alias}</strong> · {row.scope} · {row.environment}. Blank fields keep their current values.
            </p>
            <label>
              Item name
              <input autoComplete="off" onChange={event => setName(event.currentTarget.value)} placeholder={row.item || 'Keep current'} value={name} />
            </label>
            <label>
              Source URL
              <input autoComplete="off" onChange={event => setSource(event.currentTarget.value)} placeholder={row.service || 'Keep current'} value={source} />
            </label>
            <label>
              Tags
              <input
                autoComplete="off"
                disabled={clearTags}
                onChange={event => setTags(event.currentTarget.value)}
                placeholder="Comma-separated"
                value={tags}
              />
            </label>
            <label className={styles.inlineField}>
              <input checked={clearTags} onChange={event => setClearTags(event.currentTarget.checked)} type="checkbox" />
              Clear all tags
            </label>
            <label>
              Replace value (optional)
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
            {value.length > 0 && valueReplacementStage === 'confirming' && (
              <p className={styles.formHint}>Confirm that you want to replace the current secret value. The new value remains masked.</p>
            )}
            <footer className={styles.dialogActions}>
              <button disabled={props.pending} onClick={props.onClose} type="button">
                Cancel
              </button>
              <button disabled={props.pending || (name.length + source.length + tags.length === 0 && !clearTags && value.length === 0)} type="submit">
                {props.pending
                  ? 'Saving…'
                  : value.length > 0
                    ? valueReplacementStage === 'editing'
                      ? 'Review replacement'
                      : 'Confirm replacement'
                    : 'Save changes'}
              </button>
            </footer>
          </form>
        )}
        {props.mode === 'remove' && row !== undefined && (
          <div className={styles.dialogForm}>
            {removeState.stage === 'choose' ? (
              <>
                <p>
                  Choose which stored record to remove for <strong>{row.alias}</strong>.
                </p>
                <button disabled={props.pending} onClick={() => setRemoveState(chooseRemovalTarget(removeState, 'alias'))} type="button">
                  Remove alias and all environment overrides
                </button>
                <button
                  className={styles.dangerButton}
                  disabled={props.pending}
                  onClick={() => setRemoveState(chooseRemovalTarget(removeState, 'vault-item'))}
                  type="button"
                >
                  Delete the Bitwarden item…
                </button>
                <footer className={styles.dialogActions}>
                  <button disabled={props.pending} onClick={props.onClose} type="button">
                    Cancel
                  </button>
                </footer>
              </>
            ) : (
              <>
                <p className={styles.error} role="alert">
                  {removeState.target === 'alias'
                    ? 'Confirm removing alias ' + row.alias + ' and every environment override from its owning config. The Bitwarden item remains.'
                    : 'Confirm deleting the Bitwarden item resolved by alias ' + row.alias + '. This cannot be undone.'}
                </p>
                <footer className={styles.dialogActions}>
                  <button disabled={props.pending} onClick={() => setRemoveState({ stage: 'choose' })} type="button">
                    Back
                  </button>
                  <button className={styles.dangerButton} disabled={props.pending} onClick={finishRemove} type="button">
                    {props.pending ? 'Removing…' : removeState.target === 'alias' ? 'Confirm remove alias' : 'Confirm delete item'}
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
