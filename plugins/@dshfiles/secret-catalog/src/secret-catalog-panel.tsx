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
import type { SecretCatalogTranslate } from './locales.js'
import type { SecretMetadata } from './secret-metadata.js'
import styles from './secret-catalog.module.css'

interface SecretCatalogPanelProps {
  readonly directoryPicker: DirectoryPickerPort
  readonly workspaces: IWorkspaces
  readonly registerWorkspace: (canonicalPath: string) => Promise<RegisteredProject>
  readonly t: SecretCatalogTranslate
}

const scopes: readonly SecretScopeFilter[] = ['all', 'project', 'global', 'local']

const noopSubscribe = (): (() => void) => () => {}

const emptyWorkspaceSnapshot = (): ReturnType<NonNullable<IWorkspaces['list']>['getSnapshot']> =>
  ({ items: [], phase: 'idle' }) as unknown as ReturnType<NonNullable<IWorkspaces['list']>['getSnapshot']>

const scopeLabelKeys = {
  all: 'scopeAll',
  project: 'scopeProject',
  global: 'scopeGlobal',
  local: 'scopeLocal',
} satisfies Record<SecretScopeFilter, Parameters<SecretCatalogTranslate>[0]>

type ActiveDialog = { readonly mode: 'create' } | { readonly mode: 'edit' | 'remove'; readonly row: SecretMetadata }

