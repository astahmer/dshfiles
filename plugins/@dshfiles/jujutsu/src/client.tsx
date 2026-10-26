import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { relativeTime, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@dshfiles/plugin-ui/components/ui/collapsible'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { Empty, EmptyHeader, EmptyTitle } from '@dshfiles/plugin-ui/components/ui/empty'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@dshfiles/plugin-ui/components/ui/input-group'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dshfiles/plugin-ui/components/ui/tabs'
import { Textarea } from '@dshfiles/plugin-ui/components/ui/textarea'
import { Toggle } from '@dshfiles/plugin-ui/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import {
  ArrowDownIcon,
  CalendarIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyPlusIcon,
  EllipsisVerticalIcon,
  FolderGit2Icon,
  MonitorIcon,
  RefreshCwIcon,
  SearchIcon,
  Settings2Icon,
  UserIcon,
} from '@dshfiles/plugin-ui/icons'
import { PatchView, type PatchLayout } from '@dshfiles/plugin-ui/diff'
import { defaultRangeExtractor, useVirtualizer } from '@dshfiles/plugin-ui/virtual'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useMachine } from '@dshfiles/plugin-ui/machine'
import { errorMessage, keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { ProjectFolderPicker, type DirectoryPickerPort, type RegisteredProject } from '@dshfiles/project-folder-picker'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import { z } from 'zod'
import type { GraphLandmark, Mutation, ReadFailure, Revision } from './api.js'
import { ChatReferenceModel } from './chat-reference.js'
import { ChangedFiles, FileViewToggle, LineCounts } from './changed-files.js'
import { RevisionGraphModel, reverseHexChangeId, type RevisionGraphRow } from './graph.js'
import { GraphPagingModel } from './graph-paging.js'
import { jujutsuApi } from './api.js'
import { useAutoRefresh } from './auto-refresh.js'
import { openInEditor } from './open-in-editor.js'
import { activeDayIndex, flattenRevisionGroups, remoteBookmarkRevision } from './revision-list.js'
import { revisionActionMachine, type ActionPreview, type DropPresentation, type DragOrigin } from './revision-action-machine.js'
import { BOOKMARK_MIME, BOOKMARK_SOURCE_MIME, resolveBookmarkDrop, resolveRevisionDrop, REVISION_MIME } from './revision-drop.js'
import { repositoryLoadingState, shouldReregisterRepository } from './repository-loading.js'
import { JUJUTSU_QUERY_GC_TIME, JUJUTSU_QUERY_STALE_TIME, jujutsuQueryKeys } from './repository-query-cache.js'
import { GRAPH_DENSITY, GraphLanes, graphWidthFor, RevisionGraphCell, type GraphMetrics } from './revision-graph-cell.js'
import { ANCESTOR_COUNT_OPTIONS, usePreferences, type RevisionDate } from './preferences.js'
import { jujutsuReviewProgressApi, type ReviewProgressSnapshot, type ReviewProgressToggle } from './review-progress-api.js'
import { MAX_REVIEW_STORE_BYTES, ReviewProgressModel, reviewStoreSchema, type ReviewChange, type ReviewStore } from './review-progress.js'
import { ReviewProgressMigration, type ReviewProgressMigrationClient } from './review-progress-migration-machine.js'
import { latestReviewProgressSnapshot } from './review-progress-queries.js'
import { descendantCommitIds, emptyAncestorCandidates } from './source-control.js'
import { SourceControlView } from './source-control-view.js'
import { InlineActionConfirm } from './inline-action-confirm.js'
import { InlineBookmarkSet } from './inline-bookmark-set.js'
import { InlineRevisionDiff } from './inline-revision-diff.js'
import { InlineWorkspaceProvisioner } from './inline-workspace-provisioner.js'
import { InlineWorkspaceRemoval } from './inline-workspace-removal.js'
import { WorkspaceCleanupDialog } from './workspace-cleanup-dialog.js'
import { WorkspaceCleanupTrail } from './workspace-cleanup-trail.js'
import { DEFAULT_PANEL_SCOPE, PanelScopes, usePanelScopeState } from './panel-scope.js'
import { containsPath, sidePanelRepository } from './side-panel-repository.js'
import { filterGraphRevisions, mergeGraphRevisions } from './graph-navigation.js'
import { GraphRowAnchorModel, type GraphRowAnchor } from './graph-row-anchor.js'
import { GraphViewStatus, LandmarkControls, RelationshipInspector } from './graph-navigation-controls.js'
import { useGraphNavigation } from './use-graph-navigation.js'

type View = 'graph' | 'source'

interface RevisionSelection {
  readonly commitId: string
  readonly changeId: string
}

interface FullDiffTarget {
  readonly commitId: string
  readonly title: string
  readonly focusPath: string | null
}

interface JujutsuPanelProps {
  /** `side-panel` is the narrow per-thread surface; `dock` is the global dock, laid out like the main page. */
  readonly surface?: 'main' | 'side-panel' | 'dock'
  /** Which context this panel serves: one main tab, one thread's side panel, or the global dock. State is kept per scope. */
  readonly scope: string
  /** The repository to open when this scope remembers none (a thread's own project). */
  readonly defaultPath?: string | null
  readonly projects: readonly RegisteredProject[]
  readonly directoryPicker: DirectoryPickerPort
  readonly registerWorkspace: (canonicalPath: string) => Promise<RegisteredProject>
  readonly launchSession: (cwd: string) => Promise<void>
}

const REPO_HISTORY_KEY = 'dshfiles.jujutsu.repositories'
const SELECTED_REPO_KEY = 'dshfiles.jujutsu.selected'
const REVIEW_PROGRESS_KEY = 'dshfiles.jujutsu.review-progress.v1'
const REVIEW_PROGRESS_MIGRATED_KEY = 'dshfiles.jujutsu.review-progress.migrated'
const REPO_HISTORY_LIMIT = 12

const CODE_BLOCK =
  'dshx:max-h-80 dshx:overflow-auto dshx:rounded-md dshx:border dshx:bg-muted/40 dshx:p-2 dshx:font-mono dshx:text-[11px] dshx:leading-snug dshx:whitespace-pre'
const DISCLOSURE_TRIGGER =
  'dshx:group/disclosure dshx:flex dshx:items-center dshx:gap-1 dshx:py-1 dshx:text-[11px] dshx:font-semibold dshx:uppercase dshx:tracking-wide dshx:text-muted-foreground dshx:hover:text-foreground'

const COMPACT_BADGE = 'dshx:h-4 dshx:max-w-40 dshx:rounded-sm dshx:px-1.5 dshx:py-0 dshx:font-mono dshx:text-[10px] dshx:leading-none'

const storedRepoHistory = createStoredValue({ key: REPO_HISTORY_KEY, schema: z.array(z.string()), fallback: [] })
const storedRepoPath = createStoredValue({ key: SELECTED_REPO_KEY, schema: z.string(), fallback: '' })

const REPOSITORY_ID_LIMIT = 32
const INITIAL_GRAPH_PAGE_SIZE = 100
const EMPTY_REVISIONS: readonly Revision[] = []
const REPOSITORY_QUERY_CACHE = { staleTime: JUJUTSU_QUERY_STALE_TIME, gcTime: JUJUTSU_QUERY_GC_TIME }

const throwReadFailure = <Output extends object>(result: Output | ReadFailure): Output => {
  if ('failure' in result) throw new Error(result.failure.message)
  return result
}

const emptyReviewStore: ReviewStore = { schemaVersion: 1, marks: [] }

const reviewStoreStorage = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null => {
  try {
    const storage = globalThis.localStorage
    return {
      getItem: key => {
        const value = storage.getItem(key)
        return value !== null && new TextEncoder().encode(value).byteLength > MAX_REVIEW_STORE_BYTES ? null : value
      },
      setItem: (key, value) => {
        if (new TextEncoder().encode(value).byteLength > MAX_REVIEW_STORE_BYTES) throw new Error('Review progress exceeds the browser storage bound.')
        storage.setItem(key, value)
      },
      removeItem: key => storage.removeItem(key),
    }
  } catch {
    return null
  }
}

const storedReviewProgress = createStoredValue({
  key: REVIEW_PROGRESS_KEY,
  schema: reviewStoreSchema,
  fallback: emptyReviewStore,
  storage: reviewStoreStorage,
})

const storedReviewMigration = createStoredValue({ key: REVIEW_PROGRESS_MIGRATED_KEY, schema: z.literal(1), fallback: 0 })

const writeLocalReviewStore = (store: ReviewStore): boolean => {
  const saved = storedReviewProgress.set(store)
  if (!saved) storedReviewProgress.reload()
  return saved
}

const applyLocalReviewChanges = (input: {
  readonly store: ReviewStore
  readonly changes: readonly ReviewChange[]
  readonly repositoryRoot: string
  readonly commitId: string
}): ReviewStore => ReviewProgressModel.apply({ ...input, reviewedAt: new Date().toISOString() })

const RELATIVE_TIME_SUFFIX = { now: '', minutes: 'm', hours: 'h', days: 'd', months: 'mo', years: 'y' } as const

const formatAge = (value: string): string => {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return 'unknown time'
  const age = relativeTime(time, Date.now())
  return age.unit === 'now' ? 'now' : `${age.n}${RELATIVE_TIME_SUFFIX[age.unit]}`
}

const dayLabel = (value: string): string => {
  const time = Date.parse(value)
  return Number.isFinite(time)
    ? new Date(time).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
    : 'Date unavailable'
}

const revisionDates = (revision: Revision, editedAt: string | undefined): string =>
  [
    `Created ${new Date(revision.authorTime).toLocaleString()}`,
    ...(editedAt === undefined ? [] : [`Last edited ${new Date(editedAt).toLocaleString()}`]),
    ...(revision.committerTime === undefined ? [] : [`Last rewritten ${new Date(revision.committerTime).toLocaleString()}`]),
  ].join('\n')

const EDIT_TIMES_PAGE_SIZE = 100

const editTimesByCommitId = (
  results: readonly { readonly data: { readonly revisions: readonly { readonly commitId: string; readonly editedAt: string | null }[] } | undefined }[],
): ReadonlyMap<string, string> =>
  new Map(results.flatMap(result => result.data?.revisions.flatMap(row => (row.editedAt === null ? [] : [[row.commitId, row.editedAt] as const])) ?? []))

/** Consecutive runs of one day, so headings never reorder the graph rows they sit between. */
const groupRows = (revisions: readonly Revision[], byDay: boolean): readonly { readonly day: string; readonly rows: readonly Revision[] }[] => {
  if (!byDay) return [{ day: '', rows: revisions }]
  const groups: { day: string; rows: Revision[] }[] = []
  for (const revision of revisions) {
    const day = dayLabel(revision.committerTime ?? revision.authorTime)
    const current = groups.at(-1)
    if (current?.day === day) current.rows.push(revision)
    else groups.push({ day, rows: [revision] })
  }
  return groups
}

const firstLine = (description: string): string => description.split('\n')[0] || '(no description)'

const editableDescription = (description: string): string => description.replace(/\n+$/, '')

const repositoryName = (root: string): string => root.split('/').filter(Boolean).at(-1) ?? root

const hasDragType = (event: DragEvent, type: string): boolean => [...event.dataTransfer.types].includes(type)

export const JujutsuPanel = (props: JujutsuPanelProps): JSX.Element => {
  const sidePanel = props.surface === 'side-panel'
  const api = useApi(jujutsuApi)
  const queryClient = useQueryClient()
  const [preferences, setPreference] = usePreferences()
  const diffLayout: PatchLayout =
    preferences.diffLayout !== 'auto' ? preferences.diffLayout : !sidePanel && window.matchMedia('(min-width: 1100px)').matches ? 'split' : 'unified'
  const autoRegisterPath = useRef<string | null>(null)
  const recoveredRepositoryPath = useRef<string | null>(null)
  const repositoryRootsById = useRef(new Map<string, string>())
  const scope = props.scope
  const [initialRequest] = useState(() => {
    const pending = sidePanel ? sidePanelRepository.takePending() : null
    // A request made before this panel mounted (a chat reference) wins over what the scope remembered.
    if (pending !== null) PanelScopes.rememberPath(scope, pending.path)
    return pending
  })
  const [path, setPath] = usePanelScopeState(
    scope,
    'path',
    () =>
      initialRequest?.path ??
      PanelScopes.initialPath({
        scope,
        defaultPath: props.defaultPath ?? null,
        legacyPath: storedRepoPath.get(),
        registeredPaths: props.projects.map(project => project.canonicalPath),
      }),
  )
  const [pendingReferenceRequest, setPendingReferenceRequest] = useState(initialRequest?.reference ?? null)
  const [repoId, setRepoId] = useState<string | null>(null)
  const [repoHistory, setRepoHistory] = useState(() => storedRepoHistory.get().slice(0, REPO_HISTORY_LIMIT))
  const [pickerOpen, setPickerOpen] = useState(false)
  const [chosenView, setView] = usePanelScopeState<View | null>(scope, 'view', () => PanelScopes.persisted(scope).view ?? null)
  const view = chosenView ?? preferences.defaultView
  const [authorFilter, setAuthorFilter] = usePanelScopeState(scope, 'authorFilter', () => '')
  const [textFilter, setTextFilter] = usePanelScopeState(scope, 'textFilter', () => '')
  const [fromDate, setFromDate] = usePanelScopeState(scope, 'fromDate', () => '')
  const [toDate, setToDate] = usePanelScopeState(scope, 'toDate', () => '')
  const [showSearch, setShowSearch] = usePanelScopeState(scope, 'showSearch', () => !sidePanel)
  const [showDates, setShowDates] = usePanelScopeState(scope, 'showDates', () => false)
  const [collapsedDays, setCollapsedDays] = usePanelScopeState<ReadonlySet<string>>(scope, 'collapsedDays', () => new Set())
  const [selection, setSelection] = usePanelScopeState<RevisionSelection | null>(scope, 'selection', () => null)
  const [comparisonSelection, setComparisonSelection] = usePanelScopeState<RevisionSelection | null>(scope, 'comparisonSelection', () => null)
  useEffect(() => {
    const selectedPath = path.trim()
    if (selectedPath.length > 0) PanelScopes.remember(scope, { path: selectedPath })
  }, [scope, path])
  useEffect(() => {
    if (chosenView !== null) PanelScopes.remember(scope, { view: chosenView })
  }, [scope, chosenView])
  const [editingDescription, setEditingDescription] = useState<string | null>(null)
  const reviewApi = useApi(jujutsuReviewProgressApi)
  const reviewQuery = useQuery({
    queryKey: jujutsuQueryKeys.reviewProgress(),
    queryFn: async ({ signal, client }) => {
      const snapshot = await reviewApi.state(undefined, { signal })
      return latestReviewProgressSnapshot(client.getQueryData<ReviewProgressSnapshot>(jujutsuQueryKeys.reviewProgress()), snapshot)
    },
    retry: false,
    staleTime: JUJUTSU_QUERY_STALE_TIME,
    gcTime: JUJUTSU_QUERY_GC_TIME,
    refetchOnWindowFocus: false,
  })
  const localReviewStore = storedReviewProgress.useValue()
  const reviewMigrationDone = storedReviewMigration.useValue() === 1
  const reviewStore = reviewQuery.data?.store ?? localReviewStore
  const [hideReviewedFiles, setHideReviewedFiles] = usePanelScopeState(scope, 'hideReviewedFiles', () => false)
  const [reviewNotice, setReviewNotice] = useState('')

  const adoptReviewSnapshot = useCallback(
    (snapshot: ReviewProgressSnapshot): ReviewProgressSnapshot => {
      return (
        queryClient.setQueryData<ReviewProgressSnapshot>(jujutsuQueryKeys.reviewProgress(), current => latestReviewProgressSnapshot(current, snapshot)) ??
        snapshot
      )
    },
    [queryClient],
  )

  const reviewMigrationClient = useMemo<ReviewProgressMigrationClient>(
    () => ({
      toggle: (toggle, options) => reviewApi.toggle(toggle, options),
      adoptSnapshot: adoptReviewSnapshot,
      completeMigration: snapshot => {
        const latest = adoptReviewSnapshot(snapshot)
        if (storedReviewMigration.get() !== 1) storedReviewMigration.set(1)
        writeLocalReviewStore(latest.store)
      },
    }),
    [adoptReviewSnapshot, reviewApi],
  )
  useEffect(() => ReviewProgressMigration.retain(), [])

  useEffect(() => {
    const snapshot = reviewQuery.data
    if (snapshot === undefined || reviewMigrationDone) return
    ReviewProgressMigration.dispatch({ client: reviewMigrationClient, snapshot, localStore: localReviewStore, migrationDone: false })
  }, [localReviewStore, reviewMigrationClient, reviewMigrationDone, reviewQuery.data])

  useEffect(() => {
    const snapshot = reviewQuery.data
    if (snapshot === undefined || !reviewMigrationDone) return
    ReviewProgressMigration.dispatch({ client: reviewMigrationClient, snapshot, localStore: emptyReviewStore, migrationDone: true })
  }, [reviewMigrationClient, reviewMigrationDone, reviewQuery.data])

  const reviewMutation = useMutation({
    mutationFn: async (input: { readonly toggles: readonly ReviewProgressToggle[]; readonly successNotice: string }) => {
      // The Host API is per-file, and applying each returned snapshot preserves its monotone revision.
      for (const toggle of input.toggles) adoptReviewSnapshot(await reviewApi.toggle(toggle))
      return input.successNotice
    },
    onSuccess: successNotice => setReviewNotice(successNotice),
    onError: () => setReviewNotice('Review progress could not be saved to the Host.'),
  })
  const [describeDrafts, setDescribeDrafts] = useState<Readonly<Record<string, string>>>({})
  const [remote, setRemote] = useState('')
  const [bookmark, setBookmark] = useState('')
  const [provisionedPath, setProvisionedPath] = useState<string | null>(null)
  const [workspaceBase, setWorkspaceBase] = useState<Revision | null>(null)
  const [workspaceRemoval, setWorkspaceRemoval] = useState<{ readonly commitId: string; readonly name: string } | null>(null)
  const [fullDiff, setFullDiff] = useState<FullDiffTarget | null>(null)
  const [bookmarkDraft, setBookmarkDraft] = useState<{ readonly commitId: string } | null>(null)
  const [cleanupOpen, setCleanupOpen] = useState(false)
  const [moveSource, setMoveSource] = useState<Revision | null>(null)
  const [copyNotice, setCopyNotice] = useState<{ readonly copied: boolean; readonly label: string } | null>(null)
  const mineOnly = preferences.mineOnly
  const hideImmutable = preferences.hideImmutable

  const [actionSnapshot, sendAction, actionActor] = useMachine(revisionActionMachine, { input: { client: api } })
  const preview = actionSnapshot.matches('previewing') ? (actionSnapshot.context.preview ?? undefined) : undefined
  const confirmResult = actionSnapshot.context.result
  const actionBusy = actionSnapshot.hasTag('busy')
  const { dragOrigin, dropTarget, dropPresentation } = actionSnapshot.context
  const dragSource = dragOrigin?.kind === 'revision' ? dragOrigin.sourceId : null

  useEffect(() => {
    const confirmed = actionActor.on('confirmed', event => {
      if (event.workspacePath !== null) setProvisionedPath(event.workspacePath)
    })
    const settled = actionActor.on('settled', event => {
      const root = repositoryRootsById.current.get(event.repoId)
      if (root !== undefined) void queryClient.invalidateQueries({ queryKey: jujutsuQueryKeys.repository(root) })
    })
    return () => {
      confirmed.unsubscribe()
      settled.unsubscribe()
    }
  }, [actionActor, queryClient])

  const launchMutation = useMutation({ mutationFn: (cwd: string) => props.launchSession(cwd) })

  const registerMutation = useMutation({
    mutationFn: (repositoryPath: string) => api.registerRepository({ path: repositoryPath }),
    onSuccess: registered => {
      repositoryRootsById.current.set(registered.repoId, registered.root)
      while (repositoryRootsById.current.size > REPOSITORY_ID_LIMIT) {
        const oldestRepoId = repositoryRootsById.current.keys().next().value
        if (oldestRepoId === undefined) break
        repositoryRootsById.current.delete(oldestRepoId)
      }
      sendAction({ type: 'reset' })
      setProvisionedPath(null)
      setWorkspaceBase(null)
      setRepoId(registered.repoId)
      setPath(registered.root)
      setSelection(null)
      setComparisonSelection(null)
      setMoveSource(null)
      setWorkspaceRemoval(null)
      setDescribeDrafts({})
      setFullDiff(null)
      const nextHistory = [registered.root, ...repoHistory.filter(item => item !== registered.root)].slice(0, REPO_HISTORY_LIMIT)
      setRepoHistory(nextHistory)
      storedRepoHistory.set(nextHistory)
      PanelScopes.remember(scope, { path: registered.root })
      if (scope === DEFAULT_PANEL_SCOPE) storedRepoPath.set(registered.root)
      void queryClient.invalidateQueries({ queryKey: jujutsuQueryKeys.repository(registered.root) })
    },
  })
  const { mutate: registerRepository, reset: resetRegistration } = registerMutation

  const autoRefresh = useAutoRefresh({
    preferences,
    paused: registerMutation.isPending || actionBusy || preview !== undefined,
    onBecameVisible: () => {
      if (repoId !== null) void queryClient.invalidateQueries({ queryKey: jujutsuQueryKeys.repository(path) })
    },
  })

  const stateQuery = useQuery({
    queryKey: jujutsuQueryKeys.state(path, INITIAL_GRAPH_PAGE_SIZE),
    queryFn: async ({ signal }) => throwReadFailure(await api.load({ repoId: repoId ?? '', limit: INITIAL_GRAPH_PAGE_SIZE }, { signal })),
    ...REPOSITORY_QUERY_CACHE,
    enabled: repoId !== null,
    ...autoRefresh.queryOptions,
  })
  const state = stateQuery.data
  useEffect(() => {
    if (!shouldReregisterRepository({ hasError: stateQuery.error !== null, repoId, path, recoveredPath: recoveredRepositoryPath.current })) return
    recoveredRepositoryPath.current = path
    resetRegistration()
    registerRepository(path)
  }, [path, registerRepository, resetRegistration, repoId, stateQuery.error])
  useEffect(() => {
    if (state !== undefined) recoveredRepositoryPath.current = null
  }, [state])
  const debouncedSearch = useDebouncedValue({ value: textFilter.trim(), delayMs: 250 })
  const debouncedSearchRef = useRef(debouncedSearch)
  debouncedSearchRef.current = debouncedSearch
  const [graphPageState, setGraphPageState] = useState<{
    readonly repoId: string | null
    readonly query: string
    readonly revisions: readonly Revision[]
    readonly hasMore: boolean
  }>({ repoId: null, query: '', revisions: [], hasMore: false })
  const graphPageMutation = useMutation({
    mutationFn: async (input: { readonly repoId: string; readonly query: string; readonly excludeCommitIds: readonly string[] }) =>
      throwReadFailure(await api.graphPage({ ...input, excludeCommitIds: [...input.excludeCommitIds] }, {})),
    onSuccess: (page, input) => {
      if (input.repoId !== repoId || input.query !== debouncedSearchRef.current) return
      setGraphPageState(current => {
        const samePageSet = current.repoId === input.repoId && current.query === input.query
        const loaded = samePageSet ? current.revisions : []
        const seen = new Set(loaded.map(revision => revision.commitId))
        return {
          repoId: input.repoId,
          query: input.query,
          // Two triggers can overlap on one page; a revision already loaded is appended only once.
          revisions: [...loaded, ...page.revisions.filter(revision => !seen.has(revision.commitId))],
          hasMore: page.hasMore,
        }
      })
    },
  })
  const { isPending: graphPagePending, mutate: requestGraphPage } = graphPageMutation
  useEffect(() => {
    setGraphPageState({ repoId, query: debouncedSearch, revisions: [], hasMore: debouncedSearch.length > 0 || (state?.graphHasMore ?? false) })
    if (repoId !== null && debouncedSearch.length > 0) requestGraphPage({ repoId, query: debouncedSearch, excludeCommitIds: [] })
  }, [repoId, debouncedSearch, state?.graphHasMore, requestGraphPage])

  const graphPageIsCurrent = graphPageState.repoId === repoId && graphPageState.query === debouncedSearch
  const graphPageRevisions = useMemo(() => (graphPageIsCurrent ? graphPageState.revisions : EMPTY_REVISIONS), [graphPageIsCurrent, graphPageState.revisions])
  // Older history arrives page by page, and those rows are selectable too: selection resolves against every loaded
  // revision, not just the first page the repository query returned.
  const graphRowsInput = useMemo(
    () => (debouncedSearch.length > 0 ? graphPageRevisions : [...(state?.revisions ?? []), ...graphPageRevisions]),
    [debouncedSearch, graphPageRevisions, state?.revisions],
  )
  const navigation = useGraphNavigation({
    repoId,
    root: path,
    refreshedAt: stateQuery.dataUpdatedAt,
    selected: selection ?? undefined,
    comparison: comparisonSelection ?? undefined,
    revisions: graphRowsInput,
  })
  const allRevisions = useMemo(() => mergeGraphRevisions(navigation.extraRevisions, graphRowsInput), [navigation.extraRevisions, graphRowsInput])
  const editTimeCommitIds = useMemo(
    () =>
      preferences.revisionDate === 'created' && fromDate === '' && toDate === ''
        ? []
        : allRevisions.filter(revision => !revision.immutable).map(revision => revision.commitId),
    [preferences.revisionDate, fromDate, toDate, allRevisions],
  )
  const editTimes = useQueries({
    queries: Array.from({ length: Math.ceil(editTimeCommitIds.length / EDIT_TIMES_PAGE_SIZE) }, (_, page) => {
      const commitIds = editTimeCommitIds.slice(page * EDIT_TIMES_PAGE_SIZE, (page + 1) * EDIT_TIMES_PAGE_SIZE)
      return {
        queryKey: jujutsuQueryKeys.editTimes(path, commitIds),
        queryFn: ({ signal }: { readonly signal: AbortSignal }) => api.editTimes({ repoId: repoId ?? '', commitIds }, { signal }),
        enabled: repoId !== null,
        // A commit id names one immutable version, so its edit time never goes stale.
        staleTime: Number.POSITIVE_INFINITY,
        placeholderData: keepPreviousData,
      }
    }),
    combine: editTimesByCommitId,
  })
  const selectedRevision = navigation.selectedRevision
  const [locateRequest, setLocateRequest] = useState<Revision | null>(null)
  const [pendingLocateId, setPendingLocateId] = useState<string | null>(null)
  const [locatedId, setLocatedId] = useState<string | null>(null)
  const pendingReferenceSearch = useRef('')
  useEffect(() => {
    setLocateRequest(null)
    setComparisonSelection(null)
    setPendingLocateId(null)
    setLocatedId(null)
  }, [repoId, setComparisonSelection])

  const detailsQuery = useQuery({
    queryKey: jujutsuQueryKeys.details(path, selectedRevision?.commitId ?? ''),
    queryFn: async ({ signal }) => throwReadFailure(await api.details({ repoId: repoId ?? '', commitId: selectedRevision?.commitId ?? '' }, { signal })),
    ...REPOSITORY_QUERY_CACHE,
    enabled: repoId !== null && selectedRevision !== undefined,
  })
  const details = detailsQuery.data
  const selectedReviewProgress = ReviewProgressModel.progress(reviewStore, state?.root ?? '', selectedRevision?.commitId ?? '', details?.files ?? [])

  const fullDiffQuery = useQuery({
    queryKey: jujutsuQueryKeys.details(path, fullDiff?.commitId ?? ''),
    queryFn: async ({ signal }) => throwReadFailure(await api.details({ repoId: repoId ?? '', commitId: fullDiff?.commitId ?? '' }, { signal })),
    ...REPOSITORY_QUERY_CACHE,
    enabled: repoId !== null && fullDiff !== null,
  })

  const shownRoot = state?.root ?? null
  useEffect(() => PanelScopes.publishTitle(scope, shownRoot), [scope, shownRoot])
  useEffect(() => (sidePanel ? sidePanelRepository.show(shownRoot) : undefined), [sidePanel, shownRoot])
  const shownRootRef = useRef(shownRoot)
  shownRootRef.current = shownRoot
  useEffect(() => {
    if (!sidePanel) return
    return sidePanelRepository.onRequest(requested => {
      if (requested.reference !== undefined) setPendingReferenceRequest(requested.reference)
      if (shownRootRef.current !== null && containsPath(shownRootRef.current, requested.path)) return
      autoRegisterPath.current = requested.path
      registerRepository(requested.path)
    })
  }, [sidePanel, registerRepository])

  useEffect(() => {
    const selectedPath = path.trim()
    if (repoId !== null || selectedPath.length === 0 || autoRegisterPath.current === selectedPath) return
    autoRegisterPath.current = selectedPath
    registerRepository(selectedPath)
  }, [path, repoId, registerRepository])

  useEffect(() => {
    if (state === undefined) return
    const visibleCommitIds = new Set(state.revisions.map(row => row.commitId))
    setDescribeDrafts(current => Object.fromEntries(Object.entries(current).filter(([commitId]) => visibleCommitIds.has(commitId))))
  }, [state])

  const busy = registerMutation.isPending || stateQuery.isFetching || actionBusy
  const repositoryStatus = repositoryLoadingState({ registering: registerMutation.isPending, fetching: stateQuery.isFetching, hasState: state !== undefined })
  const loadingRepository = repositoryStatus.loading

  const remoteNames = state?.remoteNames ?? []
  const selectedRemote = remoteNames.includes(remote) ? remote : (remoteNames[0] ?? '')
  const localBookmarkNames = useMemo(() => [...new Set(state?.revisions.flatMap(row => row.localBookmarks) ?? [])], [state])
  const workingCopy = state?.revisions.find(revision => revision.workingCopy)
  const defaultBookmark = workingCopy?.localBookmarks[0] ?? localBookmarkNames[0] ?? ''
  const selectedBookmark = localBookmarkNames.includes(bookmark) ? bookmark : defaultBookmark
  const pushedRevision = remoteBookmarkRevision({ revisions: allRevisions, bookmark: selectedBookmark, remote: selectedRemote })
  const mainRevision = state?.revisions.find(revision => revision.localBookmarks.includes('main') || revision.bookmarks.includes('main'))

  const revisionsByCommitId = useMemo(() => new Map(allRevisions.map(revision => [revision.commitId, revision])), [allRevisions])
  const graphRows = useMemo(() => {
    const graphRevisions = filterGraphRevisions(allRevisions, {
      mineOnly,
      hideImmutable,
      author: authorFilter,
      text: textFilter,
      fromDate,
      toDate,
      editTimes,
      view: navigation.view,
      hidden: navigation.hidden,
      revealed: new Set(navigation.revealed.map(row => row.commitId)),
    })
    return RevisionGraphModel.layoutRevisionGraph(graphRevisions, revisionsByCommitId, false)
  }, [
    allRevisions,
    revisionsByCommitId,
    hideImmutable,
    mineOnly,
    authorFilter,
    textFilter,
    fromDate,
    toDate,
    editTimes,
    navigation.view,
    navigation.hidden,
    navigation.revealed,
  ])
  const visibleRevisions = useMemo(
    () =>
      graphRows.flatMap(row => {
        const revision = revisionsByCommitId.get(row.commitId)
        return revision === undefined ? [] : [revision]
      }),
    [graphRows, revisionsByCommitId],
  )
  const connectionIds =
    navigation.lens === null
      ? null
      : new Set([...navigation.lens.connectionIds, navigation.lens.commitId, navigation.lens.targetCommitId, ...navigation.lens.commonAncestorIds])

  const dropDestination = dropPresentation === null ? undefined : revisionsByCommitId.get(dropPresentation.destinationId)
  /** The drop preview renders in its destination row, or above the list while a filter hides that row. */
  const dropPreviewAt = (destination: Revision): JSX.Element | null => {
    if (dropPresentation === null) return null
    const source = revisionsByCommitId.get(dropPresentation.sourceId)
    return (
      <InlineDropPreview
        branch={dropPresentation.kind === 'rebase' ? previewBranch : []}
        busy={actionBusy}
        destinationLabel={`${destination.shortestChangeId} · ${firstLine(destination.description)}`}
        onCancel={() => sendAction({ type: 'cancel' })}
        onConfirm={confirmPreview}
        presentation={dropPresentation}
        preview={preview}
        sourceLabel={source === undefined ? dropPresentation.sourceId.slice(0, 12) : `${source.shortestChangeId} · ${firstLine(source.description)}`}
      />
    )
  }
  const graphRowsByCommitId = useMemo(() => new Map(graphRows.map(row => [row.commitId, row])), [graphRows])
  const graphMetrics = GRAPH_DENSITY[preferences.graphDensity]
  const rowHeight = graphMetrics.rowHeight
  const graphWidth = graphWidthFor(
    graphMetrics,
    graphRows.reduce((maximum, row) => Math.max(maximum, row.laneCount), 1),
  )
  const groups = useMemo(() => groupRows(visibleRevisions, preferences.dateHeadings), [visibleRevisions, preferences.dateHeadings])
  const movingBranch = useMemo(
    () => (dragSource === null || state === undefined ? null : descendantCommitIds(state.revisions, dragSource)),
    [dragSource, state],
  )
  const previewBranch = useMemo(() => {
    if (dropPresentation?.kind !== 'rebase' || state === undefined) return []
    const branchIds = descendantCommitIds(state.revisions, dropPresentation.sourceId)
    return state.revisions.filter(revision => branchIds.has(revision.commitId))
  }, [dropPresentation, state])
  const previewBranchIds = useMemo(() => new Set(previewBranch.map(revision => revision.commitId)), [previewBranch])

  const listItems = useMemo(() => {
    const input = { groups, collapsedDays, layouts: graphRowsByCommitId }
    if (pushedRevision === undefined || selectedBookmark === '' || selectedRemote === '') {
      return flattenRevisionGroups(input)
    }
    return flattenRevisionGroups({
      ...input,
      pushBoundary: { commitId: pushedRevision.commitId, bookmark: selectedBookmark, remote: selectedRemote },
    })
  }, [groups, collapsedDays, graphRowsByCommitId, pushedRevision, selectedBookmark, selectedRemote])
  const listScrollRef = useRef<HTMLDivElement | null>(null)
  const pendingFocusIndex = useRef<number | null>(null)
  const scrolledToWorkingCopy = useRef<string | null>(null)
  const interactedRow = useRef<Omit<GraphRowAnchor, 'rowHeight'> | null>(null)
  const rowAnchor = useRef<GraphRowAnchor | null>(null)
  const captureInteractedRow = (event: { readonly currentTarget: HTMLElement; readonly target: EventTarget | null }): void => {
    if (!(event.target instanceof Element)) return
    const container = event.currentTarget
    const row = event.target.closest('[data-commit-id]')
    const commitId = row?.getAttribute('data-commit-id') ?? null
    if (!(row instanceof HTMLElement) || commitId === null || !container.contains(row)) return
    interactedRow.current = {
      commitId,
      top: row.getBoundingClientRect().top - container.getBoundingClientRect().top,
      viewportHeight: container.clientHeight,
    }
  }
  /** Anything that scrolls on purpose drops the anchor, so a restore never fights the locate or arrow-key scroll. */
  const clearRowAnchor = (): void => {
    interactedRow.current = null
    rowAnchor.current = null
  }
  const dragSourceIndex = dragSource === null ? -1 : listItems.findIndex(item => item.key === dragSource)
  const workingCopyIndex = listItems.findIndex(item => item.kind === 'revision' && item.revision.workingCopy)
  const listVirtualizer = useVirtualizer({
    count: listItems.length,
    getScrollElement: () => listScrollRef.current,
    getItemKey: index => listItems[index]?.key ?? index,
    // Collapsed rows and day headings have an exact height, so an unmeasured row never shifts the rows around it.
    // An expanded row is measured by its own ref; guessing its panel height is what made the list jump while it settled.
    estimateSize: index => (listItems[index]?.kind === 'revision' ? rowHeight : 18),
    overscan: 12,
    paddingEnd: 16,
    // The sticky day heading and a dragged row stay mounted: unmounting the drag source would drop its dragend.
    rangeExtractor: range => {
      const indexes = new Set(defaultRangeExtractor(range))
      const dayIndex = activeDayIndex(listItems, range.startIndex)
      if (dayIndex !== null) indexes.add(dayIndex)
      if (dragSourceIndex >= 0) indexes.add(dragSourceIndex)
      return [...indexes].sort((left, right) => left - right)
    },
  })
  const virtualItems = listVirtualizer.getVirtualItems()
  const stickyDayIndex = activeDayIndex(listItems, listVirtualizer.range?.startIndex ?? 0)
  const graphHasMore = graphPageIsCurrent ? graphPageState.hasMore : debouncedSearch.length > 0 || (state?.graphHasMore ?? false)
  const loadedGraphRevisions = (state?.revisions.length ?? 0) + graphPageRevisions.length
  const loadMoreGraphRevisions = useCallback((): void => {
    if (repoId === null || !graphHasMore || graphPagePending) return
    requestGraphPage({
      repoId,
      query: debouncedSearch,
      excludeCommitIds: [
        ...(debouncedSearch.length === 0 ? (state?.revisions.map(revision => revision.commitId) ?? []) : []),
        ...graphPageRevisions.map(revision => revision.commitId),
      ],
    })
  }, [repoId, graphHasMore, graphPagePending, debouncedSearch, state?.revisions, graphPageRevisions, requestGraphPage])
  // Each page lands below the viewport, so the list tops itself up instead of waiting for a scroll event at the very end of the loaded history.
  useEffect(() => {
    const element = listScrollRef.current
    if (element === null) return
    const needsTopUp = GraphPagingModel.shouldLoadNextPage({
      loadedRevisions: loadedGraphRevisions,
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    })
    if (needsTopUp) loadMoreGraphRevisions()
  }, [loadedGraphRevisions, graphHasMore, graphPagePending, listItems.length, loadMoreGraphRevisions])

  const locateRevision = useCallback(
    (revision: Revision): void => {
      setLocateRequest(null)
      const listed = visibleRevisions.some(row => row.commitId === revision.commitId)
      if (!listed) {
        setLocateRequest(revision)
        return
      }
      setCollapsedDays(current => new Set([...current].filter(day => day !== dayLabel(revision.committerTime ?? revision.authorTime))))
      setPendingLocateId(revision.commitId)
    },
    [setCollapsedDays, visibleRevisions],
  )

  useEffect(() => {
    if (pendingReferenceRequest === null || state === undefined) return
    const match = ChatReferenceModel.resolve({ reference: pendingReferenceRequest, revisions: allRevisions })
    if (match === undefined) {
      const searchKey = `${repoId ?? ''}:${pendingReferenceRequest.kind}:${pendingReferenceRequest.value}`
      if (pendingReferenceSearch.current !== searchKey) {
        pendingReferenceSearch.current = searchKey
        setTextFilter(pendingReferenceRequest.value)
      }
      return
    }
    pendingReferenceSearch.current = ''
    setPendingReferenceRequest(null)
    setView('graph')
    setSelection({ commitId: match.commitId, changeId: match.changeId })
    if (pendingReferenceRequest.behavior === 'path') {
      setComparisonSelection({ commitId: match.commitId, changeId: match.changeId })
      navigation.beginComparison()
      navigation.applySlice(match, 'history')
    }
    locateRevision(match)
  }, [allRevisions, locateRevision, navigation, pendingReferenceRequest, repoId, setComparisonSelection, setSelection, setTextFilter, setView, state])

  const resetGraphView = (): void => {
    navigation.reset()
    setPreference('mineOnly', false)
    setPreference('hideImmutable', false)
    setAuthorFilter('')
    setTextFilter('')
    setFromDate('')
    setToDate('')
    setCollapsedDays(new Set())
    setLocateRequest(null)
  }

  useEffect(() => {
    if (pendingLocateId === null) return
    const index = listItems.findIndex(item => item.kind === 'revision' && item.revision.commitId === pendingLocateId)
    if (index < 0) return
    scrolledToWorkingCopy.current = repoId
    clearRowAnchor()
    listVirtualizer.scrollToIndex(index, { align: 'center' })
    const target = listScrollRef.current?.querySelector<HTMLElement>(`[data-index="${index}"] [data-row-focus]`)
    if (target === null || target === undefined) return
    target.focus({ preventScroll: true })
    setLocatedId(pendingLocateId)
    setPendingLocateId(null)
  }, [pendingLocateId, listItems, listVirtualizer, repoId, virtualItems])

  useEffect(() => {
    if (locatedId === null) return
    const timeout = window.setTimeout(() => setLocatedId(null), 1800)
    return () => window.clearTimeout(timeout)
  }, [locatedId])

  useEffect(() => {
    if (repoId === null || workingCopyIndex < 0 || listScrollRef.current === null || scrolledToWorkingCopy.current === repoId) return
    scrolledToWorkingCopy.current = repoId
    clearRowAnchor()
    listVirtualizer.scrollToIndex(workingCopyIndex, { align: 'center' })
  }, [repoId, workingCopyIndex, view, listVirtualizer])

  // Arrow-key focus may target a row that is not mounted yet; retried after each render until the virtualizer shows it.
  const focusPendingRow = (): void => {
    const index = pendingFocusIndex.current
    if (index === null) return
    const target = listScrollRef.current?.querySelector<HTMLElement>(`[data-index="${index}"] [data-row-focus]`)
    if (target === null || target === undefined) return
    pendingFocusIndex.current = null
    target.focus({ preventScroll: true })
  }
  useEffect(focusPendingRow)

  const moveRowFocus = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && moveSource !== null) {
      event.preventDefault()
      setMoveSource(null)
      return
    }
    // Any key can scroll the list (Page Down, Enter on a focused row), so none of them keep a restore pending.
    clearRowAnchor()
    if (!(event.target instanceof HTMLElement) || !event.target.hasAttribute('data-row-focus')) return
    const current = pendingFocusIndex.current ?? Number(event.target.closest('[data-index]')?.getAttribute('data-index'))
    if (!Number.isInteger(current)) return
    const last = listItems.length - 1
    let next: number | undefined
    if (event.key === 'ArrowDown') next = Math.min(current + 1, last)
    else if (event.key === 'ArrowUp') next = Math.max(current - 1, 0)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = last
    if (next === undefined) return
    event.preventDefault()
    pendingFocusIndex.current = next
    listVirtualizer.scrollToIndex(next, { align: 'auto' })
    focusPendingRow()
  }
  const emptyAncestors = useMemo(() => emptyAncestorCandidates(state?.revisions ?? []), [state])

  const errorMessages = [
    stateQuery.error && errorMessage(stateQuery.error, 'Could not load this repository.'),
    graphPageMutation.error && errorMessage(graphPageMutation.error, 'Could not load revision results.'),
    registerMutation.error && errorMessage(registerMutation.error, 'Could not register this repository.'),
    actionSnapshot.context.error,
    launchMutation.error && errorMessage(launchMutation.error, 'Workspace Session could not be opened.'),
  ].filter((message): message is string => Boolean(message))

  const askForConfirmation = (action: Mutation, presentation: DropPresentation | null = null): void => {
    if (repoId === null) return
    if (action.kind === 'workspace-add') setProvisionedPath(null)
    registerMutation.reset()
    sendAction({ type: 'prepare', repoId, action, presentation })
  }

  const chooseMoveDestination = (destination: Revision): void => {
    if (moveSource === null) return
    setMoveSource(null)
    const resolution = resolveRevisionDrop({ sourceRevisionId: moveSource.commitId, target: destination, revisions: state?.revisions ?? [] })
    if (resolution.kind === 'invalid') {
      sendAction({ type: 'reject', error: resolution.message })
      return
    }
    if (resolution.kind === 'action') askForConfirmation(resolution.action, resolution.presentation)
  }

  const confirmPreview = (): void => sendAction({ type: 'confirm' })
  const actionPreview = preview !== undefined && dropPresentation === null ? preview : undefined
  const pendingAction = actionSnapshot.context.action
  const confirmAnchorId = ((): string | null => {
    if (actionPreview === undefined || pendingAction === null || view !== 'graph') return null
    switch (pendingAction.kind) {
      case 'fetch':
      case 'push':
        return null
      case 'abandon':
        return pendingAction.commitIds[0] ?? null
      case 'squash':
      case 'rebase':
        return pendingAction.sourceId
      case 'bookmark-move':
      case 'bookmark-set':
        return pendingAction.destinationId
      case 'bookmark-delete':
        return state?.revisions.find(revision => revision.localBookmarks.includes(pendingAction.bookmark))?.commitId ?? null
      case 'workspace-forget':
        return null
      default:
        return pendingAction.commitId
    }
  })()
  const rowConfirmAnchorId = confirmAnchorId !== null && visibleRevisions.some(revision => revision.commitId === confirmAnchorId) ? confirmAnchorId : null
  // Every way a row grows (selection, confirmation, workspace panel, diff) is opened from inside that row, so the row's
  // last measured place before the click is what the list restores once the panel changed its height.
  const expandedRowSignature = [
    selectedRevision?.commitId ?? '',
    fullDiff?.commitId ?? '',
    rowConfirmAnchorId ?? '',
    workspaceRemoval?.commitId ?? '',
    workspaceBase?.commitId ?? '',
    bookmarkDraft?.commitId ?? '',
  ].join('|')
  const expandedRowSignatureRef = useRef(expandedRowSignature)
  useLayoutEffect(() => {
    const expandedChanged = expandedRowSignatureRef.current !== expandedRowSignature
    expandedRowSignatureRef.current = expandedRowSignature
    if (expandedChanged && interactedRow.current !== null) {
      rowAnchor.current = { ...interactedRow.current, rowHeight }
      interactedRow.current = null
    }
    const anchor = rowAnchor.current
    const container = listScrollRef.current
    if (anchor === null || container === null) return
    const element = container.querySelector<HTMLElement>(`[data-commit-id="${anchor.commitId}"]`)
    // The row left the rendered window: whatever moved it now belongs to scrolling, not to the expansion that opened it.
    if (element === null) {
      rowAnchor.current = null
      return
    }
    const currentTop = element.getBoundingClientRect().top - container.getBoundingClientRect().top
    const delta = GraphRowAnchorModel.scrollDelta({ anchor, currentTop })
    if (!GraphRowAnchorModel.shouldScroll(delta)) return
    container.scrollTop += delta
  })
  const inlineConfirm =
    actionPreview === undefined ? null : (
      <InlineActionConfirm busy={actionBusy} onCancel={() => sendAction({ type: 'cancel' })} onConfirm={confirmPreview} preview={actionPreview} />
    )

  const inlineRemoval =
    workspaceRemoval === null || repoId === null || state === undefined ? null : (
      <InlineWorkspaceRemoval
        name={workspaceRemoval.name}
        onCancel={() => setWorkspaceRemoval(null)}
        onRemoved={() => setWorkspaceRemoval(null)}
        repoId={repoId}
        repoRoot={state.root}
      />
    )
  const removalHidden = workspaceRemoval !== null && !visibleRevisions.some(revision => revision.commitId === workspaceRemoval.commitId)

  const inlineProvisioner =
    workspaceBase === null ? null : (
      <InlineWorkspaceProvisioner
        directoryPicker={props.directoryPicker}
        onCancel={() => setWorkspaceBase(null)}
        onPreview={action => {
          setWorkspaceBase(null)
          askForConfirmation(action)
        }}
        registerWorkspace={props.registerWorkspace}
        revision={workspaceBase}
      />
    )
  const provisionerHidden = workspaceBase !== null && !visibleRevisions.some(revision => revision.commitId === workspaceBase.commitId)

  const inlineBookmark =
    bookmarkDraft === null ? null : (
      <InlineBookmarkSet
        onCancel={() => setBookmarkDraft(null)}
        onPreview={name => {
          const commitId = bookmarkDraft.commitId
          setBookmarkDraft(null)
          askForConfirmation({ kind: 'bookmark-set', bookmark: name, destinationId: commitId })
        }}
        shortestChangeId={revisionsByCommitId.get(bookmarkDraft.commitId)?.shortestChangeId ?? 'the selected revision'}
      />
    )
  const bookmarkHidden = bookmarkDraft !== null && !visibleRevisions.some(revision => revision.commitId === bookmarkDraft.commitId)

  const inlineDiff =
    fullDiff === null ? null : (
      <InlineRevisionDiff
        error={fullDiffQuery.error === null ? null : errorMessage(fullDiffQuery.error, 'Could not load the revision diff.')}
        focusPath={fullDiff.focusPath}
        layout={diffLayout}
        onCancel={() => setFullDiff(null)}
        onOpenInEditor={path => {
          if (state !== undefined && openInEditor({ path, cwd: state.root })) setFullDiff(null)
        }}
        patch={fullDiffQuery.data?.patch}
        heading={fullDiff.title}
      />
    )
  const diffHidden = fullDiff !== null && !visibleRevisions.some(revision => revision.commitId === fullDiff.commitId)

  const refreshRepository = (): void => {
    if (repoId !== null) void queryClient.invalidateQueries({ queryKey: jujutsuQueryKeys.repository(path) })
  }

  const openFullDiff = (revision: Revision, focusPath: string | null): void =>
    setFullDiff({ commitId: revision.commitId, title: firstLine(revision.description) + ' · ' + revision.shortestChangeId, focusPath })

  const updateFileReviews = (changes: readonly ReviewChange[]): void => {
    if (state === undefined || selectedRevision === undefined) return
    const repositoryRoot = state.root
    const commitId = selectedRevision.commitId
    const saved = changes.some(change => change.reviewed) ? 'Review progress saved.' : 'Review mark cleared.'
    if (reviewQuery.data === undefined) {
      const next = applyLocalReviewChanges({ store: localReviewStore, changes, repositoryRoot, commitId })
      const fallbackSaved = changes.some(change => change.reviewed) ? 'Review progress saved in this browser.' : 'Review mark cleared.'
      setReviewNotice(writeLocalReviewStore(next) ? fallbackSaved : 'Browser storage is unavailable. Review progress could not be persisted.')
      return
    }

    const toggles = changes.flatMap(change =>
      change.file.contentDigest === null
        ? []
        : [{ repositoryRoot, commitId, file: { path: change.file.path, contentDigest: change.file.contentDigest }, reviewed: change.reviewed }],
    )
    if (toggles.length === 0) {
      setReviewNotice(saved)
      return
    }
    reviewMutation.mutate({ toggles, successNotice: saved })
  }

  const endDrag = (): void => sendAction({ type: 'drag.end' })

  const dropResolution = (event: DragEvent, target: Revision) => {
    const revisions = state?.revisions ?? []
    const bookmark = event.dataTransfer.getData(BOOKMARK_MIME)
    if (bookmark.length > 0) {
      return resolveBookmarkDrop({
        bookmark,
        sourceRevisionId: event.dataTransfer.getData(BOOKMARK_SOURCE_MIME),
        target,
        revisions,
      })
    }
    const sourceRevisionId = event.dataTransfer.getData(REVISION_MIME)
    if (sourceRevisionId.length > 0) return resolveRevisionDrop({ sourceRevisionId, target, revisions })
    return { kind: 'noop' as const }
  }

  const dropOn = (event: DragEvent, revision: Revision): void => {
    event.preventDefault()
    registerMutation.reset()
    const resolution = dropResolution(event, revision)
    sendAction({
      type: 'drop',
      repoId,
      action: resolution.kind === 'action' ? resolution.action : null,
      targetId: revision.commitId,
      presentation: resolution.kind === 'action' ? resolution.presentation : null,
      error: resolution.kind === 'invalid' ? resolution.message : null,
    })
  }

  const toggleRevision = (revision: Revision): void => {
    setEditingDescription(null)
    setSelection(current => (current?.commitId === revision.commitId ? null : { commitId: revision.commitId, changeId: revision.changeId }))
  }

  const activateRevisionRow = (revision: Revision): void => {
    if (moveSource !== null) {
      chooseMoveDestination(revision)
      return
    }
    toggleRevision(revision)
  }

  const compareRevision = (revision: Revision, target?: GraphLandmark['kind'] | 'revision'): void => {
    setComparisonSelection({ commitId: revision.commitId, changeId: revision.changeId })
    navigation.beginComparison(target)
    locateRevision(revision)
  }

  const compareCurrentRevision = (): void => {
    const revision = selectedRevision ?? workingCopy
    if (revision !== undefined) compareRevision(revision)
  }

  const copyText = async (value: string, label: string): Promise<void> => {
    try {
      const copied = await writeClipboard(value)
      setCopyNotice({ copied, label })
    } catch {
      setCopyNotice({ copied: false, label })
    }
  }

  const missingPushLabel = state?.lastPushHistoryTruncated ? 'not found before the operation-history limit' : 'not found in the latest 1,000 operations'
  const foundPushLabel = state?.lastPushAt ? formatAge(state.lastPushAt) + (state.lastPushHistoryTruncated ? ' · scan limited' : '') : missingPushLabel
  const lastPushLabel = state === undefined ? '' : foundPushLabel

  const revisionMenu = (revision: Revision): ReactNode => {
    const parent = revisionsByCommitId.get(revision.parents[0] ?? '')
    return (
      <ContextMenuContent className="dshx-root dshx:w-56">
        <ContextMenuLabel className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">
          {revision.shortestChangeId} · {firstLine(revision.description)}
        </ContextMenuLabel>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Compare with</ContextMenuSubTrigger>
          <ContextMenuSubContent className="dshx-root dshx:w-52">
            <ContextMenuLabel className="dshx:text-xs dshx:text-muted-foreground">Choose a landmark</ContextMenuLabel>
            {navigation.landmarks.map(landmark => (
              <ContextMenuItem disabled={landmark.status !== 'resolved'} key={landmark.kind} onSelect={() => compareRevision(revision, landmark.kind)}>
                {landmark.label}
                {landmark.status === 'resolved' ? '' : ` · ${landmark.status}`}
              </ContextMenuItem>
            ))}
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => compareRevision(revision, 'revision')}>Another revision…</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem disabled={navigation.slicePending} onSelect={() => navigation.applySlice(revision, 'history')}>
          Focus history leading here
        </ContextMenuItem>
        <ContextMenuItem disabled={navigation.slicePending} onSelect={() => navigation.applySlice(revision, 'exclusive')}>
          Hide exclusive history leading here
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => openFullDiff(revision, null)}>Show full diff</ContextMenuItem>
        {!revision.immutable && (
          <ContextMenuItem
            onSelect={() => {
              setSelection({ commitId: revision.commitId, changeId: revision.changeId })
              setEditingDescription(revision.commitId)
            }}
          >
            Describe…
          </ContextMenuItem>
        )}
        {!revision.workingCopy && !revision.immutable && (
          <ContextMenuItem onSelect={() => askForConfirmation({ kind: 'edit', commitId: revision.commitId })}>Edit this change</ContextMenuItem>
        )}
        <ContextMenuItem onSelect={() => askForConfirmation({ kind: 'new', commitId: revision.commitId })}>New change here</ContextMenuItem>
        <ContextMenuItem onSelect={() => setWorkspaceBase(revision)}>New workspace here…</ContextMenuItem>
        {revision.workspaces
          .filter(name => name !== 'default')
          .map(name => (
            <ContextMenuItem key={name} onSelect={() => setWorkspaceRemoval({ commitId: revision.commitId, name })} variant="destructive">
              Remove workspace {name}…
            </ContextMenuItem>
          ))}
        <ContextMenuSeparator />
        {!revision.immutable && parent !== undefined && !parent.immutable && (
          <ContextMenuItem onSelect={() => askForConfirmation({ kind: 'squash', sourceId: revision.commitId, destinationId: parent.commitId })}>
            Squash into parent
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={() => askForConfirmation({ kind: 'duplicate', commitId: revision.commitId })}>Duplicate</ContextMenuItem>
        {workingCopy !== undefined && workingCopy.commitId !== revision.commitId && (
          <ContextMenuItem onSelect={() => askForConfirmation({ kind: 'revert', commitId: revision.commitId, destinationId: workingCopy.commitId })}>
            Revert onto @
          </ContextMenuItem>
        )}
        {!revision.immutable && <ContextMenuItem onSelect={() => setMoveSource(revision)}>Rebase branch onto…</ContextMenuItem>}
        {!revision.immutable && mainRevision !== undefined && mainRevision.commitId !== revision.commitId && (
          <ContextMenuItem onSelect={() => askForConfirmation({ kind: 'rebase', sourceId: revision.commitId, destinationId: mainRevision.commitId })}>
            Rebase onto main
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={() => setBookmarkDraft({ commitId: revision.commitId })}>Set bookmark…</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void copyText(fullRevisionId(revision), 'Revision ID')}>Copy revision ID</ContextMenuItem>
        {!revision.immutable && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => askForConfirmation({ kind: 'abandon', commitIds: [revision.commitId] })} variant="destructive">
              Abandon…
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    )
  }

  const bookmarkMenu = (name: string, local: boolean): ReactNode => (
    <ContextMenuContent className="dshx-root dshx:w-52">
      <ContextMenuLabel className="dshx:truncate dshx:font-mono dshx:text-xs">{name}</ContextMenuLabel>
      <ContextMenuItem disabled={!local || selectedRemote === ''} onSelect={() => askForConfirmation({ kind: 'push', remote: selectedRemote, bookmark: name })}>
        Push to {selectedRemote || 'remote'}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => void copyText(name, 'Bookmark name')}>Copy name</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={!local} onSelect={() => askForConfirmation({ kind: 'bookmark-delete', bookmark: name })} variant="destructive">
        Delete bookmark…
      </ContextMenuItem>
    </ContextMenuContent>
  )

  const workspaceMenu = (name: string, commitId: string): ReactNode => (
    <ContextMenuContent className="dshx-root dshx:w-52">
      <ContextMenuLabel className="dshx:truncate dshx:font-mono dshx:text-xs">{name}</ContextMenuLabel>
      <ContextMenuItem onSelect={() => void copyText(name, 'Workspace name')}>Copy name</ContextMenuItem>
      {name === 'default' ? null : (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => setWorkspaceRemoval({ commitId, name })} variant="destructive">
            Remove workspace…
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  )

  const revisionDetails = (revision: Revision): ReactNode => {
    const repositoryRoot = state?.root ?? ''
    const parent = revisionsByCommitId.get(revision.parents[0] ?? '')
    const visibleFiles =
      details?.files.filter(file => !hideReviewedFiles || !ReviewProgressModel.isReviewed(reviewStore, repositoryRoot, revision.commitId, file)) ?? []
    const describeText = describeDrafts[revision.commitId] ?? editableDescription(revision.description)
    const describeChanged = RevisionGraphModel.describeDraftChanged(describeText, revision.description)
    const editing = editingDescription === revision.commitId && !revision.immutable
    return (
      <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:py-2 dshx:pr-3 dshx:text-xs">
        {revision.description.trim().length > 0 && !editing && (
          <p className="dshx:whitespace-pre-wrap dshx:text-muted-foreground">{editableDescription(revision.description)}</p>
        )}
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1.5 dshx:text-muted-foreground">
          <span>{revision.author || 'Unknown author'}</span>
          <span aria-hidden>·</span>
          <time dateTime={editTimes.get(revision.commitId) ?? revision.authorTime}>
            {revisionDates(revision, editTimes.get(revision.commitId)).replaceAll('\n', ' · ')}
          </time>
          <span aria-hidden>·</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="dshx:font-mono dshx:hover:text-foreground"
                onClick={() => void copyText(revision.commitId, 'Commit ID for this revision')}
                type="button"
              >
                {revision.commitId.slice(0, 12)}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{`Copy commit ID ${revision.commitId}`}</TooltipContent>
          </Tooltip>
          {revision.immutable && (
            <Badge className={COMPACT_BADGE} variant="outline">
              immutable
            </Badge>
          )}
          {revision.conflict && (
            <Badge className={cn(COMPACT_BADGE, 'dshx:border-warning/40 dshx:text-warning')} variant="outline">
              conflict
            </Badge>
          )}
          {revision.evolved && (
            <Badge className={cn(COMPACT_BADGE, 'dshx:text-muted-foreground')} variant="outline">
              rewritten
            </Badge>
          )}
        </div>
        {editing && (
          <div className="dshx:flex dshx:flex-col dshx:gap-1.5">
            <Textarea
              aria-label="New description"
              autoFocus
              className="dshx:max-h-28 dshx:min-h-12 dshx:px-2 dshx:py-1.5 dshx:text-xs dshx:md:text-xs"
              onChange={event => setDescribeDrafts(current => ({ ...current, [revision.commitId]: event.target.value }))}
              rows={Math.min(5, Math.max(2, describeText.split('\n').length))}
              value={describeText}
            />
            <div className="dshx:flex dshx:gap-1.5">
              <Button
                disabled={!describeChanged || busy}
                onClick={() => askForConfirmation({ kind: 'describe', commitId: revision.commitId, message: describeText })}
                size="xs"
                type="button"
              >
                Preview describe
              </Button>
              <Button onClick={() => setEditingDescription(null)} size="xs" type="button" variant="ghost">
                Cancel
              </Button>
            </div>
          </div>
        )}
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1.5">
          {!revision.immutable && !editing && (
            <Button onClick={() => setEditingDescription(revision.commitId)} size="xs" type="button" variant="outline">
              Describe
            </Button>
          )}
          <Button onClick={() => openFullDiff(revision, null)} size="xs" type="button" variant="outline">
            Full diff
          </Button>
          {!revision.workingCopy && !revision.immutable && (
            <Button disabled={busy} onClick={() => askForConfirmation({ kind: 'edit', commitId: revision.commitId })} size="xs" type="button" variant="outline">
              Edit This Change
            </Button>
          )}
          {!revision.immutable && parent !== undefined && !parent.immutable && (
            <Button
              disabled={busy}
              onClick={() => askForConfirmation({ kind: 'squash', sourceId: revision.commitId, destinationId: parent.commitId })}
              size="xs"
              type="button"
              variant="outline"
            >
              <ArrowDownIcon />
              Squash into parent
            </Button>
          )}
        </div>
        {details === undefined && detailsQuery.error !== null ? (
          <Alert className="dshx:px-3 dshx:py-2" variant="destructive">
            <AlertDescription className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs">
              <span className="dshx:min-w-0 dshx:flex-1">{errorMessage(detailsQuery.error, 'Could not load revision details.')}</span>
              <Button disabled={detailsQuery.isFetching} onClick={() => void detailsQuery.refetch()} size="xs" type="button" variant="outline">
                {detailsQuery.isFetching ? <Spinner /> : <RefreshCwIcon />}
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : details === undefined ? (
          <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-muted-foreground">
            <Spinner className="dshx:size-3" />
            Loading revision details…
          </div>
        ) : (
          <>
            <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-x-2 dshx:gap-y-1 dshx:text-[11px] dshx:text-muted-foreground">
              <span className="dshx:font-semibold dshx:uppercase dshx:tracking-wide">Changed files</span>
              <span className="dshx:font-mono">{details.files.length}</span>
              <FileViewToggle onChange={value => setPreference('fileView', value)} value={preferences.fileView} />
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    {selectedReviewProgress.reviewed}/{selectedReviewProgress.total} reviewed
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">Files marked reviewed in this browser</TooltipContent>
              </Tooltip>
              {details.truncated && (
                <Badge className={COMPACT_BADGE} variant="warning">
                  diff truncated; counts partial
                </Badge>
              )}
              <LineCounts additions={details.additions} className="dshx:ml-auto" deletions={details.deletions} />
            </div>
            <Label className="dshx:gap-1.5 dshx:self-start dshx:text-[11px] dshx:font-normal dshx:text-muted-foreground">
              <Checkbox checked={hideReviewedFiles} className="dshx:size-3.5" onCheckedChange={checked => setHideReviewedFiles(checked === true)} />
              Hide reviewed files
            </Label>
            {reviewNotice.length > 0 && (
              <p className="dshx:text-muted-foreground" role="status">
                {reviewNotice}
              </p>
            )}
            <ChangedFiles
              className="dshx:ml-1 dshx:border-l dshx:pl-1"
              files={visibleFiles}
              onOpen={filePath => openFullDiff(revision, filePath)}
              onOpenInEditor={filePath => openInEditor({ path: filePath, cwd: repositoryRoot })}
              onSelectionChange={paths => {
                const selected = new Set(paths)
                updateFileReviews(
                  details.files
                    .filter(file => selected.has(file.path) !== ReviewProgressModel.isReviewed(reviewStore, repositoryRoot, revision.commitId, file))
                    .map(file => ({ file, reviewed: selected.has(file.path) })),
                )
              }}
              selectedPaths={details.files
                .filter(file => ReviewProgressModel.isReviewed(reviewStore, repositoryRoot, revision.commitId, file))
                .map(file => file.path)}
              selectionLabel="Mark reviewed"
              view={preferences.fileView}
            />
            {details.files.length === 0 && <p className="dshx:text-muted-foreground">No file changes in this revision.</p>}
            {hideReviewedFiles && details.files.length > 0 && visibleFiles.length === 0 && (
              <p className="dshx:text-muted-foreground">All reviewable files are hidden.</p>
            )}
            <Collapsible>
              <CollapsibleTrigger className={DISCLOSURE_TRIGGER}>
                <ChevronRightIcon className="dshx:size-3 dshx:transition-transform dshx:group-data-[state=open]/disclosure:rotate-90" />
                Change evolution
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className={CODE_BLOCK}>{details.evolution}</pre>
              </CollapsibleContent>
            </Collapsible>
            <Collapsible defaultOpen={preferences.diffExpanded}>
              <CollapsibleTrigger className={DISCLOSURE_TRIGGER}>
                <ChevronRightIcon className="dshx:size-3 dshx:transition-transform dshx:group-data-[state=open]/disclosure:rotate-90" />
                Patch
              </CollapsibleTrigger>
              <CollapsibleContent>
                <PatchView className="dshx:h-80 dshx:rounded-md dshx:border" layout={diffLayout} patch={details.patch} />
              </CollapsibleContent>
            </Collapsible>
          </>
        )}
      </div>
    )
  }

  const graphView =
    state === undefined ? null : (
      <>
        <div className="dshx:flex dshx:flex-none dshx:flex-col dshx:gap-1.5 dshx:border-b dshx:px-3 dshx:py-1.5">
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-end dshx:gap-1">
            <div className="dshx:mr-auto dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-1">
              <LandmarkControls navigation={navigation} onLocate={locateRevision} />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    disabled={workingCopy === undefined && selectedRevision === undefined}
                    onClick={compareCurrentRevision}
                    size="xs"
                    type="button"
                    variant="outline"
                  >
                    Compare
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Compare selected revision, or current workspace revision, with a landmark</TooltipContent>
              </Tooltip>
            </div>
            <Toggle
              className="dshx:h-7 dshx:gap-1.5 dshx:border dshx:border-transparent dshx:px-2 dshx:font-mono! dshx:text-xs dshx:font-normal dshx:text-muted-foreground dshx:data-[state=on]:border-border dshx:data-[state=on]:bg-card dshx:data-[state=on]:text-foreground"
              onPressedChange={pressed => setPreference('mineOnly', pressed)}
              pressed={mineOnly}
              size="sm"
            >
              <UserIcon className="dshx:size-3.5" />
              Mine
            </Toggle>
            <Label className="dshx:gap-1.5 dshx:px-1.5 dshx:font-mono dshx:text-xs dshx:font-normal dshx:text-muted-foreground">
              <Checkbox checked={hideImmutable} onCheckedChange={checked => setPreference('hideImmutable', checked === true)} />
              Hide immutable
            </Label>
            <Button
              aria-label="Filter by date"
              aria-pressed={showDates}
              className={cn('dshx:text-muted-foreground', (showDates || fromDate || toDate) && 'dshx:bg-accent dshx:text-foreground')}
              onClick={() => setShowDates(current => !current)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <CalendarIcon />
            </Button>
            <Button
              aria-label="Show search"
              aria-pressed={showSearch}
              className={cn('dshx:text-muted-foreground', (showSearch || textFilter || authorFilter) && 'dshx:bg-accent dshx:text-foreground')}
              onClick={() => setShowSearch(current => !current)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <SearchIcon />
            </Button>
          </div>
          {showSearch && (
            <div className="dshx:flex dshx:items-center dshx:gap-1.5">
              <InputGroup className="dshx:h-7 dshx:flex-1">
                <InputGroupInput
                  aria-label="Search revisions"
                  autoFocus={sidePanel}
                  maxLength={256}
                  className="dshx:text-xs dshx:md:text-xs"
                  onChange={event => setTextFilter(event.target.value)}
                  placeholder={sidePanel ? 'Search descriptions or IDs…' : 'Search descriptions, IDs, bookmarks, tags, workspaces'}
                  value={textFilter}
                />
                <InputGroupAddon>
                  <SearchIcon className="dshx:size-3.5" />
                </InputGroupAddon>
              </InputGroup>
              {!sidePanel && (
                <Input
                  aria-label="Filter author"
                  className="dshx:h-7 dshx:w-48 dshx:text-xs dshx:md:text-xs"
                  onChange={event => setAuthorFilter(event.target.value)}
                  placeholder="Author"
                  value={authorFilter}
                />
              )}
            </div>
          )}
          {showDates && (
            <div className="dshx:flex dshx:items-center dshx:justify-end dshx:gap-1.5 dshx:text-xs dshx:text-muted-foreground">
              <Input
                aria-label="From date"
                className="dshx:h-7 dshx:w-auto dshx:text-xs dshx:md:text-xs"
                onChange={event => setFromDate(event.target.value)}
                type="date"
                value={fromDate}
              />
              <span aria-hidden>→</span>
              <Input
                aria-label="To date"
                className="dshx:h-7 dshx:w-auto dshx:text-xs dshx:md:text-xs"
                onChange={event => setToDate(event.target.value)}
                type="date"
                value={toDate}
              />
            </div>
          )}
        </div>
        <GraphViewStatus
          navigation={navigation}
          filters={[
            ...(mineOnly ? [{ label: 'Mine', clear: () => setPreference('mineOnly', false) }] : []),
            ...(hideImmutable ? [{ label: 'Hide immutable', clear: () => setPreference('hideImmutable', false) }] : []),
            ...(textFilter ? [{ label: `Search: ${textFilter}`, clear: () => setTextFilter('') }] : []),
            ...(authorFilter ? [{ label: `Author: ${authorFilter}`, clear: () => setAuthorFilter('') }] : []),
            ...(fromDate || toDate
              ? [
                  {
                    label: `Dates: ${fromDate || 'any'} – ${toDate || 'any'}`,
                    clear: () => {
                      setFromDate('')
                      setToDate('')
                    },
                  },
                ]
              : []),
            ...(collapsedDays.size > 0 ? [{ label: `${collapsedDays.size} days collapsed`, clear: () => setCollapsedDays(new Set()) }] : []),
          ]}
          onReset={resetGraphView}
        />
        {locateRequest !== null && (
          <div className="dshx:flex dshx:flex-none dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:border-b dshx:px-3 dshx:py-2 dshx:text-xs" role="status">
            <span>{locateRequest.shortestChangeId} is outside the current view.</span>
            <Button
              onClick={() => {
                navigation.reveal(locateRequest)
                setCollapsedDays(new Set())
                setPendingLocateId(locateRequest.commitId)
                setLocateRequest(null)
              }}
              size="xs"
              type="button"
              variant="outline"
            >
              Show temporarily
            </Button>
            <Button
              onClick={() => {
                resetGraphView()
                navigation.reveal(locateRequest)
                setPendingLocateId(locateRequest.commitId)
              }}
              size="xs"
              type="button"
              variant="outline"
            >
              Clear filters and locate
            </Button>
            <Button onClick={() => setLocateRequest(null)} size="xs" type="button" variant="ghost">
              Cancel
            </Button>
          </div>
        )}
        {navigation.comparisonOpen && navigation.comparisonRevision !== undefined && (
          <RelationshipInspector navigation={navigation} onLocate={locateRevision} revisions={allRevisions} selected={navigation.comparisonRevision} />
        )}
        <div
          aria-label="Revisions"
          className="dshx:min-h-0 dshx:flex-1 dshx:overflow-auto dshx:overscroll-contain"
          data-loaded-revisions={loadedGraphRevisions}
          onClickCapture={captureInteractedRow}
          onContextMenuCapture={captureInteractedRow}
          onDragEnd={endDrag}
          onFocusCapture={clearRowAnchor}
          onKeyDown={moveRowFocus}
          onPointerDown={clearRowAnchor}
          onScroll={event => {
            const element = event.currentTarget
            if (GraphPagingModel.needsAnotherPage({ scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }))
              loadMoreGraphRevisions()
          }}
          onWheel={clearRowAnchor}
          ref={listScrollRef}
          role="region"
        >
          {moveSource !== null && (
            <div
              className="dshx:flex dshx:items-center dshx:gap-2 dshx:border-b dshx:border-primary/30 dshx:bg-primary/5 dshx:px-3 dshx:py-2 dshx:text-xs"
              role="status"
            >
              <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">
                Choose a destination for {moveSource.shortestChangeId} · {firstLine(moveSource.description)}. Press Escape to cancel.
              </span>
              <Button onClick={() => setMoveSource(null)} size="sm" type="button" variant="outline">
                Cancel
              </Button>
            </div>
          )}
          {dropDestination !== undefined && !visibleRevisions.some(revision => revision.commitId === dropDestination.commitId) && (
            // A filter can hide the destination row the preview lives in; the preview stays reachable above the list.
            <div className="dshx:border-b dshx:p-2">{dropPreviewAt(dropDestination)}</div>
          )}
          <div className="dshx:relative dshx:w-full" style={{ height: listVirtualizer.getTotalSize() }}>
            {virtualItems.map(virtualRow => {
              const item = listItems[virtualRow.index]
              if (item === undefined) return null
              const sticky = virtualRow.index === stickyDayIndex
              const rowDropPresentation = item.kind === 'revision' && dropPresentation?.destinationId === item.revision.commitId ? dropPresentation : null
              return (
                <div
                  className={sticky ? 'dshx:sticky dshx:top-0 dshx:z-10' : 'dshx:absolute dshx:top-0 dshx:left-0 dshx:w-full'}
                  data-index={virtualRow.index}
                  key={virtualRow.key}
                  ref={listVirtualizer.measureElement}
                  style={sticky ? undefined : { transform: `translateY(${virtualRow.start}px)` }}
                >
                  {item.kind === 'day' ? (
                    <button
                      aria-expanded={!collapsedDays.has(item.day)}
                      className="dshx:flex dshx:h-[18px] dshx:w-full dshx:items-center dshx:gap-1 dshx:border-b dshx:border-border/60 dshx:bg-background dshx:pr-3 dshx:text-left dshx:text-[10px] dshx:font-semibold dshx:uppercase dshx:tracking-wider dshx:text-muted-foreground dshx:outline-none dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50"
                      data-row-focus=""
                      onClick={() =>
                        setCollapsedDays(current => {
                          const next = new Set(current)
                          if (next.has(item.day)) next.delete(item.day)
                          else next.add(item.day)
                          return next
                        })
                      }
                      type="button"
                    >
                      <span className="dshx:relative dshx:h-full dshx:flex-none" style={{ width: graphWidth }}>
                        <GraphLanes lanes={item.firstLayout?.topLanes ?? []} metrics={graphMetrics} width={graphWidth} />
                      </span>
                      <ChevronDownIcon
                        className={cn('dshx:size-3 dshx:flex-none dshx:transition-transform', collapsedDays.has(item.day) && 'dshx:-rotate-90')}
                      />
                      <span className="dshx:truncate">{item.day}</span>
                      <span className="dshx:ml-auto dshx:font-mono dshx:font-normal">{item.count}</span>
                    </button>
                  ) : item.kind === 'push' ? (
                    <div
                      aria-label={`Last pushed revision: ${item.bookmark}@${item.remote}`}
                      className="dshx:flex dshx:h-[18px] dshx:w-full dshx:items-center dshx:gap-1 dshx:border-b dshx:border-border/60 dshx:bg-background dshx:pr-3 dshx:text-[10px] dshx:font-semibold dshx:uppercase dshx:tracking-wider dshx:text-muted-foreground"
                      data-push-boundary=""
                    >
                      <span className="dshx:relative dshx:h-full dshx:flex-none" style={{ width: graphWidth }}>
                        <GraphLanes lanes={item.firstLayout.topLanes} metrics={graphMetrics} width={graphWidth} />
                      </span>
                      <span>
                        Last pushed · {item.bookmark}@{item.remote}
                      </span>
                    </div>
                  ) : (
                    <RevisionRow
                      bookmarkMenu={bookmarkMenu}
                      workspaceMenu={workspaceMenu}
                      connectionDimmed={connectionIds !== null && !connectionIds.has(item.revision.commitId)}
                      highlighted={locatedId === item.revision.commitId || connectionIds?.has(item.revision.commitId) === true}
                      dimmed={movingBranch?.has(item.revision.commitId) === true || previewBranchIds.has(item.revision.commitId)}
                      dropTarget={dropTarget === item.revision.commitId || rowDropPresentation !== null}
                      expanded={
                        selectedRevision?.commitId === item.revision.commitId ||
                        rowDropPresentation !== null ||
                        rowConfirmAnchorId === item.revision.commitId ||
                        workspaceRemoval?.commitId === item.revision.commitId ||
                        workspaceBase?.commitId === item.revision.commitId ||
                        bookmarkDraft?.commitId === item.revision.commitId ||
                        fullDiff?.commitId === item.revision.commitId
                      }
                      graphLayout={item.layout}
                      graphWidth={graphWidth}
                      editedAt={editTimes.get(item.revision.commitId)}
                      revisionDate={preferences.revisionDate}
                      menu={revisionMenu(item.revision)}
                      onDragEnter={event => {
                        if (hasDragType(event, REVISION_MIME) || hasDragType(event, BOOKMARK_MIME))
                          sendAction({ type: 'drag.enter', targetId: item.revision.commitId })
                      }}
                      onDragLeave={() => sendAction({ type: 'drag.leave', targetId: item.revision.commitId })}
                      onDragStart={origin => sendAction({ type: 'drag.start', origin })}
                      onDrop={event => dropOn(event, item.revision)}
                      onToggle={() => activateRevisionRow(item.revision)}
                      onDescribe={() => {
                        setSelection({ commitId: item.revision.commitId, changeId: item.revision.changeId })
                        setEditingDescription(item.revision.commitId)
                      }}
                      rowHeight={rowHeight}
                      revision={item.revision}
                      metrics={graphMetrics}
                    >
                      {selectedRevision?.commitId === item.revision.commitId && revisionDetails(item.revision)}
                      {rowDropPresentation !== null && dropPreviewAt(item.revision)}
                      {rowConfirmAnchorId === item.revision.commitId && inlineConfirm}
                      {workspaceRemoval?.commitId === item.revision.commitId && inlineRemoval}
                      {workspaceBase?.commitId === item.revision.commitId && inlineProvisioner}
                      {bookmarkDraft?.commitId === item.revision.commitId && inlineBookmark}
                      {fullDiff?.commitId === item.revision.commitId && inlineDiff}
                    </RevisionRow>
                  )}
                </div>
              )
            })}
          </div>
          {graphPagePending && (
            <div className="dshx:flex dshx:items-center dshx:justify-center dshx:gap-2 dshx:p-3 dshx:text-xs dshx:text-muted-foreground" role="status">
              <Spinner className="dshx:size-3" />
              {debouncedSearch.length > 0 ? 'Searching all revisions…' : 'Loading older revisions…'}
            </div>
          )}
          {visibleRevisions.length === 0 && !graphPagePending && (
            <Empty className="dshx:gap-2 dshx:p-6 dshx:md:p-6">
              <EmptyHeader>
                <EmptyTitle className="dshx:text-sm">No revisions match these filters.</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </>
    )

  const openInNewTab = (): void => {
    PanelScopes.requestTab({ scope: PanelScopes.newMainTab(), path: shownRoot })
  }

  const emptyState = repositoryStatus.showEmptyPrompt ? (
    <Empty className="dshx:gap-2 dshx:p-6 dshx:md:p-6">
      <EmptyHeader>
        <EmptyTitle className="dshx:text-sm dshx:font-normal dshx:text-muted-foreground">Choose a repository to open its revision graph.</EmptyTitle>
        <Button className="dshx:mt-2" onClick={() => setPickerOpen(true)} size="sm" type="button" variant="outline">
          <FolderGit2Icon />
          Choose repository…
        </Button>
      </EmptyHeader>
    </Empty>
  ) : null

  const tabsContent = (
    <>
      <TabsContent className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col" value="graph">
        {emptyState ?? graphView}
      </TabsContent>
      <TabsContent className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col" value="source">
        {emptyState ??
          (state !== undefined && repoId !== null && (
            <SourceControlView
              ancestorCount={preferences.ancestorCount}
              busy={busy}
              fileView={preferences.fileView}
              onAction={askForConfirmation}
              onAncestorCountChange={count => setPreference('ancestorCount', count)}
              onFileViewChange={value => setPreference('fileView', value)}
              onOpenDiff={openFullDiff}
              onRefresh={refreshRepository}
              refreshOptions={autoRefresh.queryOptions}
              repoId={repoId}
              repositoryRoot={state.root}
              revisions={state.revisions}
            />
          ))}
      </TabsContent>
    </>
  )

  return (
    <main
      ref={autoRefresh.ref}
      className="dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:overflow-hidden dshx:bg-background dshx:text-foreground"
    >
      <TooltipProvider>
        <Tabs className="dshx:min-h-0 dshx:flex-1 dshx:gap-0" onValueChange={value => setView(value === 'source' ? 'source' : 'graph')} value={view}>
          <header className="dshx:flex dshx:flex-none dshx:flex-col dshx:gap-2 dshx:border-b dshx:px-3 dshx:pt-2 dshx:pb-2.5">
            {!sidePanel && (
              <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5 dshx:pt-1">
                <h1 className="dshx:text-xl dshx:font-semibold">Jujutsu</h1>
                <p className="dshx:truncate dshx:font-mono dshx:text-xs dshx:text-muted-foreground">
                  {state?.root ?? 'Select a repository to inspect its revision graph.'}
                </p>
              </div>
            )}
            <div className="dshx:flex dshx:items-center dshx:gap-2">
              <TabsList aria-label="Jujutsu views" className="dshx:h-9 dshx:gap-4 dshx:rounded-none dshx:border-b dshx:p-0" variant="line">
                <TabsTrigger
                  className="dshx:h-full dshx:flex-none dshx:rounded-none dshx:px-0.5 dshx:after:bottom-[-1px] dshx:after:bg-primary dshx:data-[state=active]:font-semibold"
                  value="graph"
                >
                  Revision graph
                </TabsTrigger>
                <TabsTrigger
                  className="dshx:h-full dshx:flex-none dshx:rounded-none dshx:px-0.5 dshx:after:bottom-[-1px] dshx:after:bg-primary dshx:data-[state=active]:font-semibold"
                  value="source"
                >
                  Source Control
                </TabsTrigger>
              </TabsList>
              <span aria-live="polite" className="dshx:flex dshx:size-6 dshx:items-center dshx:justify-center" role="status">
                {loadingRepository && (
                  <>
                    <Spinner aria-hidden="true" className="dshx:size-3" />
                    <span className="dshx:sr-only">Loading repository…</span>
                  </>
                )}
              </span>
              <div className="dshx:ml-auto dshx:flex dshx:items-center dshx:gap-1">
                {props.surface === 'main' ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label="Open this repository in a new tab"
                        disabled={shownRoot === null}
                        onClick={openInNewTab}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <CopyPlusIcon />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Open this repository in a new tab</TooltipContent>
                  </Tooltip>
                ) : null}
                <PreferencesMenu />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button aria-label="Repository actions" size="icon-sm" type="button" variant="outline">
                      <EllipsisVerticalIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="dshx-root dshx:w-64">
                    <DropdownMenuLabel className="dshx:text-xs dshx:text-muted-foreground">Remote</DropdownMenuLabel>
                    {remoteNames.length === 0 ? (
                      <p className="dshx:px-2 dshx:pb-1.5 dshx:text-xs dshx:text-muted-foreground">No remotes configured.</p>
                    ) : (
                      <DropdownMenuRadioGroup onValueChange={setRemote} value={selectedRemote}>
                        {remoteNames.map(name => (
                          <DropdownMenuRadioItem className="dshx:font-mono dshx:text-xs" key={name} value={name}>
                            {name}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="dshx:text-xs dshx:text-muted-foreground">Bookmark to push</DropdownMenuLabel>
                    {localBookmarkNames.length === 0 ? (
                      <p className="dshx:px-2 dshx:pb-1.5 dshx:text-xs dshx:text-muted-foreground">No local bookmarks.</p>
                    ) : (
                      <DropdownMenuRadioGroup onValueChange={setBookmark} value={selectedBookmark}>
                        {localBookmarkNames.map(name => (
                          <DropdownMenuRadioItem className="dshx:font-mono dshx:text-xs" key={name} value={name}>
                            {name}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    )}
                    {state !== undefined && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="dshx:text-xs"
                          disabled={emptyAncestors.length === 0 || busy}
                          onSelect={() => askForConfirmation({ kind: 'abandon', commitIds: emptyAncestors.map(revision => revision.commitId) })}
                        >
                          Clear empty ancestors ({emptyAncestors.length})
                        </DropdownMenuItem>
                        <DropdownMenuItem className="dshx:text-xs" disabled={busy} onSelect={() => setCleanupOpen(true)}>
                          Clean up JJ workspaces…
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <div className="dshx:flex dshx:flex-col dshx:gap-1 dshx:px-2 dshx:py-1.5 dshx:text-xs dshx:text-muted-foreground">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>Last recorded JJ push command: {lastPushLabel}</span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">{state.lastPushDescription ?? 'Reads JJ operation argv metadata only.'}</TooltipContent>
                          </Tooltip>
                          {state.evolutionHistoryTruncated && <span>Evolution scan limited; some evolved markers may be missing.</span>}
                        </div>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <div className="dshx:flex dshx:items-center dshx:gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label="Choose repository"
                    className="dshx:h-8 dshx:min-w-0 dshx:flex-1 dshx:justify-start dshx:gap-2 dshx:px-2 dshx:font-normal"
                    onClick={() => setPickerOpen(true)}
                    type="button"
                    variant="outline"
                  >
                    <FolderGit2Icon className="dshx:text-muted-foreground" />
                    {state !== undefined || path.length > 0 ? (
                      <>
                        <span className="dshx:flex-none dshx:font-medium">{repositoryName(state?.root ?? path)}</span>
                        <span className="dshx:min-w-0 dshx:truncate dshx:font-mono dshx:text-xs dshx:text-muted-foreground">{state?.root ?? path}</span>
                      </>
                    ) : (
                      <span className="dshx:text-muted-foreground">Choose repository…</span>
                    )}
                    <ChevronDownIcon className="dshx:ml-auto dshx:text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{state?.root ?? (path || 'Choose repository')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    disabled={repoId === null || selectedRemote === '' || busy}
                    onClick={() => askForConfirmation({ kind: 'fetch', remote: selectedRemote })}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Fetch
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{selectedRemote === '' ? 'No remote available' : `Fetch from ${selectedRemote}`}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    disabled={repoId === null || selectedRemote === '' || selectedBookmark === '' || busy}
                    onClick={() => askForConfirmation({ kind: 'push', remote: selectedRemote, bookmark: selectedBookmark })}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Push
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {selectedBookmark === '' ? 'No local bookmark to push' : `Push ${selectedBookmark} to ${selectedRemote}`}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-busy={busy}
                    aria-label="Refresh"
                    disabled={busy || repoId === null}
                    onClick={refreshRepository}
                    size="icon-sm"
                    type="button"
                    variant="outline"
                  >
                    {busy ? <Spinner /> : <RefreshCwIcon />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Refresh</TooltipContent>
              </Tooltip>
              {busy && !loadingRepository && (
                <span className="dshx:sr-only" role="status">
                  Working…
                </span>
              )}
            </div>
          </header>

          <WorkspaceCleanupTrail onFinished={refreshRepository} />

          {rowConfirmAnchorId === null && inlineConfirm !== null && <div className="dshx:border-b dshx:p-2">{inlineConfirm}</div>}
          {removalHidden && inlineRemoval !== null && <div className="dshx:border-b dshx:p-2">{inlineRemoval}</div>}
          {(provisionerHidden || bookmarkHidden || diffHidden) && (
            <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:border-b dshx:p-2">
              {provisionerHidden && inlineProvisioner}
              {bookmarkHidden && inlineBookmark}
              {diffHidden && inlineDiff}
            </div>
          )}

          {(errorMessages.length > 0 || copyNotice !== null || provisionedPath !== null || (confirmResult !== null && confirmResult.output.length > 0)) && (
            <div className="dshx:flex dshx:max-h-48 dshx:flex-none dshx:flex-col dshx:gap-1.5 dshx:overflow-auto dshx:border-b dshx:px-3 dshx:py-2">
              {errorMessages.map(message => {
                const repositoryError = stateQuery.error !== null || registerMutation.error !== null
                return (
                  <Alert className="dshx:px-3 dshx:py-2" key={message} variant="destructive">
                    <AlertDescription className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs">
                      <span className="dshx:min-w-0 dshx:flex-1">{message}</span>
                      {repositoryError && (
                        <Button onClick={() => setPickerOpen(true)} size="xs" type="button" variant="outline">
                          Choose another repository
                        </Button>
                      )}
                    </AlertDescription>
                  </Alert>
                )
              })}
              {provisionedPath !== null && (
                <Alert className="dshx:px-3 dshx:py-2" variant="success">
                  <AlertDescription className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:font-mono dshx:text-foreground">Created: {provisionedPath}</span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">{provisionedPath}</TooltipContent>
                    </Tooltip>
                    <Button
                      disabled={launchMutation.isPending}
                      onClick={() => launchMutation.mutate(provisionedPath)}
                      size="xs"
                      type="button"
                      variant="outline"
                    >
                      {launchMutation.isPending ? 'Opening…' : 'Open a DSH Session here'}
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
              {copyNotice !== null && (
                <Alert className="dshx:px-3 dshx:py-2" role={copyNotice.copied ? 'status' : 'alert'} variant={copyNotice.copied ? 'default' : 'destructive'}>
                  <AlertDescription className="dshx:text-xs">
                    {copyNotice.copied ? `${copyNotice.label} copied.` : `Could not copy ${copyNotice.label.toLocaleLowerCase()}.`}
                  </AlertDescription>
                </Alert>
              )}
              {confirmResult !== null && confirmResult.output.length > 0 && (
                <Alert className="dshx:px-3 dshx:py-2">
                  <AlertDescription>
                    <pre className="dshx:max-h-40 dshx:w-full dshx:overflow-auto dshx:font-mono dshx:text-[11px] dshx:whitespace-pre-wrap dshx:text-foreground">
                      {confirmResult.output}
                    </pre>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {tabsContent}
        </Tabs>

        {pickerOpen && (
          <ProjectFolderPicker
            directoryPicker={props.directoryPicker}
            heading="Choose a Jujutsu repository"
            onClose={() => setPickerOpen(false)}
            onRegisterWorkspace={props.registerWorkspace}
            onSelect={selected => {
              setPickerOpen(false)
              autoRegisterPath.current = selected.canonicalPath
              setRepoId(null)
              setPath(selected.canonicalPath)
              registerMutation.mutate(selected.canonicalPath)
            }}
            projects={props.projects}
            recentFolders={repoHistory}
          />
        )}

        {state !== undefined && <WorkspaceCleanupDialog onCleaned={refreshRepository} onOpenChange={setCleanupOpen} open={cleanupOpen} path={state.root} />}
      </TooltipProvider>
    </main>
  )
}

const PreferencesMenu = (): JSX.Element => {
  const [preferences, setPreference] = usePreferences()
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button aria-label="Jujutsu view settings" size="icon-sm" type="button" variant="ghost">
              <Settings2Icon />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">View settings</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="dshx-root dshx:w-60">
        <DropdownMenuLabel className="dshx:text-xs dshx:text-muted-foreground">Saved in this browser</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={preferences.chatReferenceLinks}
          className="dshx:text-xs"
          onCheckedChange={checked => setPreference('chatReferenceLinks', checked)}
        >
          Open Jujutsu refs from chat
        </DropdownMenuCheckboxItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="dshx:text-xs">
            Chat reference click ({preferences.chatReferenceClickBehavior === 'focus' ? 'focus revision' : 'show path'})
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="dshx-root">
            <DropdownMenuRadioGroup
              onValueChange={value => {
                if (value === 'focus' || value === 'path') setPreference('chatReferenceClickBehavior', value)
              }}
              value={preferences.chatReferenceClickBehavior}
            >
              <DropdownMenuRadioItem className="dshx:text-xs" value="focus">
                Focus revision
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem className="dshx:text-xs" value="path">
                Compare with main/default and show history path
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="dshx:text-xs">Default tab</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="dshx-root">
            <DropdownMenuRadioGroup
              onValueChange={value => setPreference('defaultView', value === 'source' ? 'source' : 'graph')}
              value={preferences.defaultView}
            >
              <DropdownMenuRadioItem className="dshx:text-xs" value="graph">
                Revision graph
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem className="dshx:text-xs" value="source">
                Source Control
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="dshx:text-xs">Ancestor groups (@-{preferences.ancestorCount})</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="dshx-root">
            <DropdownMenuRadioGroup onValueChange={value => setPreference('ancestorCount', Number(value))} value={String(preferences.ancestorCount)}>
              {ANCESTOR_COUNT_OPTIONS.map(option => (
                <DropdownMenuRadioItem className="dshx:text-xs" key={option} value={String(option)}>
                  {option}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={preferences.fileView === 'tree'}
          className="dshx:text-xs"
          onCheckedChange={checked => setPreference('fileView', checked ? 'tree' : 'flat')}
        >
          Changed files as tree
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={preferences.diffExpanded}
          className="dshx:text-xs"
          onCheckedChange={checked => setPreference('diffExpanded', checked)}
        >
          Expand patch by default
        </DropdownMenuCheckboxItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="dshx:text-xs">Diff layout ({preferences.diffLayout})</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="dshx-root">
            <DropdownMenuRadioGroup
              onValueChange={value => {
                if (value === 'auto' || value === 'unified' || value === 'split') setPreference('diffLayout', value)
              }}
              value={preferences.diffLayout}
            >
              <DropdownMenuRadioItem className="dshx:text-xs" value="auto">
                Auto
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem className="dshx:text-xs" value="unified">
                Unified
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem className="dshx:text-xs" value="split">
                Split
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="dshx:text-xs">Graph density ({preferences.graphDensity})</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="dshx-root">
            <DropdownMenuRadioGroup
              onValueChange={value => setPreference('graphDensity', value === 'compact' ? 'compact' : 'comfortable')}
              value={preferences.graphDensity}
            >
              <DropdownMenuRadioItem className="dshx:text-xs" value="comfortable">
                Comfortable
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem className="dshx:text-xs" value="compact">
                Compact
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="dshx:text-xs">Revision date</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="dshx-root">
            <DropdownMenuRadioGroup
              onValueChange={value => setPreference('revisionDate', value === 'created' || value === 'both' ? value : 'edited')}
              value={preferences.revisionDate}
            >
              <DropdownMenuRadioItem className="dshx:text-xs" value="edited">
                Last edited
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem className="dshx:text-xs" value="created">
                Created
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem className="dshx:text-xs" value="both">
                Last edited and created
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuCheckboxItem
          checked={preferences.dateHeadings}
          className="dshx:text-xs"
          onCheckedChange={checked => setPreference('dateHeadings', checked)}
        >
          Group revisions by day
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={preferences.hideImmutable}
          className="dshx:text-xs"
          onCheckedChange={checked => setPreference('hideImmutable', checked)}
        >
          Hide immutable revisions
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={preferences.mineOnly} className="dshx:text-xs" onCheckedChange={checked => setPreference('mineOnly', checked)}>
          Show only my revisions
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const fullRevisionId = (revision: Revision): string => {
  const changeId = reverseHexChangeId(revision.changeId, revision.changeId.length)
  return revision.divergent ? `${changeId}/${revision.changeOffset}` : changeId
}

interface InlineDropPreviewProps {
  readonly presentation: DropPresentation
  readonly sourceLabel: string
  readonly destinationLabel: string
  readonly branch: readonly Revision[]
  readonly preview: ActionPreview | undefined
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

const InlineDropPreview = (props: InlineDropPreviewProps): JSX.Element => (
  <section
    aria-label={props.presentation.kind === 'rebase' ? 'Preview branch rebase' : 'Preview bookmark move'}
    className="dshx-root dshx:mt-2 dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-md dshx:border dshx:border-primary/40 dshx:bg-primary/5 dshx:p-3"
    role="group"
  >
    <div className="dshx:flex dshx:flex-wrap dshx:items-baseline dshx:gap-1.5 dshx:text-xs">
      <strong>{props.presentation.kind === 'rebase' ? 'Rebase branch' : `Move bookmark “${props.presentation.bookmark}”`}</strong>
      <span className="dshx:text-muted-foreground">from</span>
      <code className="dshx:font-mono!">{props.sourceLabel}</code>
      <span className="dshx:text-muted-foreground">onto</span>
      <code className="dshx:font-mono!">{props.destinationLabel}</code>
    </div>
    {props.presentation.kind === 'rebase' && (
      <ol aria-label="Revisions in branch" className="dshx:flex dshx:max-h-32 dshx:flex-col dshx:gap-1 dshx:overflow-auto dshx:pl-5 dshx:text-xs">
        {props.branch.map(revision => (
          <li className="dshx:flex dshx:gap-2" key={revision.commitId}>
            <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{firstLine(revision.description)}</span>
            <code className="dshx:flex-none dshx:font-mono! dshx:text-muted-foreground">{revision.shortestChangeId}</code>
          </li>
        ))}
      </ol>
    )}
    <p className="dshx:text-xs dshx:text-muted-foreground" role="status">
      {props.preview?.summary ?? 'Preparing a state-bound preview…'}
    </p>
    {props.preview !== undefined && (
      <pre className="dshx:max-h-40 dshx:overflow-auto dshx:rounded-sm dshx:bg-muted dshx:p-2 dshx:font-mono! dshx:text-[11px] dshx:whitespace-pre-wrap">
        {props.preview.detail}
      </pre>
    )}
    <div className="dshx:flex dshx:justify-end dshx:gap-2">
      <Button onClick={props.onCancel} size="sm" type="button" variant="outline">
        Cancel
      </Button>
      <Button disabled={props.preview === undefined || props.busy} onClick={props.onConfirm} size="sm" type="button">
        {props.presentation.kind === 'rebase' ? 'Rebase revision' : 'Move bookmark'}
      </Button>
    </div>
  </section>
)

interface RevisionRowProps {
  readonly revision: Revision
  readonly expanded: boolean
  readonly dimmed: boolean
  readonly connectionDimmed: boolean
  readonly highlighted: boolean
  readonly dropTarget: boolean
  readonly graphLayout: RevisionGraphRow
  readonly graphWidth: number
  readonly metrics: GraphMetrics
  readonly rowHeight: number
  readonly editedAt: string | undefined
  readonly revisionDate: RevisionDate
  readonly menu: ReactNode
  readonly bookmarkMenu: (name: string, local: boolean) => ReactNode
  readonly workspaceMenu: (name: string, commitId: string) => ReactNode
  readonly onToggle: () => void
  readonly onDescribe: () => void
  readonly onDragStart: (origin: DragOrigin) => void
  readonly onDragEnter: (event: DragEvent) => void
  readonly onDragLeave: () => void
  readonly onDrop: (event: DragEvent) => void
  readonly children: ReactNode
}

/** One line at every width: labels, then the truncated description, then fixed time and change-ID columns. */
const RevisionRow = (props: RevisionRowProps): JSX.Element => {
  const revision = props.revision
  const draggable = !revision.immutable
  const described = revision.description.trim().length > 0
  const changeId = reverseHexChangeId(revision.changeId, Math.max(3, revision.shortestChangeId.length))
  const workspaceLabels = revision.workingCopy && revision.workspaces.length === 0 ? ['default'] : revision.workspaces
  const workspaceLabel = (workspace: string): JSX.Element => (
    <span
      className={cn(
        'dshx:inline-flex dshx:h-4 dshx:max-w-40 dshx:flex-none dshx:items-center dshx:gap-1 dshx:rounded-full dshx:px-1.5 dshx:text-[11px] dshx:font-medium dshx:text-background',
        revision.workingCopy ? 'dshx:bg-info' : 'dshx:bg-teal',
      )}
      onContextMenu={event => event.stopPropagation()}
    >
      <MonitorIcon aria-hidden className="dshx:size-3 dshx:flex-none" />
      <span className="dshx:truncate">{workspace}</span>
    </span>
  )
  const workspaceHint = (workspace: string): string =>
    revision.workingCopy ? `Working copy of workspace ${workspace} · right-click for actions` : `Workspace ${workspace} · right-click for actions`
  const labels = (
    <>
      {workspaceLabels.map(workspace =>
        workspace === 'default' ? (
          <Tooltip key={workspace}>
            <TooltipTrigger asChild>
              <span>{workspaceLabel(workspace)}</span>
            </TooltipTrigger>
            <TooltipContent side="bottom">{workspaceHint(workspace)}</TooltipContent>
          </Tooltip>
        ) : (
          <ContextMenu key={workspace}>
            <Tooltip>
              <TooltipTrigger asChild>
                <ContextMenuTrigger asChild>{workspaceLabel(workspace)}</ContextMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">{workspaceHint(workspace)}</TooltipContent>
            </Tooltip>
            {props.workspaceMenu(workspace, revision.commitId)}
          </ContextMenu>
        ),
      )}
      {revision.bookmarks.map(name => {
        const local = revision.localBookmarks.includes(name)
        return (
          <ContextMenu key={name}>
            <Tooltip>
              <TooltipTrigger asChild>
                <ContextMenuTrigger asChild>
                  <span
                    className={cn(
                      'dshx:h-4 dshx:max-w-40 dshx:flex-none dshx:truncate dshx:rounded-sm dshx:border dshx:px-1 dshx:font-mono dshx:text-[11px] dshx:leading-[14px] dshx:font-medium',
                      local
                        ? 'dshx:cursor-grab dshx:border-foreground/45 dshx:text-foreground'
                        : 'dshx:border-dashed dshx:border-muted-foreground/50 dshx:text-muted-foreground',
                    )}
                    draggable={local}
                    onContextMenu={event => event.stopPropagation()}
                    onDragStart={event => {
                      event.stopPropagation()
                      event.dataTransfer.setData(BOOKMARK_MIME, name)
                      event.dataTransfer.setData(BOOKMARK_SOURCE_MIME, revision.commitId)
                      event.dataTransfer.effectAllowed = 'move'
                      props.onDragStart({ kind: 'bookmark', sourceId: revision.commitId, bookmark: name })
                    }}
                  >
                    {name}
                  </span>
                </ContextMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {local ? `Bookmark ${name} · drag onto a revision to move · right-click for actions` : `Remote bookmark ${name}`}
              </TooltipContent>
            </Tooltip>
            {props.bookmarkMenu(name, local)}
          </ContextMenu>
        )
      })}
      {revision.tags.map(name => (
        <Tooltip key={name}>
          <TooltipTrigger asChild>
            <span className="dshx:h-4 dshx:max-w-32 dshx:flex-none dshx:truncate dshx:rounded-sm dshx:border dshx:border-warning/60 dshx:px-1 dshx:font-mono dshx:text-[11px] dshx:leading-[14px] dshx:text-warning">
              {name}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">{`Tag ${name}`}</TooltipContent>
        </Tooltip>
      ))}
      {revision.divergent && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="dshx:flex-none dshx:text-[11px] dshx:text-violet">divergent</span>
          </TooltipTrigger>
          <TooltipContent side="bottom">Divergent: several visible commits share this change ID</TooltipContent>
        </Tooltip>
      )}
    </>
  )
  return (
    <article
      className={cn(
        'dshx:group/row dshx:relative dshx:@container',
        props.expanded && 'dshx:bg-muted-foreground/[0.07]',
        props.dimmed && 'dshx:opacity-40',
        props.highlighted && 'dshx:bg-primary/10',
      )}
      data-commit-id={revision.commitId}
      data-connection-dimmed={props.connectionDimmed || undefined}
      data-highlighted={props.highlighted || undefined}
      onDragEnter={props.onDragEnter}
      onDragLeave={event => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) props.onDragLeave()
      }}
      onDragOver={event => {
        if (hasDragType(event, REVISION_MIME) || hasDragType(event, BOOKMARK_MIME)) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
        }
      }}
      onDrop={props.onDrop}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              'dshx:flex dshx:items-start dshx:pr-2 dshx:hover:bg-accent',
              props.dropTarget && 'dshx:bg-primary/10 dshx:ring-1 dshx:ring-primary dshx:ring-inset',
            )}
            draggable={draggable}
            onDragStart={event => {
              event.dataTransfer.setData(REVISION_MIME, revision.commitId)
              event.dataTransfer.effectAllowed = 'move'
              props.onDragStart({ kind: 'revision', sourceId: revision.commitId })
            }}
            style={{ height: props.rowHeight }}
          >
            <RevisionGraphCell height={props.rowHeight} layout={props.graphLayout} metrics={props.metrics} revision={revision} width={props.graphWidth} />
            <div className={cn('dshx:flex dshx:h-full dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-1.5', props.connectionDimmed && 'dshx:opacity-40')}>
              <ChevronRightIcon
                aria-hidden
                className={cn(
                  'dshx:size-3 dshx:flex-none dshx:cursor-pointer dshx:text-muted-foreground dshx:transition-transform',
                  props.expanded ? 'dshx:rotate-90' : 'dshx:opacity-0 dshx:group-hover/row:opacity-100 dshx:group-focus-within/row:opacity-100',
                )}
                onClick={props.onToggle}
              />
              {labels}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    aria-expanded={props.expanded}
                    className="dshx:flex dshx:h-full dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-1.5 dshx:overflow-hidden dshx:text-left dshx:text-[13px] dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50"
                    data-row-focus=""
                    onClick={props.onToggle}
                    type="button"
                  >
                    {revision.conflict && <span className="dshx:sr-only">Conflict:</span>}
                    {revision.empty && <span className="dshx:flex-none dshx:text-muted-foreground dshx:italic">(empty)</span>}
                    {described ? (
                      <span
                        className={cn(
                          'dshx:min-w-0 dshx:truncate',
                          revision.workingCopy && 'dshx:font-medium',
                          revision.immutable && 'dshx:text-muted-foreground',
                        )}
                      >
                        {firstLine(revision.description)}
                      </span>
                    ) : (
                      <span className="dshx:min-w-0 dshx:truncate dshx:text-muted-foreground dshx:italic">(no description)</span>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {draggable ? 'Drag onto another revision to rebase · right-click for actions' : 'Right-click for actions'}
                </TooltipContent>
              </Tooltip>
              {!described && !revision.immutable && (
                <button
                  className="dshx:flex-none dshx:rounded-sm dshx:bg-muted dshx:px-1.5 dshx:text-[11px] dshx:text-muted-foreground dshx:opacity-0 dshx:outline-none dshx:group-hover/row:opacity-100 dshx:hover:text-foreground dshx:focus-visible:opacity-100 dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50"
                  onClick={props.onDescribe}
                  type="button"
                >
                  Describe
                </button>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <time
                    className={cn(
                      'dshx:flex-none dshx:text-right dshx:text-[11px] dshx:text-muted-foreground/80 dshx:tabular-nums dshx:@max-xs:hidden',
                      props.revisionDate === 'both' ? 'dshx:w-16' : 'dshx:w-8',
                    )}
                    dateTime={props.revisionDate === 'created' ? revision.authorTime : (props.editedAt ?? revision.authorTime)}
                  >
                    {formatAge(props.revisionDate === 'created' ? revision.authorTime : (props.editedAt ?? revision.authorTime))}
                    {props.revisionDate === 'both' && props.editedAt !== undefined && (
                      <span className="dshx:text-muted-foreground/50"> · {formatAge(revision.authorTime)}</span>
                    )}
                  </time>
                </TooltipTrigger>
                <TooltipContent side="bottom">{revisionDates(revision, props.editedAt)}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span aria-hidden className="dshx:w-12 dshx:flex-none dshx:text-right">
                    <span className="dshx:rounded-sm dshx:bg-muted-foreground/15 dshx:px-1 dshx:py-px dshx:font-mono dshx:text-[10px]">
                      <span className={revision.immutable ? 'dshx:text-muted-foreground' : 'dshx:font-semibold dshx:text-foreground/85'}>
                        {changeId.slice(0, revision.shortestChangeId.length)}
                      </span>
                      <span className="dshx:text-muted-foreground">{changeId.slice(revision.shortestChangeId.length)}</span>
                      {revision.divergent && <span className="dshx:text-violet">/{revision.changeOffset}</span>}
                    </span>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">{fullRevisionId(revision) + (revision.evolved ? ' · rewritten from an earlier commit' : '')}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </ContextMenuTrigger>
        {props.menu}
      </ContextMenu>
      {props.expanded && (
        <div className="dshx:relative" style={{ paddingLeft: props.graphWidth + 18 }}>
          <GraphLanes lanes={props.graphLayout.bottomLanes} metrics={props.metrics} width={props.graphWidth} />
          {props.children}
        </div>
      )}
    </article>
  )
}
