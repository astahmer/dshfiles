import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@dshfiles/plugin-ui/components/ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { FolderOpenIcon, RefreshCwIcon, SearchIcon } from '@dshfiles/plugin-ui/icons'
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
import { nextSecretRevealStage, type SecretRevealStage } from './secret-reveal-model.js'
import { secretCatalogApi } from './api.js'
import type { SecretCatalogTranslate } from './locales.js'
import type { SecretMetadata } from './secret-metadata.js'
import { SecretCatalogTable } from './secret-catalog-table.js'

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
    <TooltipProvider>
      <main className="dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:overflow-y-auto dshx:bg-background">
        <header className="dshx:flex dshx:flex-wrap dshx:items-start dshx:justify-between dshx:gap-4 dshx:border-b dshx:px-6 dshx:pt-5 dshx:pb-4">
          <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
            <div className="dshx:flex dshx:items-center dshx:gap-2">
              <h1 className="dshx:text-xl dshx:font-semibold">{t('title')}</h1>
              <Badge variant="muted">{t('aliasCount', { count: rows.length })}</Badge>
            </div>
            <p className="dshx:text-sm dshx:text-muted-foreground">{t('subtitle')}</p>
          </div>
          <div className="dshx:flex dshx:items-center dshx:gap-2">
            <Button
              disabled={loading}
              onClick={() => {
                clearRevealed()
                setRefreshGeneration(value => value + 1)
              }}
              type="button"
              variant="outline"
            >
              <RefreshCwIcon aria-hidden className={loading ? 'dshx:animate-spin' : undefined} />
              {t('refresh')}
            </Button>
            <Button onClick={() => openDialog({ mode: 'create' })} type="button">
              {t('addSecret')}
            </Button>
          </div>
        </header>
        <section aria-label={t('catalogFilters')} className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:border-b dshx:px-6 dshx:py-3">
          <Select disabled onValueChange={setMachineName} value={displayedMachineName}>
            <SelectTrigger aria-label={t('machine')} className="dshx:w-56" title={t('machineSelectorHint')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={displayedMachineName}>{displayedMachineName}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            className="dshx:min-w-48 dshx:flex-1 dshx:justify-start dshx:bg-muted/50 dshx:font-normal"
            onClick={() => setPickerOpen(true)}
            type="button"
            variant="outline"
          >
            <FolderOpenIcon aria-hidden className="dshx:text-muted-foreground" />
            {selection === null ? (
              <span className="dshx:text-muted-foreground">{t('chooseProjectFolder')}</span>
            ) : (
              <span className="dshx:truncate">
                {selection.title} <span className="dshx:font-mono dshx:text-xs dshx:text-muted-foreground">· {selection.canonicalPath}</span>
              </span>
            )}
          </Button>
          <ToggleGroup
            aria-label={t('secretScope')}
            onValueChange={value => {
              const next = scopes.find(candidate => candidate === value)
              if (next === undefined) return
              clearRevealed()
              setScope(next)
            }}
            size="sm"
            type="single"
            value={scope}
          >
            {scopes.map(value => (
              <ToggleGroupItem className="dshx:capitalize" key={value} value={value}>
                {t(scopeLabelKeys[value])}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </section>
        <div className="dshx:flex dshx:flex-col dshx:gap-3 dshx:px-6 dshx:py-4">
          {cwd === null && (
            <Alert role="status" variant="info">
              <AlertDescription>{t('globalOnlyNotice')}</AlertDescription>
            </Alert>
          )}
          <InputGroup className="dshx:h-9 dshx:bg-muted/50">
            <InputGroupAddon>
              <SearchIcon aria-hidden />
            </InputGroupAddon>
            <InputGroupInput
              aria-label={t('filterAliases')}
              onChange={event => {
                clearRevealed()
                setSearch(event.currentTarget.value)
              }}
              placeholder={t('filterPlaceholder')}
              value={search}
            />
          </InputGroup>
          {error !== null && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {notice !== null && (
            <Alert role="status" variant="success">
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          )}
          <SecretCatalogTable
            actions={{
              t,
              revealed,
              canActOnRow,
              isRowBusy: row => busyRow === row.id,
              onReveal: row => void onReveal(row),
              onCopy: row => void onCopy(row),
              onEdit: row => openDialog({ mode: 'edit', row }),
              onRemove: row => openDialog({ mode: 'remove', row }),
            }}
            hasAnyRows={rows.length > 0}
            loading={loading}
            rows={filteredRows}
          />
        </div>
        {pickerOpen && (
          <ProjectFolderPicker
            directoryPicker={props.directoryPicker}
            machineName={displayedMachineName}
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
    </TooltipProvider>
  )
}