export const SecretCatalogPanel = (props: SecretCatalogPanelProps): JSX.Element => {
  const api = useApi(secretCatalogApi)
  const t = props.t
  // The store is read here, at render, so a slot that mounts later still sees
  // the live list rather than whatever existed while setup was running.
  // `getSnapshot` reads the model's own cache, so it has to keep its receiver:
  // passed bare it runs with an undefined `this` and throws.
  const workspaceSource = props.workspaces?.list
  const subscribe = workspaceSource === undefined ? noopSubscribe : workspaceSource.subscribe.bind(workspaceSource)
  const getSnapshot =
    workspaceSource === undefined ? emptyWorkspaceSnapshot : (): ReturnType<NonNullable<IWorkspaces['list']>['getSnapshot']> => workspaceSource.getSnapshot()
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
  const [machineName, setMachineName] = useState<string | null>(null)
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
        if (generation === requestGeneration.current) setError(t('loadFailed'))
      })
      .finally(() => {
        if (generation === requestGeneration.current) setLoading(false)
      })
    return () => {
      requestGeneration.current += 1
    }
  }, [api, clearRevealed, cwd, refreshGeneration, t])

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
      .catch(() => setMachineName(null))
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
      if (generation === revealGeneration.current) setError(t('revealFailed'))
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
      setNotice(t('copied', { alias: row.alias }))
    } catch {
      setError(t('copyFailed'))
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
      setNotice(t('added', { alias: input.alias }))
      setDialog(null)
      setRefreshGeneration(value => value + 1)
    } catch {
      setMutationError(t('addFailed'))
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
      setNotice(t('updated', { alias: input.alias }))
      setDialog(null)
      setRefreshGeneration(value => value + 1)
    } catch {
      setMutationError(t('updateFailed'))
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
      setNotice(target === 'alias' ? t('removedAlias', { alias: row.alias }) : t('deletedItem', { alias: row.alias }))
      setDialog(null)
      setRefreshGeneration(value => value + 1)
    } catch {
      setMutationError(target === 'alias' ? t('removeAliasFailed') : t('deleteItemFailed'))
    } finally {
      setMutationPending(false)
    }
  }

  const revealActionFor = (row: SecretMetadata): string => {
    if (revealed?.id !== row.id) return t('preview')
    return revealed.stage === 'preview' ? t('revealFull') : t('hide')
  }

  const revealedText = (value: string, stage: SecretRevealStage): string => {
    if (stage === 'full') return value
    const preview = previewSecretValue(value)
    return preview.kind === 'excerpt' ? preview.text : t('previewMasked', { mask: preview.mask, count: preview.length })
  }

  const displayedMachineName = machineName ?? t('currentHost')

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
            <h1>{t('title')}</h1>
            <span className={styles.count}>{t('aliasCount', { count: rows.length })}</span>
          </div>
          <p>{t('subtitle')}</p>
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
            {t('refresh')}
          </button>
          <button onClick={() => openDialog({ mode: 'create' })} type="button">
            {t('addSecret')}
          </button>
          <label className={styles.machine}>
            {t('machine')}
            <select
              aria-label={t('machine')}
              disabled
              onChange={event => setMachineName(event.currentTarget.value)}
              title={t('machineSelectorHint')}
              value={displayedMachineName}
            >
              <option value={displayedMachineName}>{displayedMachineName}</option>
            </select>
          </label>
        </div>
      </header>
      <section className={styles.filters} aria-label={t('catalogFilters')}>
        <button className={styles.folderSelect} onClick={() => setPickerOpen(true)} type="button">
          {selection === null ? t('chooseProjectFolder') : `${selection.title} · ${selection.canonicalPath}`}
        </button>
        <nav className={styles.scopes} aria-label={t('secretScope')}>
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
              {t(scopeLabelKeys[value])}
            </button>
          ))}
        </nav>
      </section>
      {cwd === null && <p className={styles.notice}>{t('globalOnlyNotice')}</p>}
      <input
        className={styles.search}
        aria-label={t('filterAliases')}
        onChange={event => {
          clearRevealed()
          setSearch(event.currentTarget.value)
        }}
        placeholder={t('filterPlaceholder')}
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
              <th>{t('columnVariable')}</th>
              <th>{t('columnDescription')}</th>
              <th>{t('columnValue')}</th>
              <th>{t('columnActions')}</th>
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
                    <output className={styles.revealed}>{revealedText(revealed.value, revealed.stage)}</output>
                  ) : (
                    <span aria-label={t('hiddenValue')} className={styles.mask}>
                      ••••••••••••
                    </span>
                  )}
                </td>
                <td>
                  <div className={styles.actions}>
                    <button
                      aria-label={t('revealActionLabel', { action: revealActionFor(row), alias: row.alias })}
                      disabled={!canActOnRow(row) || busyRow === row.id}
                      onClick={() => void onReveal(row)}
                      title={!canActOnRow(row) ? t('actionBlockedHint') : undefined}
                      type="button"
                    >
                      {revealActionFor(row)}
                    </button>
                    <button
                      aria-label={t('copyAlias', { alias: row.alias })}
                      disabled={!canActOnRow(row) || busyRow === row.id}
                      onClick={() => void onCopy(row)}
                      title={!canActOnRow(row) ? t('actionBlockedHint') : undefined}
                      type="button"
                    >
                      {t('copy')}
                    </button>
                    <button
                      aria-label={t('editAlias', { alias: row.alias })}
                      disabled={!canActOnRow(row) || busyRow === row.id}
                      onClick={() => openDialog({ mode: 'edit', row })}
                      type="button"
                    >
                      {t('edit')}
                    </button>
                    <button
                      aria-label={t('removeAlias', { alias: row.alias })}
                      disabled={!canActOnRow(row) || busyRow === row.id}
                      onClick={() => openDialog({ mode: 'remove', row })}
                      type="button"
                    >
                      {t('remove')}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && filteredRows.length === 0 && (
              <tr>
                <td className={styles.empty} colSpan={4}>
                  {rows.length === 0 ? t('noAliases') : t('noMatchingAliases')}
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td className={styles.empty} colSpan={4}>
                  {t('loadingMetadata')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pickerOpen && (
        <ProjectFolderPicker
          directoryPicker={props.directoryPicker}
          machineName={machineName}
          onClose={() => setPickerOpen(false)}
          onRegisterWorkspace={async canonicalPath => {
            const workspace = await props.registerWorkspace(canonicalPath)
            return { workspaceId: workspace.workspaceId, title: workspace.title, canonicalPath: workspace.canonicalPath }
          }}
          onSelect={selectFolder}
          projects={projects}
          title={t('chooseProjectFolderTitle')}
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
          t={t}
        />
      )}
    </main>
  )
}
