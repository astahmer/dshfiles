import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { ISessions, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { relativeTime, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@dshfiles/plugin-ui/components/ui/alert-dialog'
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
  ContextMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/context-menu'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
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
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import {
  ArrowDownIcon,
  BookmarkIcon,
  CalendarIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisVerticalIcon,
  FolderGit2Icon,
  GripVerticalIcon,
  LayersIcon,
  LocateFixedIcon,
  PencilIcon,
  RefreshCwIcon,
  SearchIcon,
  Settings2Icon,
  TagIcon,
  TriangleAlertIcon,
  UserIcon,
} from '@dshfiles/plugin-ui/icons'
import { PatchView, type PatchLayout } from '@dshfiles/plugin-ui/diff'
import { defaultRangeExtractor, useVirtualizer } from '@dshfiles/plugin-ui/virtual'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useMachine } from '@dshfiles/plugin-ui/machine'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { ProjectFolderPicker, type DirectoryPickerPort, type RegisteredProject } from '@dshfiles/project-folder-picker'
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import { z } from 'zod'
import type { Mutation, ReadFailure, Revision } from './api.js'
import { ChangedFiles, FileViewToggle, LineCounts } from './changed-files.js'
import { FullDiffDialog } from './full-diff-dialog.js'
import {
  describeDraftChanged,
  groupRevisionsByBranch,
  layoutRevisionGraph,
  matchesRevisionSearch,
  type GraphLane,
  type GraphTone,
  type RevisionGraphRow,
} from './graph.js'
import { jujutsuApi } from './api.js'
import { useAutoRefresh } from './auto-refresh.js'
import { openInEditor } from './open-in-editor.js'
import { activeDayIndex, flattenRevisionGroups } from './revision-list.js'
import { revisionActionMachine, type ActionPreview, type DropPresentation, type DragOrigin } from './revision-action-machine.js'
import { BOOKMARK_MIME, BOOKMARK_SOURCE_MIME, resolveBookmarkDrop, resolveRevisionDrop, REVISION_MIME } from './revision-drop.js'
import { repositoryLoadingState } from './repository-loading.js'
import { ANCESTOR_COUNT_OPTIONS, REVISION_LIMIT_OPTIONS, usePreferences, type GraphDensity } from './preferences.js'
import { isFileReviewed, readReviewStore, reviewProgress, toggleFileReview, type ReviewFile, type ReviewStore } from './review-progress.js'
import { SessionForkPanel } from './session-fork-panel.js'
import { descendantCommitIds, emptyAncestorCandidates } from './source-control.js'
import { SourceControlView } from './source-control-view.js'
import { WorkspaceProvisioner } from './workspace-provisioner.js'
import { WorkspaceRestorePanel } from './workspace-restore-panel.js'
import { containsPath, sidePanelRepository } from './side-panel-repository.js'

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
  readonly surface?: 'main' | 'side-panel'
  readonly sessions: ISessions
  readonly projects: readonly RegisteredProject[]
  readonly directoryPicker: DirectoryPickerPort
  readonly registerWorkspace: (canonicalPath: string) => Promise<RegisteredProject>
  readonly openSession: (sessionId: SessionSummary['id']) => void
  readonly pickDirectory: () => Promise<string | null>
  readonly launchSession: (cwd: string) => Promise<void>
}

const REPO_HISTORY_KEY = 'dshfiles.jujutsu.repositories'
const SELECTED_REPO_KEY = 'dshfiles.jujutsu.selected'
const REVIEW_PROGRESS_KEY = 'dshfiles.jujutsu.review-progress.v1'
const REPO_HISTORY_LIMIT = 12

const CODE_BLOCK =
  'dshx:max-h-80 dshx:overflow-auto dshx:rounded-md dshx:border dshx:bg-muted/40 dshx:p-2 dshx:font-mono dshx:text-[11px] dshx:leading-snug dshx:whitespace-pre'
const DISCLOSURE_TRIGGER =
  'dshx:group/disclosure dshx:flex dshx:items-center dshx:gap-1 dshx:py-1 dshx:text-[11px] dshx:font-semibold dshx:uppercase dshx:tracking-wide dshx:text-muted-foreground dshx:hover:text-foreground'

const COMPACT_BADGE = 'dshx:h-4 dshx:max-w-40 dshx:rounded-sm dshx:px-1.5 dshx:py-0 dshx:font-mono dshx:text-[10px] dshx:leading-none'

const storedRepoHistory = createStoredValue({ key: REPO_HISTORY_KEY, schema: z.array(z.string()), fallback: [] })
const storedRepoPath = createStoredValue({ key: SELECTED_REPO_KEY, schema: z.string(), fallback: '' })

const jujutsuKeys = {
  repository: (repoId: string) => ['jujutsu', repoId] as const,
  state: (repoId: string, limit: number) => ['jujutsu', repoId, 'state', limit] as const,
  details: (repoId: string, commitId: string) => ['jujutsu', repoId, 'details', commitId] as const,
}

const throwReadFailure = <Output extends object>(result: Output | ReadFailure): Output => {
  if ('failure' in result) throw new Error(result.failure.message)
  return result
}

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

