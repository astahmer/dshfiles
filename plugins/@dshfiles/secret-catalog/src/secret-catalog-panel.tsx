import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { useApi } from '@dshfiles/dshx/client'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ProjectFolderPicker, type DirectoryPickerPort, type ProjectFolderSelection, type RegisteredProject } from '@dshfiles/project-folder-picker'
import {
  SecretMutationDialog,
  type SecretCreateForm,
  type SecretMutationScope,
  type SecretRemoveTarget,
  type SecretUpdateForm,
} from './secret-mutation-dialog.js'
import { createSecretActionPolicy, filterSecretMetadata, type SecretScopeFilter } from './secret-catalog-model.js'
import { nextSecretRevealStage, previewSecretValue, type SecretRevealStage } from './secret-reveal-model.js'
import { secretCatalogApi } from './api.js'
import type { SecretMetadata } from './secret-metadata.js'
import styles from './secret-catalog.module.css'

interface SecretCatalogPanelProps {
  readonly directoryPicker: DirectoryPickerPort
  readonly workspaces: IWorkspaces
  readonly registerWorkspace: (canonicalPath: string) => Promise<RegisteredProject>
}

const scopes: readonly SecretScopeFilter[] = ['all', 'project', 'global', 'local']

const noopSubscribe = (): (() => void) => () => {}

const emptyWorkspaceSnapshot = (): ReturnType<NonNullable<IWorkspaces['list']>['getSnapshot']> =>
  ({ items: [], phase: 'idle' }) as unknown as ReturnType<NonNullable<IWorkspaces['list']>['getSnapshot']>

type ActiveDialog = { readonly mode: 'create' } | { readonly mode: 'edit' | 'remove'; readonly row: SecretMetadata }

