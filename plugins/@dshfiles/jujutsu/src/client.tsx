import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { ISessions, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@dshfiles/plugin-ui/components/ui/empty'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@dshfiles/plugin-ui/components/ui/input-group'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dshfiles/plugin-ui/components/ui/tabs'
import { Textarea } from '@dshfiles/plugin-ui/components/ui/textarea'
import { Toggle } from '@dshfiles/plugin-ui/components/ui/toggle'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { CalendarIcon, ChevronRightIcon, EllipsisVerticalIcon, RefreshCwIcon, SearchIcon, UserIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { z } from 'zod'
import type { Mutation, Revision } from './api.js'
import { describeDraftChanged, layoutRevisionGraph, matchesRevisionSearch, type RevisionGraphRow } from './graph.js'
import { jujutsuApi } from './api.js'
import { SessionForkPanel } from './session-fork-panel.js'
import { WorkspaceProvisioner } from './workspace-provisioner.js'
import { WorkspaceRestorePanel } from './workspace-restore-panel.js'
import { isFileReviewed, readReviewStore, reviewProgress, toggleFileReview, type ReviewFile, type ReviewStore } from './review-progress.js'

type View = 'graph' | 'source'

interface RevisionSelection {
  readonly commitId: string
  readonly changeId: string
}

interface JujutsuPanelProps {
  readonly surface?: 'main' | 'side-panel'
  readonly sessions: ISessions
  readonly openSession: (sessionId: SessionSummary['id']) => void
  readonly pickDirectory: () => Promise<string | null>
  readonly launchSession: (cwd: string) => Promise<void>
}

const REPO_HISTORY_KEY = 'dshfiles.jujutsu.repositories'
const SELECTED_REPO_KEY = 'dshfiles.jujutsu.selected'
const REVIEW_PROGRESS_KEY = 'dshfiles.jujutsu.review-progress.v1'
const REPO_HISTORY_LIMIT = 12
const ANCESTOR_LIMIT_OPTIONS = ['1', '2', '3', '4', '5', '8', '10']
const LANE_GAP = 10
const LANE_OFFSET = 8
const LANE_STROKES = ['dshx:stroke-chart-1', 'dshx:stroke-chart-2', 'dshx:stroke-chart-3', 'dshx:stroke-chart-4', 'dshx:stroke-chart-5'] as const

const SECTION_HEADING = 'dshx:flex dshx:items-center dshx:gap-2 dshx:px-3 dshx:pt-3 dshx:pb-1.5 dshx:text-[11px] dshx:font-semibold dshx:uppercase dshx:tracking-wide dshx:text-muted-foreground'
const COMPACT_TEXTAREA = 'dshx:min-h-12 dshx:px-2 dshx:py-1.5 dshx:text-xs dshx:md:text-xs'
const CODE_BLOCK =
  'dshx:max-h-80 dshx:overflow-auto dshx:rounded-md dshx:border dshx:bg-muted/40 dshx:p-2 dshx:font-mono dshx:text-[11px] dshx:leading-snug dshx:whitespace-pre'
const DISCLOSURE_TRIGGER =
  'dshx:group/disclosure dshx:flex dshx:items-center dshx:gap-1 dshx:py-1 dshx:text-[11px] dshx:font-semibold dshx:uppercase dshx:tracking-wide dshx:text-muted-foreground dshx:hover:text-foreground'
const COMPACT_BADGE = 'dshx:h-4 dshx:max-w-40 dshx:rounded-sm dshx:px-1.5 dshx:py-0 dshx:font-mono dshx:text-[10px] dshx:leading-none'

const repoHistorySchema = z.array(z.string()).catch([])

const jujutsuKeys = {
  repository: (repoId: string) => ['jujutsu', repoId] as const,
  state: (repoId: string) => ['jujutsu', repoId, 'state'] as const,
  details: (repoId: string, commitId: string) => ['jujutsu', repoId, 'details', commitId] as const,
  workingDiff: (repoId: string) => ['jujutsu', repoId, 'working-diff'] as const,
}

const readStorage = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const readRepoHistory = (): readonly string[] => {
  try {
    return repoHistorySchema.parse(JSON.parse(readStorage(REPO_HISTORY_KEY) ?? '[]')).slice(0, REPO_HISTORY_LIMIT)
  } catch {
    return []
  }
}

const relativeTime = (value: string): string => {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return 'unknown time'
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000))
  if (seconds < 60) return 'now'
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm'
  if (seconds < 86_400) return Math.floor(seconds / 3600) + 'h'
  if (seconds < 604_800) return Math.floor(seconds / 86_400) + 'd'
  return new Date(time).toLocaleDateString()
}

const dayLabel = (value: string): string => {
  const time = Date.parse(value)
  return Number.isFinite(time)
    ? new Date(time).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
    : 'Date unavailable'
}