/** Consecutive runs of one day, so headings never reorder the graph rows they sit between. */
const groupRows = (revisions: readonly Revision[], byDay: boolean): readonly { readonly day: string; readonly rows: readonly Revision[] }[] => {
  if (!byDay) return [{ day: '', rows: revisions }]
  const groups: { day: string; rows: Revision[] }[] = []
  for (const revision of revisions) {
    const day = dayLabel(revision.authorTime)
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
  const [path, setPath] = useState(() => (sidePanel ? sidePanelRepository.takePending() : null) ?? storedRepoPath.get())
  const [repoId, setRepoId] = useState<string | null>(null)
  const [repoHistory, setRepoHistory] = useState(() => storedRepoHistory.get().slice(0, REPO_HISTORY_LIMIT))
  const [pickerOpen, setPickerOpen] = useState(false)
  const [chosenView, setView] = useState<View | null>(null)
  const view = chosenView ?? preferences.defaultView
  const [authorFilter, setAuthorFilter] = useState('')
  const [textFilter, setTextFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [showSearch, setShowSearch] = useState(!sidePanel)
  const [showDates, setShowDates] = useState(false)
  const [collapsedDays, setCollapsedDays] = useState<ReadonlySet<string>>(() => new Set())
  const [selection, setSelection] = useState<RevisionSelection | null>(null)
  const [editingDescription, setEditingDescription] = useState<string | null>(null)
  const [reviewStore, setReviewStore] = useState<ReviewStore>(() => {
    try {
      return readReviewStore(localStorage.getItem(REVIEW_PROGRESS_KEY))
    } catch {
      return readReviewStore(null)
    }
  })
  const [hideReviewedFiles, setHideReviewedFiles] = useState(false)
  const [reviewNotice, setReviewNotice] = useState('')
  const [describeDrafts, setDescribeDrafts] = useState<Readonly<Record<string, string>>>({})
  const [remote, setRemote] = useState('')
  const [bookmark, setBookmark] = useState('')
  const [provisionedPath, setProvisionedPath] = useState<string | null>(null)
  const [fullDiff, setFullDiff] = useState<FullDiffTarget | null>(null)
  const [bookmarkDraft, setBookmarkDraft] = useState<{ readonly commitId: string; readonly name: string } | null>(null)
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
    const settled = actionActor.on('settled', event => void queryClient.invalidateQueries({ queryKey: jujutsuKeys.repository(event.repoId) }))
    return () => {
      confirmed.unsubscribe()
      settled.unsubscribe()
    }
  }, [actionActor, queryClient])

  const registerMutation = useMutation({
    mutationFn: (repositoryPath: string) => api.registerRepository({ path: repositoryPath }),
    onSuccess: registered => {
      sendAction({ type: 'reset' })
      setProvisionedPath(null)
      setRepoId(registered.repoId)
      setPath(registered.root)
      setSelection(null)
      setMoveSource(null)
      setDescribeDrafts({})
      setFullDiff(null)
      const nextHistory = [registered.root, ...repoHistory.filter(item => item !== registered.root)].slice(0, REPO_HISTORY_LIMIT)
      setRepoHistory(nextHistory)
      storedRepoHistory.set(nextHistory)
      storedRepoPath.set(registered.root)
      void queryClient.invalidateQueries({ queryKey: jujutsuKeys.repository(registered.repoId) })
    },
  })

  const autoRefresh = useAutoRefresh({
    preferences,
    paused: registerMutation.isPending || actionBusy || preview !== undefined,
    onBecameVisible: () => {
      if (repoId !== null) void queryClient.invalidateQueries({ queryKey: jujutsuKeys.repository(repoId) })
    },
  })

  const stateQuery = useQuery({
    queryKey: jujutsuKeys.state(repoId ?? '', preferences.revisionLimit),
    queryFn: async ({ signal }) => throwReadFailure(await api.load({ repoId: repoId ?? '', limit: preferences.revisionLimit }, { signal })),
    enabled: repoId !== null,
    ...autoRefresh.queryOptions,
  })
  const state = stateQuery.data

  const selectedRevision = useMemo(() => {
    if (state === undefined || selection === null) return undefined
    return state.revisions.find(row => row.commitId === selection.commitId) ?? state.revisions.find(row => row.changeId === selection.changeId)
  }, [state, selection])

  const detailsQuery = useQuery({
    queryKey: jujutsuKeys.details(repoId ?? '', selectedRevision?.commitId ?? ''),
    queryFn: async ({ signal }) => throwReadFailure(await api.details({ repoId: repoId ?? '', commitId: selectedRevision?.commitId ?? '' }, { signal })),
    enabled: repoId !== null && selectedRevision !== undefined,
  })
  const details = detailsQuery.data
  const selectedReviewProgress = reviewProgress(reviewStore, state?.root ?? '', selectedRevision?.commitId ?? '', details?.files ?? [])

  const fullDiffQuery = useQuery({
    queryKey: jujutsuKeys.details(repoId ?? '', fullDiff?.commitId ?? ''),
    queryFn: async ({ signal }) => throwReadFailure(await api.details({ repoId: repoId ?? '', commitId: fullDiff?.commitId ?? '' }, { signal })),
    enabled: repoId !== null && fullDiff !== null,
  })

  const shownRoot = state?.root ?? null
  useEffect(() => (sidePanel ? sidePanelRepository.show(shownRoot) : undefined), [sidePanel, shownRoot])
  const shownRootRef = useRef(shownRoot)
  shownRootRef.current = shownRoot
  useEffect(() => {
    if (!sidePanel) return
    return sidePanelRepository.onRequest(requested => {
      if (shownRootRef.current !== null && containsPath(shownRootRef.current, requested)) return
      autoRegisterPath.current = requested
      registerMutation.mutate(requested)
    })
  }, [sidePanel, registerMutation.mutate])

  useEffect(() => {
    const selectedPath = path.trim()
    if (repoId !== null || selectedPath.length === 0 || autoRegisterPath.current === selectedPath) return
    autoRegisterPath.current = selectedPath
    registerMutation.mutate(selectedPath)
  }, [path, repoId, registerMutation.mutate])

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
  const mainRevision = state?.revisions.find(revision => revision.localBookmarks.includes('main') || revision.bookmarks.includes('main'))

  const graphOrder = useMemo(() => groupRevisionsByBranch(state?.revisions ?? []), [state])
  const visibleRevisions = useMemo(() => {
    if (state === undefined) return []
    return graphOrder.filter(revision => {
      if (mineOnly && !revision.mine && !revision.workingCopy) return false
      if (hideImmutable && revision.immutable) return false
      if (authorFilter && !revision.author.toLocaleLowerCase().includes(authorFilter.toLocaleLowerCase())) return false
      const timestamp = Date.parse(revision.authorTime)
      if (fromDate && Number.isFinite(timestamp) && timestamp < Date.parse(fromDate + 'T00:00:00')) return false
      if (toDate && Number.isFinite(timestamp) && timestamp > Date.parse(toDate + 'T23:59:59')) return false
      return matchesRevisionSearch(revision, textFilter)
    })
  }, [state, graphOrder, mineOnly, hideImmutable, authorFilter, textFilter, fromDate, toDate])

  const revisionsByCommitId = useMemo(() => new Map(state?.revisions.map(revision => [revision.commitId, revision]) ?? []), [state])
  const graphRows = useMemo(() => {
    if (state === undefined) return []
    const graphRevisions = graphOrder.filter(revision => (!hideImmutable || !revision.immutable) && (!mineOnly || revision.mine || revision.workingCopy))
    return layoutRevisionGraph(graphRevisions, revisionsByCommitId, hideImmutable)
  }, [state, graphOrder, revisionsByCommitId, hideImmutable, mineOnly])
  const graphRowsByCommitId = useMemo(() => new Map(graphRows.map(row => [row.commitId, row])), [graphRows])
  const graphMetrics = GRAPH_DENSITY[preferences.graphDensity]
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
    return graphOrder.filter(revision => branchIds.has(revision.commitId))
  }, [dropPresentation, state, graphOrder])
  const previewBranchIds = useMemo(() => new Set(previewBranch.map(revision => revision.commitId)), [previewBranch])
  const dropSourceRevision = dropPresentation === null ? undefined : revisionsByCommitId.get(dropPresentation.sourceId)
  const dropDestinationRevision = dropPresentation === null ? undefined : revisionsByCommitId.get(dropPresentation.destinationId)

  const listItems = useMemo(() => flattenRevisionGroups({ groups, collapsedDays, layouts: graphRowsByCommitId }), [groups, collapsedDays, graphRowsByCommitId])
  const listScrollRef = useRef<HTMLDivElement | null>(null)
  const pendingFocusIndex = useRef<number | null>(null)
  const scrolledToWorkingCopy = useRef<string | null>(null)
  const dragSourceIndex = dragSource === null ? -1 : listItems.findIndex(item => item.key === dragSource)
  const workingCopyIndex = listItems.findIndex(item => item.kind === 'revision' && item.revision.workingCopy)
  const listVirtualizer = useVirtualizer({
    count: listItems.length,
    getScrollElement: () => listScrollRef.current,
    getItemKey: index => listItems[index]?.key ?? index,
    estimateSize: index => {
      const item = listItems[index]
      if (item === undefined || item.kind === 'day') return 18
      const rowHeight = rowHeightFor(graphMetrics, item.layout)
      return item.key === selectedRevision?.commitId ? rowHeight + 320 : rowHeight
    },
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
  const stickyDayIndex = activeDayIndex(listItems, listVirtualizer.range?.startIndex ?? 0)

  const scrollToWorkingCopy = (): void => {
    if (workingCopyIndex >= 0) listVirtualizer.scrollToIndex(workingCopyIndex, { align: 'center' })
  }

  useEffect(() => {
    if (repoId === null || workingCopyIndex < 0 || listScrollRef.current === null || scrolledToWorkingCopy.current === repoId) return
    scrolledToWorkingCopy.current = repoId
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
    if (!(event.target instanceof HTMLElement) || !event.target.hasAttribute('data-row-focus')) return
    const current = pendingFocusIndex.current ?? Number(event.target.closest('[data-index]')?.getAttribute('data-index'))
    if (!Number.isInteger(current)) return
    const last = listItems.length - 1
    const next =
      event.key === 'ArrowDown'
        ? Math.min(current + 1, last)
        : event.key === 'ArrowUp'
          ? Math.max(current - 1, 0)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null
    if (next === null) return
    event.preventDefault()
    pendingFocusIndex.current = next
    listVirtualizer.scrollToIndex(next, { align: 'auto' })
    focusPendingRow()
  }
  const emptyAncestors = useMemo(() => emptyAncestorCandidates(state?.revisions ?? []), [state])

  const errorMessages = [
    stateQuery.error && errorMessage(stateQuery.error, 'Could not load this repository.'),
    registerMutation.error && errorMessage(registerMutation.error, 'Could not register this repository.'),
    actionSnapshot.context.error,
  ].filter((message): message is string => Boolean(message))

  const askForConfirmation = (action: Mutation, presentation: DropPresentation | null = null): void => {
    if (repoId === null) return
    if (action.kind === 'workspace-add') setProvisionedPath(null)
    registerMutation.reset()
    sendAction({ type: 'prepare', repoId, action, presentation })
  }

  const chooseMoveDestination = (destination: Revision): void => {
    if (moveSource === null) return
    const source = moveSource
    setMoveSource(null)
    const resolution = resolveRevisionDrop({ sourceRevisionId: source.commitId, target: destination, revisions: state?.revisions ?? [] })
    if (resolution.kind === 'invalid') {
      sendAction({ type: 'reject', error: resolution.message })
      return
    }
    if (resolution.kind === 'action') askForConfirmation(resolution.action, resolution.presentation)
  }

  const confirmPreview = (): void => sendAction({ type: 'confirm' })

  const refreshRepository = (): void => {
    if (repoId !== null) void queryClient.invalidateQueries({ queryKey: jujutsuKeys.repository(repoId) })
  }

  const openFullDiff = (revision: Revision, focusPath: string | null): void =>
    setFullDiff({ commitId: revision.commitId, title: firstLine(revision.description) + ' · ' + revision.shortestChangeId, focusPath })

  const updateFileReviews = (changes: readonly { readonly file: ReviewFile; readonly reviewed: boolean }[]): void => {
    if (state === undefined || selectedRevision === undefined) return
    const reviewedAt = new Date().toISOString()
    const next = changes.reduce(
      (store, change) =>
        change.file.contentDigest === null
          ? store
          : toggleFileReview(
              store,
              { repositoryRoot: state.root, commitId: selectedRevision.commitId, path: change.file.path, contentDigest: change.file.contentDigest, reviewedAt },
              change.reviewed,
            ),
      reviewStore,
    )
    try {
      localStorage.setItem(REVIEW_PROGRESS_KEY, JSON.stringify(next))
      setReviewStore(next)
      setReviewNotice(changes.some(change => change.reviewed) ? 'Review progress saved in this browser.' : 'Review mark cleared.')
    } catch {
      setReviewNotice('Browser storage is unavailable. Review progress was not changed.')
    }
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

  const copyText = async (value: string, label: string): Promise<void> => {
    try {
      const copied = await writeClipboard(value)
      setCopyNotice({ copied, label })
    } catch {
      setCopyNotice({ copied: false, label })
    }
  }

  const lastPushLabel =
    state === undefined
      ? ''
      : state.lastPushAt
        ? formatAge(state.lastPushAt) + (state.lastPushHistoryTruncated ? ' · scan limited' : '')
        : state.lastPushHistoryTruncated
          ? 'not found before the operation-history limit'
          : 'not found in the latest 1,000 operations'

  const revisionMenu = (revision: Revision): ReactNode => {
    const parent = revisionsByCommitId.get(revision.parents[0] ?? '')
    return (
      <ContextMenuContent className="dshx-root dshx:w-56">
        <ContextMenuLabel className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">
          {revision.shortestChangeId} · {firstLine(revision.description)}
        </ContextMenuLabel>
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
        <ContextMenuItem onSelect={() => setBookmarkDraft({ commitId: revision.commitId, name: '' })}>Set bookmark…</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void copyText(revision.changeId, 'Full change ID')}>Copy full change ID</ContextMenuItem>
        <ContextMenuItem onSelect={() => void copyText(revision.commitId, 'Commit ID for this revision')}>Copy commit ID (this revision)</ContextMenuItem>
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

  const revisionDetails = (revision: Revision): ReactNode => {
    const repositoryRoot = state?.root ?? ''
    const parent = revisionsByCommitId.get(revision.parents[0] ?? '')
    const visibleFiles = details?.files.filter(file => !hideReviewedFiles || !isFileReviewed(reviewStore, repositoryRoot, revision.commitId, file)) ?? []
    const describeText = describeDrafts[revision.commitId] ?? editableDescription(revision.description)
    const describeChanged = describeDraftChanged(describeText, revision.description)
    const editing = editingDescription === revision.commitId && !revision.immutable
    return (
      <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:py-2 dshx:pr-3 dshx:text-xs">
        {revision.description.trim().length > 0 && !editing && (
          <p className="dshx:whitespace-pre-wrap dshx:text-muted-foreground">{editableDescription(revision.description)}</p>
        )}
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1.5 dshx:text-muted-foreground">
          <span>{revision.author || 'Unknown author'}</span>
          <span aria-hidden>·</span>
          <time dateTime={revision.authorTime}>{new Date(revision.authorTime).toLocaleString()}</time>
          <span aria-hidden>·</span>
          <button
            className="dshx:font-mono dshx:hover:text-foreground"
            onClick={() => void copyText(revision.commitId, 'Commit ID for this revision')}
            title={`Copy commit ID ${revision.commitId}`}
            type="button"
          >
            {revision.commitId.slice(0, 12)}
          </button>
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
              <span title="Files marked reviewed in this browser">
                {selectedReviewProgress.reviewed}/{selectedReviewProgress.total} reviewed
              </span>
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
                    .filter(file => selected.has(file.path) !== isFileReviewed(reviewStore, repositoryRoot, revision.commitId, file))
                    .map(file => ({ file, reviewed: selected.has(file.path) })),
                )
              }}
              selectedPaths={details.files.filter(file => isFileReviewed(reviewStore, repositoryRoot, revision.commitId, file)).map(file => file.path)}
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
          <div className="dshx:flex dshx:items-center dshx:justify-end dshx:gap-1">
            <Button
              aria-label="Scroll to the working copy"
              className="dshx:mr-auto dshx:text-muted-foreground"
              disabled={workingCopyIndex < 0}
              onClick={scrollToWorkingCopy}
              size="icon-sm"
              title="Scroll to @"
              type="button"
              variant="ghost"
            >
              <LocateFixedIcon />
            </Button>
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
                  className="dshx:text-xs dshx:md:text-xs"
                  onChange={event => setTextFilter(event.target.value)}
                  placeholder={sidePanel ? 'Search revisions…' : 'Search descriptions, IDs, bookmarks, tags, workspaces'}
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
        {dropPresentation !== null && (
          <div className="dshx:flex-none dshx:border-b dshx:px-3 dshx:py-2">
            <InlineDropPreview
              branch={dropPresentation.kind === 'rebase' ? previewBranch : []}
              busy={actionBusy}
              destinationLabel={
                dropDestinationRevision === undefined
                  ? dropPresentation.destinationId.slice(0, 12)
                  : `${dropDestinationRevision.shortestChangeId} · ${firstLine(dropDestinationRevision.description)}`
              }
              onCancel={() => sendAction({ type: 'cancel' })}
              onConfirm={confirmPreview}
              presentation={dropPresentation}
              preview={preview}
              sourceLabel={
                dropSourceRevision === undefined
                  ? dropPresentation.sourceId.slice(0, 12)
                  : `${dropSourceRevision.shortestChangeId} · ${firstLine(dropSourceRevision.description)}`
              }
            />
          </div>
        )}
        <div
          aria-label="Revisions"
          className="dshx:min-h-0 dshx:flex-1 dshx:overflow-auto dshx:overscroll-contain"
          onDragEnd={endDrag}
          onKeyDown={moveRowFocus}
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
          <div className="dshx:relative dshx:w-full" style={{ height: listVirtualizer.getTotalSize() }}>
            {listVirtualizer.getVirtualItems().map(virtualRow => {
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
                  ) : (
                    <RevisionRow
                      bookmarkMenu={bookmarkMenu}
                      dimmed={movingBranch?.has(item.revision.commitId) === true || previewBranchIds.has(item.revision.commitId)}
                      dropTarget={dropTarget === item.revision.commitId || rowDropPresentation !== null}
                      expanded={selectedRevision?.commitId === item.revision.commitId}
                      graphLayout={item.layout}
                      graphWidth={graphWidth}
                      menu={revisionMenu(item.revision)}
                      onDragEnter={event => {
                        if (hasDragType(event, REVISION_MIME) || hasDragType(event, BOOKMARK_MIME))
                          sendAction({ type: 'drag.enter', targetId: item.revision.commitId })
                      }}
                      onDragLeave={() => sendAction({ type: 'drag.leave', targetId: item.revision.commitId })}
                      onDragStart={origin => sendAction({ type: 'drag.start', origin })}
                      onDrop={event => dropOn(event, item.revision)}
                      onToggle={() => activateRevisionRow(item.revision)}
                      revision={item.revision}
                      metrics={graphMetrics}
                    >
                      {selectedRevision?.commitId === item.revision.commitId && revisionDetails(item.revision)}
                    </RevisionRow>
                  )}
                </div>
              )
            })}
          </div>
          {visibleRevisions.length === 0 && (
            <Empty className="dshx:gap-2 dshx:p-6 dshx:md:p-6">
              <EmptyHeader>
                <EmptyTitle className="dshx:text-sm">No revisions match these filters.</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </>
    )

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
                        <DropdownMenuSeparator />
                        <div className="dshx:flex dshx:flex-col dshx:gap-1 dshx:px-2 dshx:py-1.5 dshx:text-xs dshx:text-muted-foreground">
                          <span title={state.lastPushDescription ?? 'Reads JJ operation argv metadata only.'}>
                            Last recorded JJ push command: {lastPushLabel}
                          </span>
                          {state.evolutionHistoryTruncated && <span>Evolution scan limited; some evolved markers may be missing.</span>}
                        </div>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <div className="dshx:flex dshx:items-center dshx:gap-1.5">
              <Button
                aria-label="Choose repository"
                className="dshx:h-8 dshx:min-w-0 dshx:flex-1 dshx:justify-start dshx:gap-2 dshx:px-2 dshx:font-normal"
                onClick={() => setPickerOpen(true)}
                title={state?.root ?? (path || 'Choose repository')}
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
              <Button
                disabled={repoId === null || selectedRemote === '' || busy}
                onClick={() => askForConfirmation({ kind: 'fetch', remote: selectedRemote })}
                size="sm"
                title={selectedRemote === '' ? 'No remote available' : `Fetch from ${selectedRemote}`}
                type="button"
                variant="outline"
              >
                Fetch
              </Button>
              <Button
                disabled={repoId === null || selectedRemote === '' || selectedBookmark === '' || busy}
                onClick={() => askForConfirmation({ kind: 'push', remote: selectedRemote, bookmark: selectedBookmark })}
                size="sm"
                title={selectedBookmark === '' ? 'No local bookmark to push' : `Push ${selectedBookmark} to ${selectedRemote}`}
                type="button"
                variant="outline"
              >
                Push
              </Button>
              <Button
                aria-busy={busy}
                aria-label="Refresh"
                disabled={busy || repoId === null}
                onClick={refreshRepository}
                size="icon-sm"
                title="Refresh"
                type="button"
                variant="outline"
              >
                {busy ? <Spinner /> : <RefreshCwIcon />}
              </Button>
              {busy && !loadingRepository && (
                <span className="dshx:sr-only" role="status">
                  Working…
                </span>
              )}
            </div>
          </header>

          {(errorMessages.length > 0 || copyNotice !== null || (confirmResult !== null && confirmResult.output.length > 0)) && (
            <div className="dshx:flex dshx:max-h-48 dshx:flex-none dshx:flex-col dshx:gap-1.5 dshx:overflow-auto dshx:border-b dshx:px-3 dshx:py-2">
              {errorMessages.map(message => (
                <Alert className="dshx:px-3 dshx:py-2" key={message} variant="destructive">
                  <AlertDescription className="dshx:text-xs">{message}</AlertDescription>
                </Alert>
              ))}
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

          {sidePanel ? (
            tabsContent
          ) : (
            <div className="dshx:grid dshx:min-h-0 dshx:flex-1 dshx:overflow-auto dshx:lg:grid-cols-[minmax(0,1fr)_22rem] dshx:lg:overflow-hidden">
              <div className="dshx:flex dshx:min-h-[24rem] dshx:min-w-0 dshx:flex-col dshx:lg:min-h-0">{tabsContent}</div>
              <aside className="dshx:flex dshx:flex-col dshx:gap-3 dshx:border-t dshx:bg-muted/30 dshx:p-3 dshx:lg:overflow-auto dshx:lg:border-t-0 dshx:lg:border-l">
                <SessionForkPanel sessions={props.sessions} openSession={props.openSession} />
                {state !== undefined && (
                  <WorkspaceProvisioner
                    revisions={state.revisions}
                    selectedCommitId={selectedRevision?.commitId ?? null}
                    provisionedPath={provisionedPath}
                    onPreview={askForConfirmation}
                    pickDirectory={props.pickDirectory}
                    launchSession={props.launchSession}
                  />
                )}
                {state !== undefined && (
                  <WorkspaceRestorePanel
                    sessions={props.sessions}
                    workspacePath={state.root}
                    targetCommitId={selectedRevision?.commitId ?? null}
                    onRestored={refreshRepository}
                  />
                )}
              </aside>
            </div>
          )}
        </Tabs>

        {pickerOpen && (
          <ProjectFolderPicker
            directoryPicker={props.directoryPicker}
            onClose={() => setPickerOpen(false)}
            onRegisterWorkspace={props.registerWorkspace}
            onSelect={selected => {
              setPickerOpen(false)
              autoRegisterPath.current = selected.canonicalPath
              setPath(selected.canonicalPath)
              registerMutation.mutate(selected.canonicalPath)
            }}
            projects={props.projects}
            recentFolders={repoHistory}
            title="Choose a Jujutsu repository"
          />
        )}

        {fullDiff !== null && (
          <FullDiffDialog
            error={fullDiffQuery.error === null ? null : errorMessage(fullDiffQuery.error, 'Could not load the revision diff.')}
            focusPath={fullDiff.focusPath}
            layout={diffLayout}
            onClose={() => setFullDiff(null)}
            onOpenInEditor={path => {
              if (state !== undefined && openInEditor({ path, cwd: state.root })) setFullDiff(null)
            }}
            patch={fullDiffQuery.data?.patch}
            title={fullDiff.title}
            truncated={fullDiffQuery.data?.truncated ?? false}
          />
        )}

        <Dialog
          onOpenChange={open => {
            if (!open) setBookmarkDraft(null)
          }}
          open={bookmarkDraft !== null}
        >
          {bookmarkDraft !== null && (
            <DialogContent className="dshx-root dshx:sm:max-w-sm">
              <form
                className="dshx:flex dshx:flex-col dshx:gap-3"
                onSubmit={event => {
                  event.preventDefault()
                  const name = bookmarkDraft.name.trim()
                  if (name.length === 0) return
                  setBookmarkDraft(null)
                  askForConfirmation({ kind: 'bookmark-set', bookmark: name, destinationId: bookmarkDraft.commitId })
                }}
              >
                <DialogHeader>
                  <DialogTitle className="dshx:text-base">Set bookmark</DialogTitle>
                  <DialogDescription>At {revisionsByCommitId.get(bookmarkDraft.commitId)?.shortestChangeId ?? 'the selected revision'}.</DialogDescription>
                </DialogHeader>
                <Input
                  aria-label="Bookmark name"
                  autoFocus
                  className="dshx:font-mono!"
                  onChange={event => setBookmarkDraft({ commitId: bookmarkDraft.commitId, name: event.target.value })}
                  pattern="[A-Za-z0-9][A-Za-z0-9._/+:\-]*"
                  placeholder="feature/name"
                  value={bookmarkDraft.name}
                />
                <DialogFooter>
                  <Button disabled={bookmarkDraft.name.trim().length === 0} size="sm" type="submit">
                    Preview
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          )}
        </Dialog>

        <AlertDialog
          onOpenChange={open => {
            if (!open) sendAction({ type: 'cancel' })
          }}
          open={preview !== undefined && dropPresentation === null}
        >
          {preview !== undefined && dropPresentation === null && (
            <AlertDialogContent className="dshx-root">
              <AlertDialogHeader className="dshx:place-items-start dshx:text-left">
                <AlertDialogTitle className="dshx:text-base">Confirm {preview.title.toLocaleLowerCase()}</AlertDialogTitle>
                <AlertDialogDescription className="dshx:font-medium dshx:text-foreground">{preview.summary}</AlertDialogDescription>
              </AlertDialogHeader>
              <pre className={cn(CODE_BLOCK, 'dshx:whitespace-pre-wrap')}>{preview.detail}</pre>
              <AlertDialogFooter>
                <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={actionBusy}
                  onClick={confirmPreview}
                  size="sm"
                  variant={preview.kind === 'abandon' || preview.kind === 'restore' || preview.kind === 'bookmark-delete' ? 'destructive' : 'default'}
                >
                  Confirm and run
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          )}
        </AlertDialog>
      </TooltipProvider>
    </main>
  )
}

const PreferencesMenu = (): JSX.Element => {
  const [preferences, setPreference] = usePreferences()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label="Jujutsu view settings" size="icon-sm" title="View settings" type="button" variant="ghost">
          <Settings2Icon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="dshx-root dshx:w-60">
        <DropdownMenuLabel className="dshx:text-xs dshx:text-muted-foreground">Saved in this browser</DropdownMenuLabel>
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
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="dshx:text-xs">Revisions loaded ({preferences.revisionLimit})</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="dshx-root">
            <DropdownMenuRadioGroup onValueChange={value => setPreference('revisionLimit', Number(value))} value={String(preferences.revisionLimit)}>
              {REVISION_LIMIT_OPTIONS.map(option => (
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

interface GraphMetrics {
  readonly rowHeight: number
  readonly bendGap: number
  readonly laneGap: number
}

const GRAPH_DENSITY = {
  comfortable: { rowHeight: 28, bendGap: 12, laneGap: 14 },
  compact: { rowHeight: 22, bendGap: 8, laneGap: 11 },
} as const satisfies Record<GraphDensity, GraphMetrics>

const TONE_STROKE = {
  trunk: 'dshx:stroke-info',
  current: 'dshx:stroke-info',
  workspace: 'dshx:stroke-teal',
  divergent: 'dshx:stroke-violet',
  branch: 'dshx:stroke-muted-foreground',
} as const satisfies Record<GraphTone, string>

const TONE_FILL = {
  trunk: 'dshx:fill-info',
  current: 'dshx:fill-info',
  workspace: 'dshx:fill-teal',
  divergent: 'dshx:fill-violet',
  branch: 'dshx:fill-muted-foreground',
} as const satisfies Record<GraphTone, string>

const laneX = (metrics: GraphMetrics, lane: number): number => metrics.laneGap * 0.75 + lane * metrics.laneGap

const graphWidthFor = (metrics: GraphMetrics, laneCount: number): number => laneX(metrics, Math.max(laneCount, 1) - 1) + metrics.laneGap * 0.75

const rowHeightFor = (metrics: GraphMetrics, layout: RevisionGraphRow): number => metrics.rowHeight + (layout.bends ? metrics.bendGap : 0)

/** A lane that runs straight down, or turns once with rounded corners at `turn`. */
const lanePath = (input: { readonly fromX: number; readonly toX: number; readonly top: number; readonly turn: number; readonly bottom: number }): string => {
  if (input.fromX === input.toX) return `M ${input.fromX} ${input.top} V ${input.bottom}`
  const direction = input.toX > input.fromX ? 1 : -1
  const radius = Math.min(6, Math.abs(input.toX - input.fromX) / 2, input.turn - input.top, input.bottom - input.turn)
  return [
    `M ${input.fromX} ${input.top}`,
    `V ${input.turn - radius}`,
    `Q ${input.fromX} ${input.turn} ${input.fromX + direction * radius} ${input.turn}`,
    `H ${input.toX - direction * radius}`,
    `Q ${input.toX} ${input.turn} ${input.toX} ${input.turn + radius}`,
    `V ${input.bottom}`,
  ].join(' ')
}

interface GraphLanesProps {
  readonly lanes: readonly GraphLane[]
  readonly metrics: GraphMetrics
  readonly width: number
}

/** Straight lane lines through a day heading or an expanded revision's details. */
const GraphLanes = (props: GraphLanesProps): JSX.Element => (
  <svg aria-hidden className="dshx:absolute dshx:inset-y-0 dshx:left-0 dshx:h-full" width={props.width}>
    {props.lanes.map(lane => (
      <line
        className={TONE_STROKE[lane.tone]}
        key={lane.lane}
        strokeLinecap="round"
        strokeWidth={1.5}
        x1={laneX(props.metrics, lane.lane)}
        x2={laneX(props.metrics, lane.lane)}
        y1="0"
        y2="100%"
      />
    ))}
  </svg>
)

interface RevisionGraphCellProps {
  readonly revision: Revision
  readonly layout: RevisionGraphRow
  readonly metrics: GraphMetrics
  readonly width: number
}

const RevisionGraphCell = (props: RevisionGraphCellProps): JSX.Element => {
  const revision = props.revision
  const layout = props.layout
  const height = rowHeightFor(props.metrics, layout)
  const middle = props.metrics.rowHeight / 2
  const turn = props.metrics.rowHeight + props.metrics.bendGap / 2
  const x = (lane: number): number => laneX(props.metrics, lane)
  const commitX = x(layout.commitLane)
  const tone = revision.divergent ? 'divergent' : layout.tone
  const node = (() => {
    if (revision.workingCopy) {
      return (
        <>
          <circle className="dshx:fill-info/25" cx={commitX} cy={middle} r={7.5} />
          <circle className="dshx:fill-info dshx:stroke-background" cx={commitX} cy={middle} r={4.5} strokeWidth={1.5} />
        </>
      )
    }
    if (revision.immutable) {
      return (
        <path
          className="dshx:fill-muted-foreground dshx:stroke-background"
          d={`M ${commitX} ${middle - 3.5} L ${commitX + 3.5} ${middle} L ${commitX} ${middle + 3.5} L ${commitX - 3.5} ${middle} Z`}
          fillOpacity={0.6}
          strokeWidth={1}
        />
      )
    }
    if (revision.workspaces.length > 0 && !revision.divergent) {
      return <circle className="dshx:fill-background dshx:stroke-teal" cx={commitX} cy={middle} r={4.25} strokeWidth={2} />
    }
    return (
      <circle
        className={cn(revision.empty ? 'dshx:fill-background' : TONE_FILL[tone], TONE_STROKE[tone], !revision.empty && 'dshx:stroke-background')}
        cx={commitX}
        cy={middle}
        r={revision.empty ? 3.5 : 4}
        strokeWidth={revision.empty ? 1.5 : 1}
      />
    )
  })()
  return (
    <svg
      aria-hidden
      className="dshx:flex-none dshx:self-start dshx:overflow-visible"
      height={height}
      viewBox={`0 0 ${props.width} ${height}`}
      width={props.width}
    >
      <g fill="none" strokeLinecap="round" strokeWidth={1.5}>
        {layout.passing.map(link => (
          <path
            className={TONE_STROKE[link.tone]}
            d={lanePath({ fromX: x(link.fromLane), toX: x(link.toLane), top: 0, turn, bottom: height })}
            key={`pass-${link.fromLane}`}
          />
        ))}
        {layout.incoming.map(link => (
          <path
            className={TONE_STROKE[link.tone]}
            d={lanePath({ fromX: x(link.fromLane), toX: commitX, top: 0, turn: middle / 2, bottom: middle })}
            key={`in-${link.fromLane}`}
          />
        ))}
        {layout.outgoing.map((link, index) =>
          link.terminal ? (
            <path
              className={TONE_STROKE[link.tone]}
              d={`M ${commitX} ${middle} V ${middle + (height - middle) * 0.75}`}
              key={`stub-${index}`}
              strokeDasharray="1 3"
              strokeOpacity={0.6}
            />
          ) : (
            <path
              className={TONE_STROKE[link.tone]}
              d={lanePath({ fromX: commitX, toX: x(link.toLane), top: middle, turn, bottom: height })}
              key={`out-${link.toLane}-${index}`}
              strokeDasharray={link.dashed ? '2 3' : undefined}
              strokeOpacity={revision.immutable ? 0.5 : 1}
            />
          ),
        )}
      </g>
      {node}
    </svg>
  )
}

const CHIP = 'dshx:inline-flex dshx:h-[18px] dshx:flex-none dshx:items-center dshx:gap-1 dshx:rounded-sm dshx:px-1.5 dshx:text-[11px] dshx:leading-none'

/** jj prints change IDs in "reverse hex" (0-f → z-k); the API carries the normal hex form. */
const reverseHexChangeId = (changeId: string, length: number): string =>
  [...changeId.slice(0, length)].map(digit => String.fromCharCode('z'.charCodeAt(0) - Number.parseInt(digit, 16))).join('')

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
        Confirm and run
      </Button>
    </div>
  </section>
)

interface RevisionRowProps {
  readonly revision: Revision
  readonly expanded: boolean
  readonly dimmed: boolean
  readonly dropTarget: boolean
  readonly graphLayout: RevisionGraphRow
  readonly graphWidth: number
  readonly metrics: GraphMetrics
  readonly menu: ReactNode
  readonly bookmarkMenu: (name: string, local: boolean) => ReactNode
  readonly onToggle: () => void
  readonly onDragStart: (origin: DragOrigin) => void
  readonly onDragEnter: (event: DragEvent) => void
  readonly onDragLeave: () => void
  readonly onDrop: (event: DragEvent) => void
  readonly children: ReactNode
}

const RevisionRow = (props: RevisionRowProps): JSX.Element => {
  const revision = props.revision
  const draggable = !revision.immutable
  const described = revision.description.trim().length > 0
  const changeId = reverseHexChangeId(revision.changeId, Math.max(8, revision.shortestChangeId.length))
  const otherWorkspaces = revision.workingCopy && revision.workspaces.length === 1 ? [] : revision.workspaces
  return (
    <article
      className={cn('dshx:group/row dshx:relative', props.expanded && 'dshx:bg-muted-foreground/[0.07]', props.dimmed && 'dshx:opacity-40')}
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
              'dshx:flex dshx:items-start dshx:pr-3 dshx:hover:bg-accent',
              props.dropTarget && 'dshx:bg-primary/10 dshx:ring-1 dshx:ring-primary dshx:ring-inset',
            )}
            draggable={draggable}
            onDragStart={event => {
              event.dataTransfer.setData(REVISION_MIME, revision.commitId)
              event.dataTransfer.effectAllowed = 'move'
              props.onDragStart({ kind: 'revision', sourceId: revision.commitId })
            }}
            style={{ height: rowHeightFor(props.metrics, props.graphLayout) }}
            title={draggable ? 'Drag onto another revision to rebase · right-click for actions' : 'Right-click for actions'}
          >
            <RevisionGraphCell layout={props.graphLayout} metrics={props.metrics} revision={revision} width={props.graphWidth} />
            <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-1.5" style={{ height: props.metrics.rowHeight }}>
              <button
                aria-expanded={props.expanded}
                className="dshx:flex dshx:h-full dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-1.5 dshx:overflow-hidden dshx:text-left dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50"
                data-row-focus=""
                onClick={props.onToggle}
                type="button"
              >
                <ChevronRightIcon
                  className={cn(
                    'dshx:size-3 dshx:flex-none dshx:text-muted-foreground/60 dshx:transition-transform dshx:group-hover/row:text-muted-foreground',
                    props.expanded && 'dshx:rotate-90',
                  )}
                />
                {revision.workingCopy && (
                  <span
                    className={cn(CHIP, 'dshx:rounded-full dshx:bg-info/15 dshx:font-semibold dshx:text-info')}
                    title={revision.workspaces.length === 1 ? `Working copy of workspace ${revision.workspaces[0]}` : 'Working copy'}
                  >
                    <PencilIcon className="dshx:size-3" />
                    Editing
                  </span>
                )}
                {otherWorkspaces.map(workspace => (
                  <span
                    className={cn(CHIP, 'dshx:max-w-[45%] dshx:rounded-full dshx:bg-teal/15 dshx:font-medium dshx:text-teal')}
                    key={workspace}
                    title={`Workspace ${workspace}`}
                  >
                    <LayersIcon className="dshx:size-3 dshx:flex-none" />
                    <span className="dshx:truncate">{workspace}</span>
                  </span>
                ))}
                {revision.bookmarks.map(name => {
                  const local = revision.localBookmarks.includes(name)
                  return (
                    <ContextMenu key={name}>
                      <ContextMenuTrigger asChild>
                        <span
                          className={cn(
                            CHIP,
                            'dshx:max-w-[35%] dshx:border dshx:border-border dshx:bg-muted dshx:font-mono dshx:text-[10.5px]',
                            local ? 'dshx:cursor-grab dshx:text-foreground' : 'dshx:text-muted-foreground',
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
                          title={local ? `Bookmark ${name} · drag onto a revision to move · right-click for actions` : `Remote bookmark ${name}`}
                        >
                          <BookmarkIcon className="dshx:size-2.5 dshx:flex-none" />
                          <span className="dshx:truncate">{name}</span>
                        </span>
                      </ContextMenuTrigger>
                      {props.bookmarkMenu(name, local)}
                    </ContextMenu>
                  )
                })}
                {revision.tags.map(name => (
                  <span
                    className={cn(CHIP, 'dshx:max-w-[30%] dshx:border dshx:border-border dshx:font-mono dshx:text-[10.5px] dshx:text-muted-foreground')}
                    key={name}
                    title={`Tag ${name}`}
                  >
                    <TagIcon className="dshx:size-2.5 dshx:flex-none" />
                    <span className="dshx:truncate">{name}</span>
                  </span>
                ))}
                {revision.conflict && <TriangleAlertIcon aria-label="Conflict" className="dshx:size-3.5 dshx:flex-none dshx:text-warning" role="img" />}
                {described ? (
                  <span
                    className={cn(
                      'dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm',
                      revision.workingCopy ? 'dshx:font-semibold' : 'dshx:font-medium',
                      revision.immutable && 'dshx:font-normal dshx:text-muted-foreground',
                    )}
                  >
                    {firstLine(revision.description)}
                  </span>
                ) : (
                  <>
                    <span className={cn(CHIP, 'dshx:border dshx:border-dashed dshx:border-border dshx:text-muted-foreground')} title="No description">
                      Describe
                    </span>
                    <span className="dshx:flex-1" />
                  </>
                )}
              </button>
              {revision.divergent && (
                <span
                  className={cn(CHIP, 'dshx:bg-violet/10 dshx:text-[10px] dshx:text-violet')}
                  title="Divergent: several visible commits share this change ID"
                >
                  divergent
                </span>
              )}
              <time className="dshx:flex-none dshx:font-mono dshx:text-[11px] dshx:text-muted-foreground" dateTime={revision.authorTime}>
                {formatAge(revision.authorTime)}
              </time>
              <span
                className="dshx:flex-none dshx:font-mono dshx:text-[11px]"
                title={revision.changeId + (revision.evolved ? ' · rewritten from an earlier commit' : '')}
              >
                <span className={revision.immutable ? 'dshx:text-muted-foreground' : 'dshx:text-foreground/80'}>
                  {changeId.slice(0, revision.shortestChangeId.length)}
                </span>
                <span className="dshx:text-muted-foreground/50">{changeId.slice(revision.shortestChangeId.length)}</span>
                {revision.divergent && <span className="dshx:text-violet">/{revision.changeOffset}</span>}
              </span>
              <GripVerticalIcon
                aria-hidden
                className={cn(
                  'dshx:size-3.5 dshx:flex-none dshx:text-muted-foreground dshx:opacity-0',
                  draggable ? 'dshx:cursor-grab dshx:group-hover/row:opacity-100' : 'dshx:invisible',
                )}
              />
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
