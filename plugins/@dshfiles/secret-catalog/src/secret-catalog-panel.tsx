import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@dshfiles/plugin-ui/components/ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { FolderOpenIcon, RefreshCwIcon, SearchIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { useApi, useSettings } from '@dshfiles/dshx/client'
import type { KeyboardEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ProjectFolderPicker, type DirectoryPickerPort, type ProjectFolderSelection, type RegisteredProject } from '@dshfiles/project-folder-picker'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { SecretMutationDialog } from './secret-mutation-dialog.js'
import type { SecretCreateForm, SecretMutationScope, SecretRemoveTarget, SecretUpdateForm } from './secret-mutation-form.js'
import { createSecretActionPolicy, filterSecretMetadata, nextRowIndex, type SecretScopeFilter } from './secret-catalog-model.js'
import { secretCatalogSettings } from './settings.js'
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

const focusRowFromKey = (event: KeyboardEvent<HTMLDivElement>): void => {
  if (!(event.target instanceof HTMLElement)) return
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
  const getSnapshot =
    workspaceSource === undefined ? emptyWorkspaceSnapshot : (): ReturnType<NonNullable<IWorkspaces['list']>['getSnapshot']> => workspaceSource.getSnapshot()
  const workspaceSnapshot = useSyncExternalStore(subscribe, getSnapshot, emptyWorkspaceSnapshot)
  const [selection, setSelection] = useState<ProjectFolderSelection | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [scope, setScope] = useState<SecretScopeFilter>('all')
  const [search, setSearch] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<{ readonly id: string; readonly value: string; readonly stage: SecretRevealStage } | null>(null)
  const [busyRow, setBusyRow] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dialog, setDialog] = useState<ActiveDialog | null>(null)
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
  const error = actionError ?? (listQuery.isError && !listQuery.isFetching ? t('loadFailed') : null)
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
      const nextStage = nextSecretRevealStage(revealed.stage)
      if (nextStage === null) clearRevealed()
      else setRevealed({ ...revealed, stage: nextStage })
      return
    }
    clearRevealed()
    const generation = ++revealGeneration.current
    setBusyRow(row.id)
    setActionError(null)
    try {
      const value = await api.reveal({ alias: row.alias, cwd, scope: rowScope, environment: row.environment })
      if (generation !== revealGeneration.current || (hideOnBlur && document.visibilityState === 'hidden')) return
      setRevealed({ id: row.id, value, stage: 'preview' })
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
    setBusyRow(row.id)
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
      <main className="dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:overflow-hidden dshx:bg-background">
        <header className="dshx:flex dshx:shrink-0 dshx:flex-wrap dshx:items-start dshx:justify-between dshx:gap-4 dshx:border-b dshx:px-6 dshx:pt-5 dshx:pb-4">
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
                setActionError(null)
                void listQuery.refetch()
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
        <section
          aria-label={t('catalogFilters')}
          className="dshx:flex dshx:shrink-0 dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:border-b dshx:px-6 dshx:py-3"
        >
          <Select disabled value={displayedMachineName}>
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
        <div className="dshx:flex dshx:shrink-0 dshx:flex-col dshx:gap-3 dshx:px-6 dshx:pt-4 dshx:pb-3">
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
        <div className="dshx:min-h-0 dshx:flex-1 dshx:overflow-auto dshx:px-6 dshx:pb-6" onKeyDown={focusRowFromKey}>
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
            defaultEnvironment={defaultEnvironment}
            initialCreateScope={scope === 'all' ? (cwd === null ? 'global' : 'project') : scope}
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
            t={t}
          />
        )}
      </main>
    </TooltipProvider>
  )
}
