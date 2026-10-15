import type { IWorkspaces, WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@dshfiles/plugin-ui/components/ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ChevronDownIcon, FolderOpenIcon, PlusIcon, RefreshCwIcon, SearchIcon, SlidersHorizontalIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { useApi, useSettings } from '@dshfiles/dshx/client'
import type { KeyboardEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ProjectFolderPicker, type DirectoryPickerPort, type ProjectFolderSelection, type RegisteredProject } from '@dshfiles/project-folder-picker'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { SecretMutationDialog } from './secret-mutation-dialog.js'
import { defaultCreateScope, type SecretCreateForm, type SecretMutationScope, type SecretRemoveTarget, type SecretUpdateForm } from './secret-mutation-form.js'
import { createSecretActionPolicy, filterSecretMetadata, nextRowIndex, type SecretScopeFilter } from './secret-catalog-model.js'
import { secretCatalogSettings } from './settings.js'
import { secretCatalogApi } from './api.js'
import type { SecretCatalogTranslate } from './locales.js'
import type { SecretMetadata } from './secret-metadata.js'
import { SecretCatalogTable, type RevealedSecret } from './secret-catalog-table.js'
import { SecretQuickAddRow } from './secret-quick-add-row.js'

interface SecretCatalogPanelProps {
  readonly directoryPicker: DirectoryPickerPort
  readonly workspaces: IWorkspaces
  readonly registerWorkspace: (canonicalPath: string) => Promise<RegisteredProject>
  readonly t: SecretCatalogTranslate
}

const scopes: readonly SecretScopeFilter[] = ['all', 'project', 'global', 'local']

const noopSubscribe = (): (() => void) => () => {}

// One shared value: useSyncExternalStore requires a stable snapshot while no Workspace list is available.
const emptyWorkspaceSnapshot: WorkspaceSnapshot = { items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'pending', error: null }
const readEmptyWorkspaceSnapshot = (): WorkspaceSnapshot => emptyWorkspaceSnapshot

const scopeLabelKeys = {
  all: 'scopeAll',
  project: 'scopeProject',
  global: 'scopeGlobal',
  local: 'scopeLocal',
} satisfies Record<SecretScopeFilter, Parameters<SecretCatalogTranslate>[0]>

const focusRowFromKey = (event: KeyboardEvent<HTMLDivElement>): void => {
  if (!(event.target instanceof HTMLElement) || event.target.closest('input, textarea') !== null) return
  const row = event.target.closest('tbody tr')
  const rows = [...event.currentTarget.querySelectorAll('tbody tr')]
  if (row === null) return
  const next = nextRowIndex(rows.indexOf(row), event.key, rows.length)
  if (next === null) return
  const target = rows[next]?.querySelector('button:not(:disabled)')
  if (!(target instanceof HTMLElement)) return
  event.preventDefault()
  target.focus()
}

const secretListQueryKey = (cwd: string | null): readonly ['secret-catalog', 'list', string | null] => ['secret-catalog', 'list', cwd]
const secretMachineQueryKey = ['secret-catalog', 'machine'] as const

type ActiveDialog = { readonly mode: 'create' } | { readonly mode: 'edit' | 'remove'; readonly row: SecretMetadata }

export const SecretCatalogPanel = (props: SecretCatalogPanelProps): JSX.Element => {
  const api = useApi(secretCatalogApi)
  const t = props.t
  const settings = useSettings(secretCatalogSettings)
  const revealMs = (settings.value?.revealSeconds ?? 15) * 1000
  const hideOnBlur = settings.value?.hideOnBlur ?? true
  const noticeMs = (settings.value?.noticeSeconds ?? 4) * 1000
  const defaultEnvironment = settings.value?.defaultEnvironment ?? 'prod'
  const configuredScope = settings.value?.defaultScope
  const appliedDefaultScope = useRef(false)
  // The store is read here, at render, so a slot that mounts later still sees
  // the live list rather than whatever existed while setup was running.
  // `getSnapshot` reads the model's own cache, so it has to keep its receiver:
  // passed bare it runs with an undefined `this` and throws.
  const workspaceSource = props.workspaces?.list
  const subscribe = workspaceSource === undefined ? noopSubscribe : workspaceSource.subscribe.bind(workspaceSource)
  const getSnapshot = workspaceSource === undefined ? readEmptyWorkspaceSnapshot : (): WorkspaceSnapshot => workspaceSource.getSnapshot()
  const workspaceSnapshot = useSyncExternalStore(subscribe, getSnapshot, readEmptyWorkspaceSnapshot)
  const [selection, setSelection] = useState<ProjectFolderSelection | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [scope, setScope] = useState<SecretScopeFilter>('all')
  const [search, setSearch] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<RevealedSecret | null>(null)
  const [busyRow, setBusyRow] = useState<{ readonly id: string; readonly action: 'reveal' | 'copy' } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dialog, setDialog] = useState<ActiveDialog | null>(null)
  const [draftIds, setDraftIds] = useState<readonly number[]>([])
  const nextDraftId = useRef(0)
  const revealGeneration = useRef(0)
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queryClient = useQueryClient()
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

  const listQuery = useQuery({
    queryKey: secretListQueryKey(cwd),
    queryFn: ({ signal }) => api.list({ cwd }, { signal }),
    placeholderData: keepPreviousData,
  })
  const machineQuery = useQuery({
    queryKey: secretMachineQueryKey,
    queryFn: ({ signal }) => api.machine({}, { signal }),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const rows = listQuery.data ?? []
  const loading = listQuery.isFetching
  const listFailed = listQuery.isError && !listQuery.isFetching
  const showCatalog = !(listFailed && rows.length === 0)
  const error = actionError ?? (listFailed ? t('loadFailed') : null)
  const machineName = machineQuery.data?.name ?? null

  useEffect(() => {
    if (appliedDefaultScope.current || configuredScope === undefined) return
    appliedDefaultScope.current = true
    setScope(configuredScope)
  }, [configuredScope])

  useEffect(() => {
    if (notice === null || noticeMs === 0) return
    const timer = setTimeout(() => setNotice(null), noticeMs)
    return () => clearTimeout(timer)
  }, [notice, noticeMs])

  useEffect(() => {
    if (!hideOnBlur) return
    const clearOnHidden = (): void => {
      if (document.visibilityState === 'hidden') clearRevealed()
    }
    window.addEventListener('blur', clearRevealed)
    document.addEventListener('visibilitychange', clearOnHidden)
    return () => {
      window.removeEventListener('blur', clearRevealed)
      document.removeEventListener('visibilitychange', clearOnHidden)
    }
  }, [clearRevealed, hideOnBlur])

  useEffect(
    () => () => {
      revealGeneration.current += 1
      if (revealTimer.current !== null) clearTimeout(revealTimer.current)
    },
    [],
  )

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
      clearRevealed()
      return
    }
    clearRevealed()
    const generation = ++revealGeneration.current
    setBusyRow({ id: row.id, action: 'reveal' })
    setActionError(null)
    try {
      const value = await api.reveal({ alias: row.alias, cwd, scope: rowScope, environment: row.environment })
      if (generation !== revealGeneration.current || (hideOnBlur && document.visibilityState === 'hidden')) return
      setRevealed({ id: row.id, value })
      revealTimer.current = setTimeout(clearRevealed, revealMs)
    } catch {
      if (generation === revealGeneration.current) setActionError(t('revealFailed'))
    } finally {
      if (generation === revealGeneration.current) setBusyRow(null)
    }
  }

  const onCopy = async (row: SecretMetadata): Promise<void> => {
    if (!canActOnRow(row)) return
    const rowScope = mutationScopeFor(row)
    if (rowScope === null) return
    setBusyRow({ id: row.id, action: 'copy' })
    setNotice(null)
    setActionError(null)
    try {
      await api.copy({ alias: row.alias, cwd, scope: rowScope, environment: row.environment })
      setNotice(t('copied', { alias: row.alias }))
    } catch {
      setActionError(t('copyFailed'))
    } finally {
      setBusyRow(null)
    }
  }

  const afterMutation = async (message: string): Promise<void> => {
    setNotice(message)
    setDialog(null)
    await queryClient.invalidateQueries({ queryKey: ['secret-catalog', 'list'] })
  }
  const createMutation = useMutation({
    mutationFn: (input: SecretCreateForm) => api.create({ ...input, cwd }),
    onMutate: clearRevealed,
    onSuccess: (_result, input) => afterMutation(t('added', { alias: input.alias })),
  })
  const updateMutation = useMutation({
    mutationFn: (input: SecretUpdateForm) => api.update({ ...input, cwd }),
    onMutate: clearRevealed,
    onSuccess: (_result, input) => afterMutation(t('updated', { alias: input.alias })),
  })
  const removeMutation = useMutation({
    mutationFn: async (input: { readonly target: SecretRemoveTarget; readonly row: SecretMetadata; readonly scope: SecretMutationScope }): Promise<void> => {
      if (input.target === 'alias') await api.removeAlias({ alias: input.row.alias, cwd, scope: input.scope })
      if (input.target === 'vault-item') await api.deleteItem({ alias: input.row.alias, cwd, scope: input.scope, environment: input.row.environment })
    },
    onMutate: clearRevealed,
    onSuccess: (_result, input) =>
      afterMutation(input.target === 'alias' ? t('removedAlias', { alias: input.row.alias }) : t('deletedItem', { alias: input.row.alias })),
  })
  const mutationPending = createMutation.isPending || updateMutation.isPending || removeMutation.isPending
  let mutationError: string | null = null
  if (createMutation.isError) mutationError = t('addFailed')
  else if (updateMutation.isError) mutationError = t('updateFailed')
  else if (removeMutation.isError) mutationError = removeMutation.variables.target === 'alias' ? t('removeAliasFailed') : t('deleteItemFailed')
  const resetMutations = (): void => {
    createMutation.reset()
    updateMutation.reset()
    removeMutation.reset()
  }

  const onRemove = (target: SecretRemoveTarget, row: SecretMetadata): void => {
    const rowScope = mutationScopeFor(row)
    if (rowScope === null || !canActOnRow(row)) return
    removeMutation.mutate({ target, row, scope: rowScope })
  }

  const displayedMachineName = machineName ?? t('currentHost')
  const createScope = defaultCreateScope({ filter: scope, hasProjectFolder: cwd !== null })

  const addDraft = (): void => {
    nextDraftId.current += 1
    const id = nextDraftId.current
    setDraftIds(current => [...current, id])
  }
  const removeDraft = (id: number): void => setDraftIds(current => current.filter(candidate => candidate !== id))
  const createFromDraft = async (input: SecretCreateForm): Promise<void> => {
    clearRevealed()
    await api.create({ ...input, cwd })
  }
  const onDraftSaved = async (id: number, alias: string): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['secret-catalog', 'list'] })
    removeDraft(id)
    setNotice(t('added', { alias }))
  }

  const openDialog = (next: ActiveDialog): void => {
    clearRevealed()
    resetMutations()
    setDialog(next)
  }

  const selectFolder = (next: ProjectFolderSelection): void => {
    clearRevealed()
    setActionError(null)
    setSelection(next)
    setPickerOpen(false)
  }

  return (
    <TooltipProvider>
      <main className="dshx-root dshx:@container dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:overflow-hidden dshx:bg-background">
        <header className="dshx:flex dshx:shrink-0 dshx:flex-wrap dshx:items-start dshx:justify-between dshx:gap-4 dshx:border-b dshx:px-6 dshx:pt-5 dshx:pb-4 dshx:@max-pane-narrow:gap-3 dshx:@max-pane-narrow:px-3 dshx:@max-pane-narrow:pt-4">
          <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
            <div className="dshx:flex dshx:items-center dshx:gap-2">
              <h1 className="dshx:text-xl dshx:font-semibold">{t('title')}</h1>
              {showCatalog ? <Badge variant="muted">{t('aliasCount', { count: rows.length })}</Badge> : null}
            </div>
            <p className="dshx:text-sm dshx:text-muted-foreground">{t('subtitle')}</p>
          </div>
          <div className="dshx:flex dshx:items-center dshx:gap-2">
            <Button
              disabled={loading}
              onClick={() => {
                clearRevealed()
                setActionError(null)
                void listQuery.refetch()
              }}
              type="button"
              variant="outline"
            >
              <RefreshCwIcon aria-hidden className={loading ? 'dshx:animate-spin' : undefined} />
              {t('refresh')}
            </Button>
          </div>
        </header>
        <section
          aria-label={t('catalogFilters')}
          className="dshx:flex dshx:shrink-0 dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:border-b dshx:px-6 dshx:py-3 dshx:@max-pane-narrow:px-3"
        >
          <Select disabled value={displayedMachineName}>
            <SelectTrigger aria-label={t('machine')} className="dshx:w-56 dshx:@max-pane-narrow:w-full" title={t('machineSelectorHint')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={displayedMachineName}>{displayedMachineName}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            className="dshx:min-w-48 dshx:flex-1 dshx:justify-start dshx:@max-pane-narrow:min-w-0 dshx:@max-pane-narrow:basis-full dshx:bg-muted/50 dshx:font-normal"
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
        <div className="dshx:flex dshx:shrink-0 dshx:flex-col dshx:gap-3 dshx:px-6 dshx:pt-4 dshx:pb-3 dshx:@max-pane-narrow:px-3">
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
            <Alert className="dshx:pr-24" variant="destructive">
              <AlertDescription>{error}</AlertDescription>
              {listFailed && actionError === null && (
                <Button
                  className="dshx:absolute dshx:top-1/2 dshx:right-2 dshx:-translate-y-1/2"
                  disabled={loading}
                  onClick={() => void listQuery.refetch()}
                  size="xs"
                  type="button"
                  variant="outline"
                >
                  {t('retry')}
                </Button>
              )}
            </Alert>
          )}
          {notice !== null && (
            <Alert className="dshx:pr-10" role="status" variant="success">
              <AlertDescription>{notice}</AlertDescription>
              <Button
                aria-label={t('dismissNotice')}
                className="dshx:absolute dshx:top-1.5 dshx:right-1.5"
                onClick={() => setNotice(null)}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <XIcon aria-hidden />
              </Button>
            </Alert>
          )}
        </div>
        {showCatalog ? (
          <div className="dshx:min-h-0 dshx:flex-1 dshx:overflow-auto dshx:px-6 dshx:pb-6 dshx:@max-pane-narrow:px-3" onKeyDown={focusRowFromKey}>
            <SecretCatalogTable
              actions={{
                t,
                revealed,
                canActOnRow,
                isRowBusy: row => busyRow?.id === row.id,
                isRevealing: row => busyRow?.id === row.id && busyRow.action === 'reveal',
                onReveal: row => void onReveal(row),
                onRevealedBlur: () => {
                  if (hideOnBlur) clearRevealed()
                },
                onHide: clearRevealed,
                onCopy: row => void onCopy(row),
                onEdit: row => openDialog({ mode: 'edit', row }),
                onRemove: row => openDialog({ mode: 'remove', row }),
              }}
              append={
                draftIds.length === 0
                  ? undefined
                  : draftIds.map(id => (
                      <SecretQuickAddRow
                        create={createFromDraft}
                        environment={defaultEnvironment}
                        hasProjectFolder={cwd !== null}
                        key={id}
                        onDiscard={() => removeDraft(id)}
                        onSaved={alias => onDraftSaved(id, alias)}
                        rows={rows}
                        scope={createScope}
                        t={t}
                      />
                    ))
              }
              hasAnyRows={rows.length > 0}
              loading={loading}
              rows={filteredRows}
            />
            <div className="dshx:mt-3 dshx:inline-flex dshx:rounded-md dshx:shadow-xs">
              <Button
                className="dshx:rounded-r-none dshx:shadow-none"
                disabled={loading && rows.length === 0}
                onClick={addDraft}
                size="sm"
                type="button"
                variant="outline"
              >
                <PlusIcon aria-hidden />
                {t('addSecret')}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-label={t('moreWaysToAdd')}
                    className="dshx:rounded-l-none dshx:border-l-0 dshx:shadow-none"
                    size="icon-sm"
                    type="button"
                    variant="outline"
                  >
                    <ChevronDownIcon aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="dshx-root">
                  <DropdownMenuItem onSelect={() => openDialog({ mode: 'create' })}>
                    <SlidersHorizontalIcon aria-hidden />
                    {t('addWithDetails')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ) : null}
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
            defaultEnvironment={defaultEnvironment}
            initialCreateScope={createScope}
            mode={dialog.mode}
            onClose={() => {
              setDialog(null)
              resetMutations()
            }}
            onCreate={input => createMutation.mutate(input)}
            onRemove={onRemove}
            onUpdate={input => updateMutation.mutate(input)}
            pending={mutationPending}
            row={'row' in dialog ? dialog.row : undefined}
            rows={rows}
            t={t}
          />
        )}
      </main>
    </TooltipProvider>
  )
}
