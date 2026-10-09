import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { ISessions, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
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
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@dshfiles/plugin-ui/components/ui/empty'
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
  CalendarIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisVerticalIcon,
  FolderGit2Icon,
  GripVerticalIcon,
  RefreshCwIcon,
  SearchIcon,
  Settings2Icon,
  UserIcon,
} from '@dshfiles/plugin-ui/icons'
import { PatchView, type PatchLayout } from '@dshfiles/plugin-ui/diff'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useMachine } from '@dshfiles/plugin-ui/machine'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { ProjectFolderPicker, type DirectoryPickerPort, type RegisteredProject } from '@dshfiles/project-folder-picker'
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { z } from 'zod'
import type { Mutation, ReadFailure, Revision } from './api.js'
import { ChangedFiles, FileViewToggle, LineCounts } from './changed-files.js'
import { FullDiffDialog } from './full-diff-dialog.js'
import { describeDraftChanged, layoutRevisionGraph, matchesRevisionSearch, type RevisionGraphRow } from './graph.js'
import { jujutsuApi } from './api.js'
import { useAutoRefresh } from './auto-refresh.js'
import { openInEditor } from './open-in-editor.js'
import { revisionActionMachine } from './revision-action-machine.js'
import { ANCESTOR_COUNT_OPTIONS, REVISION_LIMIT_OPTIONS, usePreferences } from './preferences.js'
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
const REVISION_MIME = 'application/x-jujutsu-revision'
const BOOKMARK_MIME = 'application/x-jujutsu-bookmark'
const REPO_HISTORY_LIMIT = 12
const LANE_GAP = 10
const LANE_OFFSET = 8
const LANE_STROKES = ['dshx:stroke-chart-1', 'dshx:stroke-chart-2', 'dshx:stroke-chart-3', 'dshx:stroke-chart-4', 'dshx:stroke-chart-5'] as const
const LANE_FILLS = ['dshx:fill-chart-1', 'dshx:fill-chart-2', 'dshx:fill-chart-3', 'dshx:fill-chart-4', 'dshx:fill-chart-5'] as const

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

const groupRows = (revisions: readonly Revision[], byDay: boolean): readonly { readonly day: string; readonly rows: readonly Revision[] }[] => {
  if (!byDay) return [{ day: '', rows: revisions }]
  const groups = new Map<string, Revision[]>()
  for (const revision of revisions) {
    const key = dayLabel(revision.authorTime)
    const rows = groups.get(key) ?? []
    rows.push(revision)
    groups.set(key, rows)
  }
  return [...groups].map(([day, rows]) => ({ day, rows }))
}

const firstLine = (description: string): string => description.split('\n')[0] || '(no description)'

const editableDescription = (description: string): string => description.replace(/\n+$/, '')

const laneCenter = (lane: number): number => LANE_OFFSET + lane * LANE_GAP