export const SecretCatalogPanel = (props: SecretCatalogPanelProps): JSX.Element => {
  const api = useApi(secretCatalogApi)
  // The store is read here, at render, so a slot that mounts later still sees
  // the live list rather than whatever existed while setup was running.
  // `getSnapshot` reads the model's own cache, so it has to keep its receiver:
  // passed bare it runs with an undefined `this` and throws.
  const workspaceSource = props.workspaces?.list
  const subscribe = workspaceSource === undefined ? noopSubscribe : workspaceSource.subscribe.bind(workspaceSource)
  const getSnapshot =
    workspaceSource === undefined
      ? emptyWorkspaceSnapshot
      : (): ReturnType<NonNullable<IWorkspaces['list']>['getSnapshot']> => workspaceSource.getSnapshot()
  const workspaceSnapshot = useSyncExternalStore(subscribe, getSnapshot, emptyWorkspaceSnapshot)
  const [selection, setSelection] = useState<ProjectFolderSelection | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [rows, setRows] = useState<readonly SecretMetadata[]>([])
  const [scope, setScope] = useState<SecretScopeFilter>('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<{ readonly id: string; readonly value: string; readonly stage: SecretRevealStage } | null>(null)
  const [busyRow, setBusyRow] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dialog, setDialog] = useState<ActiveDialog | null>(null)
  const [mutationPending, setMutationPending] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [machineName, setMachineName] = useState('Current Host')
  const [refreshGeneration, setRefreshGeneration] = useState(0)
  const requestGeneration = useRef(0)
  const revealGeneration = useRef(0)
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cwd = selection?.canonicalPath ?? null
  const projects: readonly RegisteredProject[] = workspaceSnapshot.items.map(workspace => ({
    workspaceId: workspace.workspaceId,
    title: workspace.title,
    canonicalPath: workspace.path,
  }))

  const clearRevealed = useCallback((): void => {
    revealGeneration.current += 1
    if (revealTimer.current !== null) clearTimeout(revealTimer.current)
    revealTimer.current = null
    setRevealed(null)
    setBusyRow(null)
  }, [])

  useEffect(() => {
    const generation = ++requestGeneration.current
    setLoading(true)
    setError(null)
    clearRevealed()
    void api
      .list({ cwd })
      .then(result => {
        if (generation === requestGeneration.current) setRows(result)
      })
      .catch(() => {
        if (generation === requestGeneration.current) setError('Secret metadata could not be loaded. Check the secret CLI and refresh.')
      })
      .finally(() => {
        if (generation === requestGeneration.current) setLoading(false)
      })
    return () => {
      requestGeneration.current += 1
    }
  }, [api, clearRevealed, cwd, refreshGeneration])

  useEffect(() => {
    const clearOnHidden = (): void => {
      if (document.visibilityState === 'hidden') clearRevealed()
    }
    window.addEventListener('blur', clearRevealed)
    document.addEventListener('visibilitychange', clearOnHidden)
    return () => {
      window.removeEventListener('blur', clearRevealed)
      document.removeEventListener('visibilitychange', clearOnHidden)
    }
  }, [clearRevealed])

  useEffect(
    () => () => {
      requestGeneration.current += 1
      revealGeneration.current += 1
      if (revealTimer.current !== null) clearTimeout(revealTimer.current)
    },
    [],
  )

  useEffect(() => {
    void api
      .machine({})
      .then(machine => setMachineName(machine.name))
      .catch(() => setMachineName('Current Host'))
  }, [api])

  const filteredRows = useMemo(() => filterSecretMetadata(rows, scope, search), [rows, scope, search])
  const canActOnRow = useMemo(() => createSecretActionPolicy(rows, cwd !== null), [rows, cwd])
  const mutationScopeFor = (row: SecretMetadata): SecretMutationScope | null => {
    if (row.scope === 'global' || row.scope === 'project' || row.scope === 'local') return row.scope
    return null
  }

  const onReveal = async (row: SecretMetadata): Promise<void> => {
    if (!canActOnRow(row)) return
    const rowScope = mutationScopeFor(row)
    if (rowScope === null) return
    if (revealed?.id === row.id) {
      const nextStage = nextSecretRevealStage(revealed.stage)
      if (nextStage === null) clearRevealed()
      else setRevealed({ ...revealed, stage: nextStage })
      return
    }
    clearRevealed()
    const generation = ++revealGeneration.current
    setBusyRow(row.id)
    setError(null)
    try {
      const value = await api.reveal({ alias: row.alias, cwd, scope: rowScope, environment: row.environment })
      if (generation !== revealGeneration.current || document.visibilityState === 'hidden') return
      setRevealed({ id: row.id, value, stage: 'preview' })
      revealTimer.current = setTimeout(clearRevealed, 15_000)
    } catch {
      if (generation === revealGeneration.current) setError('Could not reveal this alias.')
    } finally {
      if (generation === revealGeneration.current) setBusyRow(null)
    }
  }

  const onCopy = async (row: SecretMetadata): Promise<void> => {
    if (!canActOnRow(row)) return
    const rowScope = mutationScopeFor(row)
    if (rowScope === null) return
    setBusyRow(row.id)
    setNotice(null)
    setError(null)
    try {
      await api.copy({ alias: row.alias, cwd, scope: rowScope, environment: row.environment })
      setNotice('Copied ' + row.alias + ' to the clipboard.')
    } catch {
      setError('Could not copy this alias.')
    } finally {
      setBusyRow(null)
    }
  }

  const onCreate = async (input: SecretCreateForm): Promise<void> => {
    setMutationPending(true)
    setMutationError(null)
    clearRevealed()
    try {
      await api.create({ ...input, cwd })
      setNotice('Added alias ' + input.alias + '.')
      setDialog(null)
      setRefreshGeneration(value => value + 1)
    } catch {
      setMutationError('Could not add the alias. Check its scope and the secret CLI.')
    } finally {
      setMutationPending(false)
    }
  }

  const onUpdate = async (input: SecretUpdateForm): Promise<void> => {
    setMutationPending(true)
    setMutationError(null)
    clearRevealed()
    try {
      await api.update({ ...input, cwd })
      setNotice('Updated alias ' + input.alias + '.')
      setDialog(null)
      setRefreshGeneration(value => value + 1)
    } catch {
      setMutationError('Could not update the alias. Metadata may have saved before a value replacement failed.')
    } finally {
      setMutationPending(false)
    }
  }

  const onRemove = async (target: SecretRemoveTarget, row: SecretMetadata): Promise<void> => {
    const rowScope = mutationScopeFor(row)
    if (rowScope === null || !canActOnRow(row)) return
    setMutationPending(true)
    setMutationError(null)
    clearRevealed()
    try {
      if (target === 'alias') await api.removeAlias({ alias: row.alias, cwd, scope: rowScope })
      if (target === 'vault-item') await api.deleteItem({ alias: row.alias, cwd, scope: rowScope, environment: row.environment })
      setNotice(
        target === 'alias'
          ? 'Removed alias ' + row.alias + ' and its environment overrides from its config.'
          : 'Deleted the Bitwarden item for ' + row.alias + '.',
      )
      setDialog(null)
      setRefreshGeneration(value => value + 1)
    } catch {
      setMutationError(target === 'alias' ? 'Could not remove the alias.' : 'Could not delete the Bitwarden item.')
    } finally {
      setMutationPending(false)
    }
  }

  const openDialog = (next: ActiveDialog): void => {
    clearRevealed()
    setMutationError(null)
    setDialog(next)
  }

  const selectFolder = (next: ProjectFolderSelection): void => {
    clearRevealed()
    setSelection(next)
    setPickerOpen(false)
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <div className={styles.titleRow}>
            <h1>Secret Catalog</h1>
            <span className={styles.count}>{rows.length} aliases</span>
          </div>
          <p>Secret CLI aliases and metadata. Values stay hidden until you reveal one.</p>
        </div>
        <div className={styles.headerActions}>
          <button
            disabled={loading}
            onClick={() => {
              clearRevealed()
              setRefreshGeneration(value => value + 1)
            }}
            type="button"
          >
            Refresh
          </button>
          <button onClick={() => openDialog({ mode: 'create' })} type="button">
            + Add Secret
          </button>
          <label className={styles.machine}>
            Machine
            <select
              aria-label="Machine"
              disabled
              onChange={event => setMachineName(event.currentTarget.value)}
              title="The current DSH Host can access this machine only. The secret CLI has no remote machine selector."
              value={machineName}
            >
              <option value={machineName}>{machineName}</option>
            </select>
          </label>
        </div>
      </header>
      <section className={styles.filters} aria-label="Catalog filters">
        <button className={styles.folderSelect} onClick={() => setPickerOpen(true)} type="button">
          {selection === null ? 'Choose a project folder…' : `${selection.title} · ${selection.canonicalPath}`}
        </button>
        <nav className={styles.scopes} aria-label="Secret scope">
          {scopes.map(value => (
            <button
              aria-pressed={scope === value}
              className={scope === value ? styles.activeScope : ''}
              key={value}
              onClick={() => {
                clearRevealed()
                setScope(value)
              }}
              type="button"
            >
              {value}
            </button>
          ))}
        </nav>
      </section>
      {cwd === null && <p className={styles.notice}>Global aliases are shown. Choose a project folder to include project and machine-local aliases.</p>}
      <input
        className={styles.search}
        aria-label="Filter aliases"
        onChange={event => {
          clearRevealed()
          setSearch(event.currentTarget.value)
        }}
        placeholder="Filter by variable name, service, or alias…"
        value={search}
      />
      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice !== null && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Variable</th>
              <th>Description / service</th>
              <th>Value</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map(row => (
              <tr key={row.id}>
                <td>
                  <strong className={styles.variable}>{row.variableName}</strong>
                  <small>
                    {row.alias} · {row.scope} · {row.environment}
                    {row.field.length > 0 ? ` · ${row.field}` : ''}
                  </small>
                </td>
                <td>
                  <strong>{row.description || row.service || row.item || row.alias}</strong>
                  <small>
                    {row.service}
                    {row.item && row.service !== row.item ? ` · ${row.item}` : ''}
                  </small>
                </td>
                <td className={styles.valueCell}>
                  {revealed?.id === row.id ? (
                    <output className={styles.revealed}>{revealed.stage === 'preview' ? previewSecretValue(revealed.value) : revealed.value}</output>
                  ) : (
                    <span aria-label="Hidden secret value" className={styles.mask}>
                      ••••••••••••
                    </span>
                  )}
                </td>
                <td>
                  <div className={styles.actions}>
                    <button
                      aria-label={`${revealed?.id === row.id ? (revealed.stage === 'preview' ? 'Reveal full' : 'Hide') : 'Preview'} ${row.alias}`}
                      disabled={!canActOnRow(row) || busyRow === row.id}
                      onClick={() => void onReveal(row)}
                      title={!canActOnRow(row) ? 'Choose a project folder and resolve duplicate alias/environment rows first.' : undefined}
                      type="button"
                    >
                      {revealed?.id === row.id ? (revealed.stage === 'preview' ? 'Reveal full' : 'Hide') : 'Preview'}
                    </button>
                    <button
                      aria-label={`Copy ${row.alias}`}
                      disabled={!canActOnRow(row) || busyRow === row.id}
                      onClick={() => void onCopy(row)}
                      title={!canActOnRow(row) ? 'Choose a project folder and resolve duplicate alias/environment rows first.' : undefined}
                      type="button"
                    >
                      Copy
                    </button>
                    <button
                      aria-label={'Edit ' + row.alias}
                      disabled={!canActOnRow(row) || busyRow === row.id}
                      onClick={() => openDialog({ mode: 'edit', row })}
                      type="button"
                    >
                      Edit
                    </button>
                    <button
                      aria-label={'Remove ' + row.alias}
                      disabled={!canActOnRow(row) || busyRow === row.id}
                      onClick={() => openDialog({ mode: 'remove', row })}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && filteredRows.length === 0 && (
              <tr>
                <td className={styles.empty} colSpan={4}>
                  {rows.length === 0 ? 'No aliases found.' : 'No aliases match these filters.'}
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td className={styles.empty} colSpan={4}>
                  Loading alias metadata…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pickerOpen && (
        <ProjectFolderPicker
          directoryPicker={props.directoryPicker}
          onClose={() => setPickerOpen(false)}
          onRegisterWorkspace={async canonicalPath => {
            const workspace = await props.registerWorkspace(canonicalPath)
            return { workspaceId: workspace.workspaceId, title: workspace.title, canonicalPath: workspace.canonicalPath }
          }}
          onSelect={selectFolder}
          projects={projects}
          title="Choose a project folder"
        />
      )}
      {dialog !== null && (
        <SecretMutationDialog
          error={mutationError}
          hasProjectFolder={cwd !== null}
          initialCreateScope={scope === 'all' ? (cwd === null ? 'global' : 'project') : scope}
          mode={dialog.mode}
          onClose={() => {
            setDialog(null)
            setMutationError(null)
          }}
          onCreate={input => {
            void onCreate(input)
          }}
          onRemove={(target, row) => {
            void onRemove(target, row)
          }}
          onUpdate={input => {
            void onUpdate(input)
          }}
          pending={mutationPending}
          row={'row' in dialog ? dialog.row : undefined}
        />
      )}
    </main>
  )
}