const safeSplitPath = (path: string): boolean =>
  path.length > 0 &&
  path.length <= 1024 &&
  !path.includes('\0') &&
  !path.includes('\n') &&
  !path.includes('\r') &&
  !path.startsWith('/') &&
  path.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..')

const groupRows = (revisions: readonly Revision[]): readonly { readonly day: string; readonly rows: readonly Revision[] }[] => {
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

export const JujutsuPanel = (props: JujutsuPanelProps): JSX.Element => {
  const sidePanel = props.surface === 'side-panel'
  const api = useApi(jujutsuApi)
  const queryClient = useQueryClient()
  const autoRegisterPath = useRef<string | null>(null)
  const [path, setPath] = useState(() => readStorage(SELECTED_REPO_KEY) ?? '')
  const [repoId, setRepoId] = useState<string | null>(null)
  const [repoHistory, setRepoHistory] = useState(readRepoHistory)
  const [view, setView] = useState<View>('graph')
  const [authorFilter, setAuthorFilter] = useState('')
  const [textFilter, setTextFilter] = useState('')
  const [mineOnly, setMineOnly] = useState(false)
  const [hideImmutable, setHideImmutable] = useState(false)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [showSearch, setShowSearch] = useState(!sidePanel)
  const [showDates, setShowDates] = useState(false)
  const [selection, setSelection] = useState<RevisionSelection | null>(null)
  const [reviewStore, setReviewStore] = useState<ReviewStore>(() => readReviewStore(readStorage(REVIEW_PROGRESS_KEY)))
  const [hideReviewedFiles, setHideReviewedFiles] = useState(false)
  const [reviewNotice, setReviewNotice] = useState('')
  const [describeDrafts, setDescribeDrafts] = useState<Readonly<Record<string, string>>>({})
  const [remote, setRemote] = useState('')
  const [bookmark, setBookmark] = useState('')
  const [ancestorLimit, setAncestorLimit] = useState(5)
  const [splitPaths, setSplitPaths] = useState<readonly string[]>([])
  const [splitText, setSplitText] = useState('')
  const [squashText, setSquashText] = useState('')
  const [squashTarget, setSquashTarget] = useState('')
  const [showWorkingDiff, setShowWorkingDiff] = useState(false)
  const [provisionedPath, setProvisionedPath] = useState<string | null>(null)

  const stateQuery = useQuery({
    queryKey: jujutsuKeys.state(repoId ?? ''),
    queryFn: ({ signal }) => api.load({ repoId: repoId ?? '', limit: 300 }, { signal }),
    enabled: repoId !== null,
  })
  const state = stateQuery.data

  const selectedRevision = useMemo(() => {
    if (state === undefined || selection === null) return undefined
    return state.revisions.find(row => row.commitId === selection.commitId) ?? state.revisions.find(row => row.changeId === selection.changeId)
  }, [state, selection])

  const detailsQuery = useQuery({
    queryKey: jujutsuKeys.details(repoId ?? '', selectedRevision?.commitId ?? ''),
    queryFn: ({ signal }) => api.details({ repoId: repoId ?? '', commitId: selectedRevision?.commitId ?? '' }, { signal }),
    enabled: repoId !== null && selectedRevision !== undefined,
  })
  const details = detailsQuery.data
  const selectedReviewProgress = reviewProgress(reviewStore, state?.root ?? '', selectedRevision?.commitId ?? '', details?.files ?? [])

  const workingDiffQuery = useQuery({
    queryKey: jujutsuKeys.workingDiff(repoId ?? ''),
    queryFn: ({ signal }) => api.workingDiff({ repoId: repoId ?? '' }, { signal }),
    enabled: repoId !== null && showWorkingDiff,
  })

  const prepareMutation = useMutation({
    mutationFn: (input: { readonly repoId: string; readonly action: Mutation }) => api.prepare(input),
  })
  const preview = prepareMutation.data

  const confirmMutation = useMutation({
    mutationFn: (input: { readonly repoId: string; readonly previewId: string }) => api.confirm(input),
    onSuccess: result => {
      if (result.workspacePath !== null) setProvisionedPath(result.workspacePath)
    },
    onSettled: (_result, _error, input) => queryClient.invalidateQueries({ queryKey: jujutsuKeys.repository(input.repoId) }),
  })

  const registerMutation = useMutation({
    mutationFn: (repositoryPath: string) => api.registerRepository({ path: repositoryPath }),
    onSuccess: registered => {
      prepareMutation.reset()
      setProvisionedPath(null)
      setRepoId(registered.repoId)
      setPath(registered.root)
      setSelection(null)
      setDescribeDrafts({})
      setShowWorkingDiff(false)
      const nextHistory = [registered.root, ...repoHistory.filter(item => item !== registered.root)].slice(0, REPO_HISTORY_LIMIT)
      setRepoHistory(nextHistory)
      localStorage.setItem(REPO_HISTORY_KEY, JSON.stringify(nextHistory))
      localStorage.setItem(SELECTED_REPO_KEY, registered.root)
      void queryClient.invalidateQueries({ queryKey: jujutsuKeys.repository(registered.repoId) })
    },
  })

  useEffect(() => {
    const selectedPath = path.trim()
    if (!sidePanel || repoId !== null || selectedPath.length === 0 || autoRegisterPath.current === selectedPath) return
    autoRegisterPath.current = selectedPath
    registerMutation.mutate(selectedPath)
  }, [sidePanel, path, repoId, registerMutation.mutate])

  useEffect(() => {
    if (state === undefined) return
    const visibleCommitIds = new Set(state.revisions.map(row => row.commitId))
    setDescribeDrafts(current => Object.fromEntries(Object.entries(current).filter(([commitId]) => visibleCommitIds.has(commitId))))
  }, [state])

  const busy = registerMutation.isPending || stateQuery.isFetching || confirmMutation.isPending
  const loadingRepository = repoId !== null && state === undefined && stateQuery.isFetching

  const remoteNames = state?.remoteNames ?? []
  const selectedRemote = remoteNames.includes(remote) ? remote : (remoteNames[0] ?? '')
  const localBookmarkNames = useMemo(() => [...new Set(state?.revisions.flatMap(row => row.localBookmarks) ?? [])], [state])
  const workingCopy = state?.revisions.find(revision => revision.workingCopy)
  const defaultBookmark = workingCopy?.localBookmarks[0] ?? localBookmarkNames[0] ?? ''
  const selectedBookmark = localBookmarkNames.includes(bookmark) ? bookmark : defaultBookmark

  const visibleRevisions = useMemo(() => {
    if (state === undefined) return []
    return state.revisions.filter(revision => {
      if (mineOnly && !revision.mine) return false
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
  const groups = useMemo(() => groupRows(visibleRevisions), [visibleRevisions])
  const selectedDescribeText =
    selectedRevision === undefined ? '' : (describeDrafts[selectedRevision.commitId] ?? editableDescription(selectedRevision.description))
  const workingDescribeText = workingCopy === undefined ? '' : (describeDrafts[workingCopy.commitId] ?? editableDescription(workingCopy.description))
  const selectedDescribeChanged = selectedRevision !== undefined && describeDraftChanged(selectedDescribeText, selectedRevision.description)
  const workingDescribeChanged = workingCopy !== undefined && describeDraftChanged(workingDescribeText, workingCopy.description)

  const ancestors = useMemo(() => {
    if (workingCopy === undefined) return []
    const result: { readonly depth: number; readonly revision: Revision }[] = []
    let cursor = workingCopy
    for (let depth = 1; depth <= ancestorLimit; depth += 1) {
      const parentId = cursor.parents[0]
      if (parentId === undefined) break
      const parent = revisionsByCommitId.get(parentId)
      if (parent === undefined) break
      result.push({ depth, revision: parent })
      cursor = parent
    }
    return result
  }, [revisionsByCommitId, workingCopy, ancestorLimit])

  const errorMessages = [
    stateQuery.error && errorMessage(stateQuery.error, 'Could not load this repository.'),
    detailsQuery.error && errorMessage(detailsQuery.error, 'Could not load revision details.'),
    workingDiffQuery.error && errorMessage(workingDiffQuery.error, 'Could not load the working-copy diff.'),
    registerMutation.error && errorMessage(registerMutation.error, 'Could not register this repository.'),
    prepareMutation.error && errorMessage(prepareMutation.error, 'Could not prepare this action.'),
    confirmMutation.error && errorMessage(confirmMutation.error, 'Action was not completed.'),
  ].filter((message): message is string => Boolean(message))

  const askForConfirmation = (action: Mutation): void => {
    if (repoId === null) return
    if (action.kind === 'workspace-add') setProvisionedPath(null)
    registerMutation.reset()
    confirmMutation.reset()
    prepareMutation.mutate({ repoId, action })
  }

  const confirmPreview = (): void => {
    if (repoId === null || preview === undefined) return
    const previewId = preview.id
    prepareMutation.reset()
    confirmMutation.mutate({ repoId, previewId })
  }

  const refreshRepository = (): void => {
    if (repoId !== null) void queryClient.invalidateQueries({ queryKey: jujutsuKeys.repository(repoId) })
  }

  const updateFileReview = (file: ReviewFile, reviewed: boolean): void => {
    if (state === undefined || selectedRevision === undefined || file.contentDigest === null) return
    const next = toggleFileReview(
      reviewStore,
      {
        repositoryRoot: state.root,
        commitId: selectedRevision.commitId,
        path: file.path,
        contentDigest: file.contentDigest,
        reviewedAt: new Date().toISOString(),
      },
      reviewed,
    )
    try {
      localStorage.setItem(REVIEW_PROGRESS_KEY, JSON.stringify(next))
      setReviewStore(next)
      setReviewNotice(reviewed ? 'Review progress saved in this browser.' : 'Review mark cleared.')
    } catch {
      setReviewNotice('Browser storage is unavailable. Review progress was not changed.')
    }
  }

  const dropOn = (event: DragEvent, revision: Revision): void => {
    event.preventDefault()
    const draggedBookmark = event.dataTransfer.getData('application/x-jujutsu-bookmark')
    const draggedRevision = event.dataTransfer.getData('application/x-jujutsu-revision')
    if (draggedBookmark) askForConfirmation({ kind: 'bookmark-move', bookmark: draggedBookmark, destinationId: revision.commitId })
    else if (draggedRevision) askForConfirmation({ kind: 'rebase', sourceId: draggedRevision, destinationId: revision.commitId })
  }

  const toggleRevision = (revision: Revision): void =>
    setSelection(current => (current?.commitId === revision.commitId ? null : { commitId: revision.commitId, changeId: revision.changeId }))

  const pathMatchesLoadedRepository = state !== undefined && path.trim() === state.root
  const lastPushLabel =
    state === undefined
      ? ''
      : state.lastPushAt
        ? relativeTime(state.lastPushAt) + (state.lastPushHistoryTruncated ? ' · scan limited' : '')
        : state.lastPushHistoryTruncated
          ? 'not found before the operation-history limit'
          : 'not found in the latest 1,000 operations'

  const revisionDetails = (revision: Revision): ReactNode => {
    const repositoryRoot = state?.root ?? ''
    const visibleFiles = details?.files.filter(file => !hideReviewedFiles || !isFileReviewed(reviewStore, repositoryRoot, revision.commitId, file)) ?? []
    return (
      <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:py-2 dshx:pr-3 dshx:text-xs">
        {revision.description.includes('\n') && (
          <p className="dshx:whitespace-pre-wrap dshx:text-muted-foreground">{editableDescription(revision.description)}</p>
        )}
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1.5 dshx:text-muted-foreground">
          <span>{revision.author || 'Unknown author'}</span>
          <span aria-hidden>·</span>
          <time dateTime={revision.authorTime}>{new Date(revision.authorTime).toLocaleString()}</time>
          <span aria-hidden>·</span>
          <span className="dshx:font-mono" title={revision.commitId}>
            {revision.commitId.slice(0, 12)}
          </span>
          {revision.immutable && (
            <Badge className={COMPACT_BADGE} variant="outline">
              immutable
            </Badge>
          )}
        </div>
        {!revision.immutable && (
          <div className="dshx:flex dshx:items-start dshx:gap-1.5">
            <Textarea
              aria-label="New description"
              className={COMPACT_TEXTAREA}
              onChange={event => setDescribeDrafts(current => ({ ...current, [revision.commitId]: event.target.value }))}
              rows={2}
              value={selectedDescribeText}
            />
            <Button
              disabled={!selectedDescribeChanged}
              onClick={() => askForConfirmation({ kind: 'describe', commitId: revision.commitId, message: selectedDescribeText })}
              size="xs"
              type="button"
              variant="outline"
            >
              Preview describe
            </Button>
          </div>
        )}
        {details === undefined ? (
          <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-muted-foreground">
            <Spinner className="dshx:size-3" />
            Loading revision details…
          </div>
        ) : (
          <>
            <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-x-2 dshx:gap-y-1 dshx:text-[11px] dshx:text-muted-foreground">
              <span className="dshx:font-semibold dshx:uppercase dshx:tracking-wide">Files</span>
              <span className="dshx:font-mono">{details.files.length}</span>
              <span className="dshx:font-mono dshx:text-success">+{details.additions}</span>
              <span className="dshx:font-mono dshx:text-destructive">−{details.deletions}</span>
              <span>
                {selectedReviewProgress.reviewed}/{selectedReviewProgress.total} files reviewed
              </span>
              {details.truncated && (
                <Badge className={COMPACT_BADGE} variant="warning">
                  diff truncated; counts partial
                </Badge>
              )}
              <Label className="dshx:ml-auto dshx:gap-1.5 dshx:text-[11px] dshx:font-normal">
                <Checkbox checked={hideReviewedFiles} className="dshx:size-3.5" onCheckedChange={checked => setHideReviewedFiles(checked === true)} />
                Hide reviewed files
              </Label>
            </div>
            {reviewNotice.length > 0 && (
              <p className="dshx:text-muted-foreground" role="status">
                {reviewNotice}
              </p>
            )}
            <ul className="dshx:ml-1 dshx:flex dshx:flex-col dshx:border-l dshx:pl-2">
              {visibleFiles.map(file => (
                <li className="dshx:flex dshx:h-6 dshx:items-center dshx:gap-2 dshx:rounded-sm dshx:px-1 dshx:hover:bg-accent" key={file.path}>
                  <Checkbox
                    aria-label={`Mark ${file.path} reviewed`}
                    checked={isFileReviewed(reviewStore, repositoryRoot, revision.commitId, file)}
                    className="dshx:size-3.5"
                    disabled={file.contentDigest === null}
                    onCheckedChange={checked => updateFileReview(file, checked === true)}
                  />
                  <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:font-mono dshx:text-[11px]" title={file.path}>
                    {file.path}
                  </span>
                  <span className="dshx:font-mono dshx:text-[11px] dshx:text-success">+{file.additions}</span>
                  <span className="dshx:font-mono dshx:text-[11px] dshx:text-destructive">−{file.deletions}</span>
                </li>
              ))}
            </ul>
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
            <Collapsible defaultOpen={!sidePanel}>
              <CollapsibleTrigger className={DISCLOSURE_TRIGGER}>
                <ChevronRightIcon className="dshx:size-3 dshx:transition-transform dshx:group-data-[state=open]/disclosure:rotate-90" />
                Diff
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className={CODE_BLOCK}>{details.patch}</pre>
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
              onPressedChange={setMineOnly}
              pressed={mineOnly}
              size="sm"
            >
              <UserIcon className="dshx:size-3.5" />
              Mine
            </Toggle>
            <Label className="dshx:gap-1.5 dshx:px-1.5 dshx:font-mono dshx:text-xs dshx:font-normal dshx:text-muted-foreground">
              <Checkbox checked={hideImmutable} onCheckedChange={checked => setHideImmutable(checked === true)} />
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
        <div className="dshx:min-h-0 dshx:flex-1 dshx:overflow-auto dshx:overscroll-contain dshx:pb-4">
          {groups.map(group => {
            const firstLayout = group.rows.map(revision => graphRowsByCommitId.get(revision.commitId)).find(layout => layout !== undefined)
            return (
              <section aria-label={group.day} key={group.day}>
                <div className="dshx:sticky dshx:top-0 dshx:z-10 dshx:flex dshx:h-[18px] dshx:items-center dshx:gap-1 dshx:border-b dshx:border-border/60 dshx:bg-background dshx:pr-3 dshx:text-[10px] dshx:font-semibold dshx:uppercase dshx:tracking-wider dshx:text-muted-foreground">
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
                  <span className="dshx:truncate">{group.day}</span>
                  <span className="dshx:ml-auto dshx:font-mono dshx:font-normal">{group.rows.length}</span>
                </div>
                {group.rows.map(revision => {
                  const graphLayout = graphRowsByCommitId.get(revision.commitId)
                  if (graphLayout === undefined) return null
                  const expanded = selectedRevision?.commitId === revision.commitId
                  return (
                    <RevisionRow
                      expanded={expanded}
                      graphLayout={graphLayout}
                      graphWidth={graphWidth}
                      key={revision.commitId}
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

  const sourceView =
    state === undefined ? null : (
      <div className={cn('dshx:grid dshx:content-start dshx:pb-4', !sidePanel && 'dshx:md:grid-cols-2 dshx:md:divide-x')}>
        <section aria-labelledby="jj-working-copy-heading" className="dshx:flex dshx:min-w-0 dshx:flex-col">
          <h2 className={SECTION_HEADING} id="jj-working-copy-heading">
            Working copy
            <span className="dshx:rounded-full dshx:bg-muted dshx:px-1.5 dshx:font-mono dshx:text-[10px] dshx:font-normal">{state.changedPaths.length}</span>
            <Button
              className="dshx:ml-auto dshx:normal-case dshx:tracking-normal"
              onClick={() => {
                if (showWorkingDiff) void workingDiffQuery.refetch()
                else setShowWorkingDiff(true)
              }}
              size="xs"
              type="button"
              variant="ghost"
            >
              Show full diff
            </Button>
          </h2>
          {state.changedPaths.length === 0 ? (
            <p className="dshx:px-3 dshx:text-xs dshx:text-muted-foreground">Clean working copy.</p>
          ) : (
            <ul aria-label="Split selected files from @" className="dshx:flex dshx:flex-col dshx:px-2">
              {state.changedPaths.map(file => {
                const selectable = safeSplitPath(file)
                return (
                  <li key={file}>
                    <Label
                      className={cn(
                        'dshx:h-6 dshx:gap-2 dshx:rounded-sm dshx:px-1 dshx:text-xs dshx:font-normal dshx:hover:bg-accent',
                        !selectable && 'dshx:text-muted-foreground',
                      )}
                    >
                      <Checkbox
                        checked={splitPaths.includes(file)}
                        className="dshx:size-3.5"
                        disabled={!selectable}
                        onCheckedChange={checked => setSplitPaths(current => (checked === true ? [...current, file] : current.filter(item => item !== file)))}
                      />
                      <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:font-mono dshx:text-[11px]" title={file}>
                        {selectable ? file : `${file} — unsafe path format unavailable`}
                      </span>
                    </Label>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="dshx:flex dshx:flex-col dshx:gap-1 dshx:px-3 dshx:pt-1">
            <Collapsible>
              <CollapsibleTrigger className={DISCLOSURE_TRIGGER}>
                <ChevronRightIcon className="dshx:size-3 dshx:transition-transform dshx:group-data-[state=open]/disclosure:rotate-90" />
                jj status
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className={CODE_BLOCK}>{state.status || 'Clean working copy.'}</pre>
              </CollapsibleContent>
            </Collapsible>
            {workingDiffQuery.data !== undefined && (
              <Collapsible defaultOpen>
                <CollapsibleTrigger className={DISCLOSURE_TRIGGER}>
                  <ChevronRightIcon className="dshx:size-3 dshx:transition-transform dshx:group-data-[state=open]/disclosure:rotate-90" />
                  Working-copy diff
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className={CODE_BLOCK}>{workingDiffQuery.data.patch}</pre>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
          <h3 className={SECTION_HEADING}>Describe working copy</h3>
          <div className="dshx:flex dshx:flex-col dshx:items-end dshx:gap-1.5 dshx:px-3">
            <Textarea
              aria-label="Working copy description"
              className={COMPACT_TEXTAREA}
              onChange={event => workingCopy && setDescribeDrafts(current => ({ ...current, [workingCopy.commitId]: event.target.value }))}
              rows={2}
              value={workingDescribeText}
            />
            {workingCopy && (
              <Button
                disabled={!workingDescribeChanged}
                onClick={() => askForConfirmation({ kind: 'describe', commitId: workingCopy.commitId, message: workingDescribeText })}
                size="xs"
                type="button"
              >
                Preview describe
              </Button>
            )}
          </div>
          <h3 className={SECTION_HEADING}>Split selected files from @</h3>
          <div className="dshx:flex dshx:flex-col dshx:items-end dshx:gap-1.5 dshx:px-3">
            <Textarea
              aria-label="Split description"
              className={COMPACT_TEXTAREA}
              onChange={event => setSplitText(event.target.value)}
              placeholder="Description for selected changes"
              rows={2}
              value={splitText}
            />
            {workingCopy && (
              <Button
                disabled={splitPaths.length === 0 || splitText.trim().length === 0}
                onClick={() => askForConfirmation({ kind: 'split', commitId: workingCopy.commitId, paths: [...splitPaths], message: splitText })}
                size="xs"
                type="button"
              >
                Preview split{splitPaths.length > 0 ? ` (${splitPaths.length})` : ''}
              </Button>
            )}
          </div>
        </section>
        <section aria-labelledby="jj-ancestor-heading" className="dshx:flex dshx:min-w-0 dshx:flex-col">
          <h2 className={SECTION_HEADING} id="jj-ancestor-heading">
            Ancestor groups
            <Select onValueChange={value => setAncestorLimit(Number(value))} value={String(ancestorLimit)}>
              <SelectTrigger aria-label="Ancestor groups" className="dshx:ml-auto dshx:h-6 dshx:gap-1 dshx:px-2 dshx:text-xs dshx:font-normal" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ANCESTOR_LIMIT_OPTIONS.map(option => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </h2>
          <div className="dshx:flex dshx:flex-col dshx:px-2">
            {ancestors.map(({ depth, revision }) => (
              <button
                aria-pressed={squashTarget === revision.commitId}
                className="dshx:flex dshx:h-7 dshx:items-center dshx:gap-2 dshx:rounded-sm dshx:px-1.5 dshx:text-left dshx:text-sm dshx:hover:bg-accent dshx:aria-pressed:bg-accent"
                key={revision.commitId}
                onClick={() => setSquashTarget(revision.commitId)}
                type="button"
              >
                <span className="dshx:w-8 dshx:flex-none dshx:font-mono! dshx:text-xs dshx:text-muted-foreground">@-{depth}</span>
                <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{firstLine(revision.description)}</span>
                <span className="dshx:font-mono! dshx:text-xs dshx:font-semibold dshx:text-info">{revision.shortestChangeId}</span>
              </button>
            ))}
            {ancestors.length === 0 && <p className="dshx:px-1 dshx:text-xs dshx:text-muted-foreground">No visible @-1 ancestors in this graph window.</p>}
          </div>
          <h3 className={SECTION_HEADING}>Squash working copy into ancestor</h3>
          <div className="dshx:flex dshx:flex-col dshx:items-end dshx:gap-1.5 dshx:px-3">
            <Select onValueChange={setSquashTarget} value={squashTarget}>
              <SelectTrigger aria-label="Squash destination" className="dshx:w-full dshx:text-xs" size="sm">
                <SelectValue placeholder="Choose an ancestor" />
              </SelectTrigger>
              <SelectContent>
                {ancestors.map(({ depth, revision }) => (
                  <SelectItem key={revision.commitId} value={revision.commitId}>
                    @-{depth} · {revision.shortestChangeId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              aria-label="Squash description"
              className={COMPACT_TEXTAREA}
              onChange={event => setSquashText(event.target.value)}
              placeholder="Resulting description"
              rows={2}
              value={squashText}
            />
            {workingCopy && (
              <Button
                disabled={!squashTarget || squashText.trim().length === 0}
                onClick={() => askForConfirmation({ kind: 'squash', sourceId: workingCopy.commitId, destinationId: squashTarget, message: squashText })}
                size="xs"
                type="button"
              >
                Preview squash
              </Button>
            )}
          </div>
        </section>
      </div>
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
            {loadingRepository ? 'Loading repository…' : 'Choose a repository path above to open its revision graph.'}
          </EmptyTitle>
        </EmptyHeader>
      </Empty>
    ) : null

  const tabsContent = (
    <>
      <TabsContent className="dshx:flex dshx:min-h-0 dshx:flex-col" value="graph">
        {emptyState ?? graphView}
      </TabsContent>
      <TabsContent className="dshx:min-h-0 dshx:overflow-auto" value="source">
        {emptyState ?? sourceView}
      </TabsContent>
    </>
  )

  return (
    <main className="dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:overflow-hidden dshx:bg-background dshx:text-foreground">
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button aria-label="Repository actions" className="dshx:ml-auto" size="icon-sm" type="button" variant="outline">
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
                      <div className="dshx:flex dshx:flex-col dshx:gap-1 dshx:px-2 dshx:py-1.5 dshx:text-xs dshx:text-muted-foreground">
                        <span title={state.lastPushDescription ?? 'Reads JJ operation argv metadata only.'}>Last recorded JJ push command: {lastPushLabel}</span>
                        {state.evolutionHistoryTruncated && <span>Evolution scan limited; some evolved markers may be missing.</span>}
                      </div>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <form
              className="dshx:flex dshx:items-center dshx:gap-1.5"
              onSubmit={event => {
                event.preventDefault()
                const selectedPath = path.trim()
                if (selectedPath.length === 0) return
                if (pathMatchesLoadedRepository) refreshRepository()
                else registerMutation.mutate(selectedPath)
              }}
            >
              <Input
                aria-label="Repository path"
                className="dshx:min-w-0 dshx:flex-1"
                list="jj-repositories"
                onChange={event => setPath(event.target.value)}
                placeholder="/path/to/repository"
                value={path}
              />
              <datalist id="jj-repositories">
                {repoHistory.map(item => (
                  <option key={item} value={item} />
                ))}
              </datalist>
              <Button
                disabled={repoId === null || selectedRemote === '' || busy}
                onClick={() => askForConfirmation({ kind: 'fetch', remote: selectedRemote })}
                title={selectedRemote === '' ? 'No remote available' : `Fetch from ${selectedRemote}`}
                type="button"
                variant="outline"
              >
                Fetch
              </Button>
              <Button
                disabled={repoId === null || selectedRemote === '' || selectedBookmark === '' || busy}
                onClick={() => askForConfirmation({ kind: 'push', remote: selectedRemote, bookmark: selectedBookmark })}
                title={selectedBookmark === '' ? 'No local bookmark to push' : `Push ${selectedBookmark} to ${selectedRemote}`}
                type="button"
                variant="outline"
              >
                Push
              </Button>
              <Button
                aria-busy={busy}
                aria-label={pathMatchesLoadedRepository ? 'Refresh' : 'Open repository'}
                disabled={busy || path.trim().length === 0}
                size="icon"
                title={pathMatchesLoadedRepository ? 'Refresh' : 'Open repository'}
                type="submit"
                variant="outline"
              >
                {busy ? <Spinner /> : <RefreshCwIcon />}
              </Button>
              {busy && !loadingRepository && (
                <span className="dshx:sr-only" role="status">
                  Working…
                </span>
              )}
            </form>
          </header>

          {(errorMessages.length > 0 || (confirmMutation.data !== undefined && confirmMutation.data.output.length > 0)) && (
            <div className="dshx:flex dshx:flex-none dshx:flex-col dshx:gap-1.5 dshx:border-b dshx:px-3 dshx:py-2">
              {errorMessages.map(message => (
                <Alert className="dshx:px-3 dshx:py-2" key={message} variant="destructive">
                  <AlertDescription className="dshx:text-xs">{message}</AlertDescription>
                </Alert>
              ))}
              {confirmMutation.data !== undefined && confirmMutation.data.output.length > 0 && (
                <Alert className="dshx:px-3 dshx:py-2">
                  <AlertDescription>
                    <pre className="dshx:max-h-40 dshx:w-full dshx:overflow-auto dshx:font-mono dshx:text-[11px] dshx:whitespace-pre-wrap dshx:text-foreground">
                      {confirmMutation.data.output}
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

        <AlertDialog
          onOpenChange={open => {
            if (!open) prepareMutation.reset()
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
                <AlertDialogAction disabled={confirmMutation.isPending} onClick={confirmPreview} size="sm">
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

interface RevisionGraphCellProps {
  readonly revision: Revision
  readonly layout: RevisionGraphRow
  readonly width: number
  readonly height: number
}

const RevisionGraphCell = (props: RevisionGraphCellProps): JSX.Element => {
  const middle = props.height / 2
  const commitX = laneCenter(props.layout.commitLane)
  const nodeClass = props.revision.workingCopy
    ? 'dshx:fill-primary dshx:stroke-primary'
    : cn(
        'dshx:fill-background',
        props.revision.divergent ? 'dshx:stroke-destructive' : props.revision.immutable ? 'dshx:stroke-muted-foreground' : laneStroke(props.layout.commitLane),
      )
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
      <circle className={nodeClass} cx={commitX} cy={middle} r={props.revision.workingCopy ? 4.5 : 3.75} strokeWidth={1.5} />
    </svg>
  )
}

interface RevisionRowProps {
  readonly revision: Revision
  readonly expanded: boolean
  readonly graphLayout: RevisionGraphRow
  readonly graphWidth: number
  readonly sidePanel: boolean
  readonly onToggle: () => void
  readonly onDrop: (event: DragEvent) => void
  readonly children: ReactNode
}

const RevisionRow = (props: RevisionRowProps): JSX.Element => {
  const revision = props.revision
  const rowHeight = props.sidePanel ? 26 : 30
  const continuingLanes = [...new Set([...props.graphLayout.bottomLanes, ...props.graphLayout.edges.map(edge => edge.toLane)])]
  return (
    <article
      className={cn('dshx:group/row dshx:relative', props.expanded && 'dshx:bg-muted-foreground/[0.07]')}
      onDragOver={event => event.preventDefault()}
      onDrop={props.onDrop}
    >
      <div className="dshx:flex dshx:items-center dshx:gap-1 dshx:pr-3 dshx:hover:bg-accent" style={{ height: rowHeight }}>
        <RevisionGraphCell height={rowHeight} layout={props.graphLayout} revision={revision} width={props.graphWidth} />
        <button
          aria-expanded={props.expanded}
          className="dshx:flex dshx:h-full dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-1.5 dshx:text-left dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50"
          onClick={props.onToggle}
          type="button"
        >
          <ChevronRightIcon className={cn('dshx:size-3 dshx:flex-none dshx:text-muted-foreground dshx:transition-transform', props.expanded && 'dshx:rotate-90')} />
          {revision.workingCopy && <Badge className="dshx:h-[18px] dshx:rounded-sm dshx:px-1.5 dshx:py-0 dshx:text-[11px] dshx:font-semibold">Editing</Badge>}
          <span
            className={cn(
              'dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm',
              revision.workingCopy ? 'dshx:font-semibold' : 'dshx:font-medium',
              revision.description.trim().length === 0 && 'dshx:font-normal dshx:text-muted-foreground dshx:italic',
            )}
          >
            {firstLine(revision.description)}
          </span>
          {revision.bookmarks.map(name => {
            const local = revision.localBookmarks.includes(name)
            return (
              <Badge
                className={cn(
                  COMPACT_BADGE,
                  local ? 'dshx:cursor-grab dshx:border-warning/40 dshx:bg-warning/10 dshx:text-foreground' : 'dshx:text-muted-foreground',
                )}
                draggable={local}
                key={name}
                onDragStart={event => {
                  event.dataTransfer.setData('application/x-jujutsu-bookmark', name)
                  event.dataTransfer.effectAllowed = 'move'
                }}
                variant="outline"
              >
                {name}
              </Badge>
            )
          })}
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
          {revision.evolved && <span aria-label="evolved" className="dshx:size-1.5 dshx:flex-none dshx:rounded-full dshx:bg-violet-500" role="img" title="Evolved: rewritten from an earlier commit" />}
          {revision.divergent && (
            <Badge className={cn(COMPACT_BADGE, 'dshx:border-destructive/40 dshx:bg-destructive/10 dshx:text-destructive')} variant="outline">
              divergent
            </Badge>
          )}
        </button>
        <time className="dshx:flex-none dshx:pl-1 dshx:font-mono dshx:text-xs dshx:text-muted-foreground" dateTime={revision.authorTime}>
          {relativeTime(revision.authorTime)}
        </time>
        <span className="dshx:min-w-[2ch] dshx:flex-none dshx:text-right dshx:font-mono dshx:text-xs dshx:font-semibold dshx:text-info" title={revision.changeId}>
          {revision.shortestChangeId}
        </span>
        {!props.sidePanel && (
          <Button
            aria-label="Drag revision to rebase after preview"
            className="dshx:cursor-grab dshx:text-muted-foreground dshx:opacity-0 dshx:group-hover/row:opacity-100 dshx:focus-visible:opacity-100"
            draggable
            onDragStart={event => {
              event.dataTransfer.setData('application/x-jujutsu-revision', revision.commitId)
              event.dataTransfer.effectAllowed = 'move'
            }}
            size="icon-xs"
            title="Drag revision to rebase after preview"
            type="button"
            variant="ghost"
          >
            <span aria-hidden>⠿</span>
          </Button>
        )}
      </div>
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