const laneStroke = (lane: number): string => LANE_STROKES[lane % LANE_STROKES.length] ?? LANE_STROKES[0]

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
  const mineOnly = preferences.mineOnly
  const hideImmutable = preferences.hideImmutable

  const [actionSnapshot, sendAction, actionActor] = useMachine(revisionActionMachine, { input: { client: api } })
  const preview = actionSnapshot.matches('previewing') ? (actionSnapshot.context.preview ?? undefined) : undefined
  const confirmResult = actionSnapshot.context.result
  const actionBusy = actionSnapshot.hasTag('busy')
  const { dragSource, dropTarget } = actionSnapshot.context

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
  const loadingRepository = registerMutation.isPending || (repoId !== null && state === undefined && stateQuery.isFetching)

  const remoteNames = state?.remoteNames ?? []
  const selectedRemote = remoteNames.includes(remote) ? remote : (remoteNames[0] ?? '')
  const localBookmarkNames = useMemo(() => [...new Set(state?.revisions.flatMap(row => row.localBookmarks) ?? [])], [state])
  const workingCopy = state?.revisions.find(revision => revision.workingCopy)
  const defaultBookmark = workingCopy?.localBookmarks[0] ?? localBookmarkNames[0] ?? ''
  const selectedBookmark = localBookmarkNames.includes(bookmark) ? bookmark : defaultBookmark
  const mainRevision = state?.revisions.find(revision => revision.localBookmarks.includes('main') || revision.bookmarks.includes('main'))

  const visibleRevisions = useMemo(() => {
    if (state === undefined) return []
    return state.revisions.filter(revision => {
      if (mineOnly && !revision.mine && !revision.workingCopy) return false
      if (hideImmutable && revision.immutable) return false
      if (authorFilter && !revision.author.toLocaleLowerCase().includes(authorFilter.toLocaleLowerCase())) return false
      const timestamp = Date.parse(revision.authorTime)
      if (fromDate && Number.isFinite(timestamp) && timestamp < Date.parse(fromDate + 'T00:00:00')) return false
      if (toDate && Number.isFinite(timestamp) && timestamp > Date.parse(toDate + 'T23:59:59')) return false
      return matchesRevisionSearch(revision, textFilter)
    })
  }, [state, mineOnly, hideImmutable, authorFilter, textFilter, fromDate, toDate])

  const revisionsByCommitId = useMemo(() => new Map(state?.revisions.map(revision => [revision.commitId, revision]) ?? []), [state])
  const graphRows = useMemo(() => {
    if (state === undefined) return []
    const graphRevisions = hideImmutable ? state.revisions.filter(revision => !revision.immutable) : state.revisions
    return layoutRevisionGraph(graphRevisions, revisionsByCommitId, hideImmutable)
  }, [state, revisionsByCommitId, hideImmutable])
  const graphRowsByCommitId = useMemo(() => new Map(graphRows.map(row => [row.commitId, row])), [graphRows])
  const graphLaneCount = graphRows.reduce((maximum, row) => Math.max(maximum, row.laneCount), 1)
  const graphWidth = laneCenter(graphLaneCount - 1) + LANE_OFFSET
  const groups = useMemo(() => groupRows(visibleRevisions, preferences.dateHeadings), [visibleRevisions, preferences.dateHeadings])
  const movingBranch = useMemo(
    () => (dragSource === null || state === undefined ? null : descendantCommitIds(state.revisions, dragSource)),
    [dragSource, state],
  )
  const emptyAncestors = useMemo(() => emptyAncestorCandidates(state?.revisions ?? []), [state])

  const errorMessages = [
    stateQuery.error && errorMessage(stateQuery.error, 'Could not load this repository.'),
    registerMutation.error && errorMessage(registerMutation.error, 'Could not register this repository.'),
    actionSnapshot.context.error,
  ].filter((message): message is string => Boolean(message))

  const askForConfirmation = (action: Mutation): void => {
    if (repoId === null) return
    if (action.kind === 'workspace-add') setProvisionedPath(null)
    registerMutation.reset()
    sendAction({ type: 'prepare', repoId, action })
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

  const dropAction = (event: DragEvent, revision: Revision): Mutation | null => {
    const draggedBookmark = event.dataTransfer.getData(BOOKMARK_MIME)
    const draggedRevision = event.dataTransfer.getData(REVISION_MIME)
    if (draggedBookmark) {
      return revision.localBookmarks.includes(draggedBookmark) ? null : { kind: 'bookmark-move', bookmark: draggedBookmark, destinationId: revision.commitId }
    }
    if (draggedRevision && draggedRevision !== revision.commitId && !descendantCommitIds(state?.revisions ?? [], draggedRevision).has(revision.commitId)) {
      return { kind: 'rebase', sourceId: draggedRevision, destinationId: revision.commitId }
    }
    return null
  }

  const dropOn = (event: DragEvent, revision: Revision): void => {
    event.preventDefault()
    registerMutation.reset()
    sendAction({ type: 'drop', repoId, action: dropAction(event, revision) })
  }

  const toggleRevision = (revision: Revision): void => {
    setEditingDescription(null)
    setSelection(current => (current?.commitId === revision.commitId ? null : { commitId: revision.commitId, changeId: revision.changeId }))
  }

  const copyText = (value: string): void => {
    void navigator.clipboard?.writeText(value).catch(() => undefined)
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
        {!revision.immutable && mainRevision !== undefined && mainRevision.commitId !== revision.commitId && (
          <ContextMenuItem onSelect={() => askForConfirmation({ kind: 'rebase', sourceId: revision.commitId, destinationId: mainRevision.commitId })}>
            Rebase onto main
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={() => setBookmarkDraft({ commitId: revision.commitId, name: '' })}>Create bookmark…</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => copyText(revision.changeId)}>Copy change ID</ContextMenuItem>
        <ContextMenuItem onSelect={() => copyText(revision.commitId)}>Copy commit ID</ContextMenuItem>
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
      <ContextMenuItem onSelect={() => copyText(name)}>Copy name</ContextMenuItem>
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
            onClick={() => copyText(revision.commitId)}
            title={`Copy ${revision.commitId}`}
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
            <Badge className={cn(COMPACT_BADGE, 'dshx:border-destructive/40 dshx:text-destructive')} variant="outline">
              conflict
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
        <div className="dshx:min-h-0 dshx:flex-1 dshx:overflow-auto dshx:overscroll-contain dshx:pb-4" onDragEnd={endDrag}>
          {groups.map(group => {
            const firstLayout = group.rows.map(revision => graphRowsByCommitId.get(revision.commitId)).find(layout => layout !== undefined)
            const dayCollapsed = collapsedDays.has(group.day)
            return (
              <section aria-label={group.day || 'Revisions'} key={group.day}>
                {group.day.length > 0 && (
                  <button
                    aria-expanded={!dayCollapsed}
                    className="dshx:sticky dshx:top-0 dshx:z-10 dshx:flex dshx:h-[18px] dshx:w-full dshx:items-center dshx:gap-1 dshx:border-b dshx:border-border/60 dshx:bg-background dshx:pr-3 dshx:text-left dshx:text-[10px] dshx:font-semibold dshx:uppercase dshx:tracking-wider dshx:text-muted-foreground dshx:hover:text-foreground"
                    onClick={() =>
                      setCollapsedDays(current => {
                        const next = new Set(current)
                        if (next.has(group.day)) next.delete(group.day)
                        else next.add(group.day)
                        return next
                      })
                    }
                    type="button"
                  >
                    <svg aria-hidden className="dshx:flex-none dshx:overflow-visible" height={18} width={graphWidth}>
                      {firstLayout !== undefined &&
                        [...firstLayout.topLanes, ...(firstLayout.incoming ? [firstLayout.commitLane] : [])].map(lane => (
                          <line
                            className={laneStroke(lane)}
                            key={lane}
                            strokeOpacity={0.8}
                            strokeWidth={1.25}
                            x1={laneCenter(lane)}
                            x2={laneCenter(lane)}
                            y1={0}
                            y2={18}
                          />
                        ))}
                    </svg>
                    <ChevronDownIcon className={cn('dshx:size-3 dshx:flex-none dshx:transition-transform', dayCollapsed && 'dshx:-rotate-90')} />
                    <span className="dshx:truncate">{group.day}</span>
                    <span className="dshx:ml-auto dshx:font-mono dshx:font-normal">{group.rows.length}</span>
                  </button>
                )}
                {!dayCollapsed &&
                  group.rows.map(revision => {
                    const graphLayout = graphRowsByCommitId.get(revision.commitId)
                    if (graphLayout === undefined) return null
                    const expanded = selectedRevision?.commitId === revision.commitId
                    return (
                      <RevisionRow
                        bookmarkMenu={bookmarkMenu}
                        dimmed={movingBranch?.has(revision.commitId) === true}
                        dropTarget={dropTarget === revision.commitId}
                        expanded={expanded}
                        graphLayout={graphLayout}
                        graphWidth={graphWidth}
                        key={revision.commitId}
                        menu={revisionMenu(revision)}
                        onDragEnter={event => {
                          if (hasDragType(event, REVISION_MIME) || hasDragType(event, BOOKMARK_MIME)) sendAction({ type: 'drag.enter', targetId: revision.commitId })
                        }}
                        onDragStart={() => sendAction({ type: 'drag.start', sourceId: revision.commitId })}
                        onDrop={event => dropOn(event, revision)}
                        onToggle={() => toggleRevision(revision)}
                        revision={revision}
                        sidePanel={sidePanel}
                      >
                        {expanded && revisionDetails(revision)}
                      </RevisionRow>
                    )
                  })}
              </section>
            )
          })}
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

  const emptyState =
    state === undefined ? (
      <Empty className="dshx:gap-2 dshx:p-6 dshx:md:p-6">
        <EmptyHeader>
          {loadingRepository && (
            <EmptyMedia>
              <Spinner />
            </EmptyMedia>
          )}
          <EmptyTitle className="dshx:text-sm dshx:font-normal dshx:text-muted-foreground">
            {loadingRepository ? 'Loading repository…' : 'Choose a repository to open its revision graph.'}
          </EmptyTitle>
          {!loadingRepository && (
            <Button className="dshx:mt-2" onClick={() => setPickerOpen(true)} size="sm" type="button" variant="outline">
              <FolderGit2Icon />
              Choose repository…
            </Button>
          )}
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
    <main ref={autoRefresh.ref} className="dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:overflow-hidden dshx:bg-background dshx:text-foreground">
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

          {(errorMessages.length > 0 || (confirmResult !== null && confirmResult.output.length > 0)) && (
            <div className="dshx:flex dshx:max-h-48 dshx:flex-none dshx:flex-col dshx:gap-1.5 dshx:overflow-auto dshx:border-b dshx:px-3 dshx:py-2">
              {errorMessages.map(message => (
                <Alert className="dshx:px-3 dshx:py-2" key={message} variant="destructive">
                  <AlertDescription className="dshx:text-xs">{message}</AlertDescription>
                </Alert>
              ))}
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
                  askForConfirmation({ kind: 'bookmark-create', bookmark: name, destinationId: bookmarkDraft.commitId })
                }}
              >
                <DialogHeader>
                  <DialogTitle className="dshx:text-base">Create bookmark</DialogTitle>
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
          open={preview !== undefined}
        >
          {preview !== undefined && (
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

interface RevisionGraphCellProps {
  readonly revision: Revision
  readonly layout: RevisionGraphRow
  readonly width: number
  readonly height: number
}

const RevisionGraphCell = (props: RevisionGraphCellProps): JSX.Element => {
  const middle = props.height / 2
  const commitX = laneCenter(props.layout.commitLane)
  const stroke = props.revision.divergent || props.revision.conflict ? 'dshx:stroke-destructive' : laneStroke(props.layout.commitLane)
  const nodeClass = props.revision.workingCopy
    ? 'dshx:fill-primary dshx:stroke-primary'
    : cn(props.revision.empty ? 'dshx:fill-background' : (LANE_FILLS[props.layout.commitLane % LANE_FILLS.length] ?? LANE_FILLS[0]), stroke)
  return (
    <svg aria-hidden className="dshx:flex-none dshx:overflow-visible" height={props.height} viewBox={`0 0 ${props.width} ${props.height}`} width={props.width}>
      <g fill="none" strokeOpacity={0.8} strokeWidth={1.25}>
        {props.layout.topLanes.map(lane => (
          <line className={laneStroke(lane)} key={`top-${lane}`} x1={laneCenter(lane)} x2={laneCenter(lane)} y1={0} y2={middle} />
        ))}
        {props.layout.incoming && <line className={laneStroke(props.layout.commitLane)} x1={commitX} x2={commitX} y1={0} y2={middle} />}
        {props.layout.bottomLanes.map(lane => (
          <line className={laneStroke(lane)} key={`bottom-${lane}`} x1={laneCenter(lane)} x2={laneCenter(lane)} y1={middle} y2={props.height} />
        ))}
        {props.layout.edges.map((edge, index) => {
          const toX = laneCenter(edge.toLane)
          return (
            <path
              className={laneStroke(edge.toLane)}
              d={
                commitX === toX
                  ? `M ${commitX} ${middle} V ${props.height}`
                  : `M ${commitX} ${middle} C ${commitX} ${middle + 6}, ${toX} ${middle + 4}, ${toX} ${props.height}`
              }
              key={`${edge.fromLane}-${edge.toLane}-${index}`}
              strokeDasharray={edge.dashed ? '2 3' : undefined}
            />
          )
        })}
      </g>
      {props.revision.immutable && !props.revision.workingCopy ? (
        <path
          className={cn('dshx:fill-background', stroke)}
          d={`M ${commitX} ${middle - 4.5} L ${commitX + 4.5} ${middle} L ${commitX} ${middle + 4.5} L ${commitX - 4.5} ${middle} Z`}
          strokeWidth={1.5}
        />
      ) : (
        <circle className={nodeClass} cx={commitX} cy={middle} r={props.revision.workingCopy ? 4.5 : 3.75} strokeWidth={1.5} />
      )}
    </svg>
  )
}

interface RevisionRowProps {
  readonly revision: Revision
  readonly expanded: boolean
  readonly dimmed: boolean
  readonly dropTarget: boolean
  readonly graphLayout: RevisionGraphRow
  readonly graphWidth: number
  readonly sidePanel: boolean
  readonly menu: ReactNode
  readonly bookmarkMenu: (name: string, local: boolean) => ReactNode
  readonly onToggle: () => void
  readonly onDragStart: () => void
  readonly onDragEnter: (event: DragEvent) => void
  readonly onDrop: (event: DragEvent) => void
  readonly children: ReactNode
}

const RevisionRow = (props: RevisionRowProps): JSX.Element => {
  const revision = props.revision
  const rowHeight = props.sidePanel ? 26 : 30
  const continuingLanes = [...new Set([...props.graphLayout.bottomLanes, ...props.graphLayout.edges.map(edge => edge.toLane)])]
  const draggable = !revision.immutable
  return (
    <article
      className={cn('dshx:group/row dshx:relative', props.expanded && 'dshx:bg-muted-foreground/[0.07]', props.dimmed && 'dshx:opacity-40')}
      onDragEnter={props.onDragEnter}
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
              'dshx:flex dshx:items-center dshx:gap-1 dshx:pr-3 dshx:hover:bg-accent',
              props.dropTarget && 'dshx:bg-primary/10 dshx:ring-1 dshx:ring-primary dshx:ring-inset',
            )}
            draggable={draggable}
            onDragStart={event => {
              event.dataTransfer.setData(REVISION_MIME, revision.commitId)
              event.dataTransfer.effectAllowed = 'move'
              props.onDragStart()
            }}
            style={{ height: rowHeight }}
            title={draggable ? 'Drag onto another revision to rebase · right-click for actions' : 'Right-click for actions'}
          >
            <RevisionGraphCell height={rowHeight} layout={props.graphLayout} revision={revision} width={props.graphWidth} />
            <button
              aria-expanded={props.expanded}
              className="dshx:flex dshx:h-full dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-1.5 dshx:text-left dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50"
              onClick={props.onToggle}
              type="button"
            >
              <ChevronRightIcon
                className={cn('dshx:size-3 dshx:flex-none dshx:text-muted-foreground dshx:transition-transform', props.expanded && 'dshx:rotate-90')}
              />
              {revision.workingCopy && (
                <Badge className="dshx:h-[18px] dshx:rounded-sm dshx:px-1.5 dshx:py-0 dshx:text-[11px] dshx:font-semibold">Editing</Badge>
              )}
              {revision.bookmarks.map(name => {
                const local = revision.localBookmarks.includes(name)
                return (
                  <ContextMenu key={name}>
                    <ContextMenuTrigger asChild>
                      <span
                        className={cn('dshx:flex dshx:flex-none', local && 'dshx:cursor-grab')}
                        draggable={local}
                        onContextMenu={event => event.stopPropagation()}
                        onDragStart={event => {
                          event.stopPropagation()
                          event.dataTransfer.setData(BOOKMARK_MIME, name)
                          event.dataTransfer.effectAllowed = 'move'
                        }}
                        title={local ? 'Drag onto a revision to move · right-click for actions' : 'Remote bookmark'}
                      >
                        <Badge
                          className={cn(COMPACT_BADGE, local ? 'dshx:border-warning/40 dshx:bg-warning/10 dshx:text-foreground' : 'dshx:text-muted-foreground')}
                          variant="outline"
                        >
                          {name}
                        </Badge>
                      </span>
                    </ContextMenuTrigger>
                    {props.bookmarkMenu(name, local)}
                  </ContextMenu>
                )
              })}
              <span
                className={cn(
                  'dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm',
                  revision.workingCopy ? 'dshx:font-semibold' : 'dshx:font-medium',
                  revision.description.trim().length === 0 && 'dshx:font-normal dshx:text-muted-foreground dshx:italic',
                )}
              >
                {firstLine(revision.description)}
              </span>
              {revision.tags.map(name => (
                <Badge className={COMPACT_BADGE} key={name} variant="outline">
                  tag {name}
                </Badge>
              ))}
              {revision.workspaces.map(workspace => (
                <Badge className={COMPACT_BADGE} key={workspace} variant="success">
                  {workspace}
                </Badge>
              ))}
              {revision.evolved && (
                <span
                  aria-label="evolved"
                  className="dshx:size-1.5 dshx:flex-none dshx:rounded-full dshx:bg-chart-4"
                  role="img"
                  title="Evolved: rewritten from an earlier commit"
                />
              )}
              {revision.conflict && (
                <Badge className={cn(COMPACT_BADGE, 'dshx:border-destructive/40 dshx:bg-destructive/10 dshx:text-destructive')} variant="outline">
                  conflict
                </Badge>
              )}
              {revision.divergent && (
                <Badge className={cn(COMPACT_BADGE, 'dshx:border-destructive/40 dshx:bg-destructive/10 dshx:text-destructive')} variant="outline">
                  divergent
                </Badge>
              )}
            </button>
            <time className="dshx:flex-none dshx:pl-1 dshx:font-mono dshx:text-xs dshx:text-muted-foreground" dateTime={revision.authorTime}>
              {formatAge(revision.authorTime)}
            </time>
            <span
              className="dshx:min-w-[2ch] dshx:flex-none dshx:text-right dshx:font-mono dshx:text-xs dshx:font-semibold dshx:text-info"
              title={revision.changeId}
            >
              {revision.shortestChangeId}
            </span>
            {draggable && (
              <GripVerticalIcon
                aria-hidden
                className="dshx:size-3.5 dshx:flex-none dshx:cursor-grab dshx:text-muted-foreground dshx:opacity-0 dshx:group-hover/row:opacity-100"
              />
            )}
          </div>
        </ContextMenuTrigger>
        {props.menu}
      </ContextMenu>
      {props.expanded && (
        <div className="dshx:relative" style={{ paddingLeft: props.graphWidth + 18 }}>
          <svg aria-hidden className="dshx:absolute dshx:inset-y-0 dshx:left-0 dshx:h-full" width={props.graphWidth}>
            {continuingLanes.map(lane => (
              <line
                className={laneStroke(lane)}
                key={lane}
                strokeOpacity={0.8}
                strokeWidth={1.25}
                x1={laneCenter(lane)}
                x2={laneCenter(lane)}
                y1="0"
                y2="100%"
              />
            ))}
          </svg>
          {props.children}
        </div>
      )}
    </article>
  )
}
