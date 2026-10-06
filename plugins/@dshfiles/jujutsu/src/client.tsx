import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { ISessions, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import {
  Button,
  Checkbox,
  IconCloseOutlineRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
  Input,
  SegmentedTabs,
  Tag,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { ConfirmDialog, EmptyState, Field, Notice, Select, TextArea } from '@dshfiles/plugin-ui'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from 'react'
import { z } from 'zod'
import type { Mutation, Revision } from './api.js'
import { describeDraftChanged, layoutRevisionGraph, matchesRevisionSearch, type RevisionGraphRow } from './graph.js'
import { jujutsuApi } from './api.js'
import { SessionForkPanel } from './session-fork-panel.js'
import { WorkspaceProvisioner } from './workspace-provisioner.js'
import { isFileReviewed, readReviewStore, reviewProgress, toggleFileReview, type ReviewFile, type ReviewStore } from './review-progress.js'
import styles from './jujutsu.module.css'

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
const ANCESTOR_LIMIT_OPTIONS = [1, 2, 3, 4, 5, 8, 10].map(count => ({ value: String(count), label: String(count) }))

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

export const JujutsuPanel = (props: JujutsuPanelProps): JSX.Element => {
  const sidePanel = props.surface === 'side-panel'
  const api = useApi(jujutsuApi)
  const queryClient = useQueryClient()
  const viewIdPrefix = useId()
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
  const selectedReviewProgress = reviewProgress(
    reviewStore,
    state?.root ?? '',
    selectedRevision?.commitId ?? '',
    details?.files ?? [],
  )

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
  const graphWidth = graphLaneCount * 14
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

  const selectRevision = (revision: Revision | null): void =>
    setSelection(revision === null ? null : { commitId: revision.commitId, changeId: revision.changeId })

  const views = [
    { value: 'graph', label: 'Revision graph', id: `${viewIdPrefix}-graph`, panelId: `${viewIdPrefix}-graph-panel` },
    { value: 'source', label: 'Source Control', id: `${viewIdPrefix}-source`, panelId: `${viewIdPrefix}-source-panel` },
  ] as const
  const activeView = views.find(item => item.value === view) ?? views[0]

  return (
    <main className={sidePanel ? `${styles.panel} ${styles.sidePanel}` : styles.panel}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title}>Jujutsu</h1>
            <div className={styles.muted}>{state?.root ?? 'Select a repository to inspect its revision graph.'}</div>
          </div>
          <Button
            disabled={busy || repoId === null}
            icon={<IconRefreshOutlineRegular />}
            onClick={() => {
              if (repoId !== null) void queryClient.invalidateQueries({ queryKey: jujutsuKeys.repository(repoId) })
            }}
            size={sidePanel ? 'sm' : undefined}
            type="button"
            variant="outline"
          >
            Refresh
          </Button>
        </div>
        {sidePanel && <SegmentedTabs className={styles.tabs} items={views} label="Jujutsu views" onChange={setView} value={view} />}
        <form
          className={styles.repoForm}
          onSubmit={event => {
            event.preventDefault()
            if (path.trim().length > 0) registerMutation.mutate(path.trim())
          }}
        >
          <div className={styles.repoPathControls}>
            <Input
              aria-label="Repository path"
              className={styles.repoPath}
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
              disabled={busy || path.trim().length === 0}
              size={sidePanel ? 'sm' : undefined}
              type="submit"
              variant={repoId === null ? 'primary' : 'outline'}
            >
              {repoId === null ? 'Open repository' : 'Select repository'}
            </Button>
          </div>
          <div className={styles.repoActionGroup}>
            <Select
              aria-label="Remote"
              disabled={remoteNames.length === 0}
              onValueChange={setRemote}
              options={remoteNames.map(name => ({ value: name, label: name }))}
              value={selectedRemote}
            />
            <Button
              disabled={repoId === null || selectedRemote === '' || busy}
              onClick={() => askForConfirmation({ kind: 'fetch', remote: selectedRemote })}
              size={sidePanel ? 'sm' : undefined}
              type="button"
              variant="outline"
            >
              Fetch
            </Button>
          </div>
          <div className={styles.repoActionGroup}>
            <Select
              aria-label="Bookmark to push"
              disabled={selectedBookmark === ''}
              onValueChange={setBookmark}
              options={localBookmarkNames.map(name => ({ value: name, label: name }))}
              value={selectedBookmark}
            />
            <Button
              disabled={repoId === null || selectedRemote === '' || selectedBookmark === '' || busy}
              onClick={() => askForConfirmation({ kind: 'push', remote: selectedRemote, bookmark: selectedBookmark })}
              size={sidePanel ? 'sm' : undefined}
              type="button"
              variant="outline"
            >
              Push
            </Button>
          </div>
        </form>
        {state !== undefined && (
          <>
            <Tooltip label={state.lastPushDescription ?? 'Reads JJ operation argv metadata only.'} side="bottom">
              <div className={styles.statusLine}>
                Last recorded JJ push command:{' '}
                {state.lastPushAt
                  ? relativeTime(state.lastPushAt) + (state.lastPushHistoryTruncated ? ' · scan limited' : '')
                  : state.lastPushHistoryTruncated
                    ? 'not found before the operation-history limit'
                    : 'not found in the latest 1,000 operations'}
              </div>
            </Tooltip>
            {state.evolutionHistoryTruncated && <div className={styles.statusLine}>Evolution scan limited; some evolved markers may be missing.</div>}
          </>
        )}
        {!sidePanel && <SegmentedTabs className={styles.tabs} items={views} label="Jujutsu views" onChange={setView} value={view} />}
      </header>

      <div className={styles.messages}>
        {errorMessages.map(message => (
          <Notice key={message} tone="danger">
            {message}
          </Notice>
        ))}
        {confirmMutation.data !== undefined && confirmMutation.data.output.length > 0 && (
          <Notice tone="success">
            <pre className={styles.code}>{confirmMutation.data.output}</pre>
          </Notice>
        )}
        {busy && !loadingRepository && <Notice tone="info">Working…</Notice>}
      </div>

      {!sidePanel && <SessionForkPanel sessions={props.sessions} openSession={props.openSession} />}
      {!sidePanel && state !== undefined && (
        <WorkspaceProvisioner
          revisions={state.revisions}
          selectedCommitId={selectedRevision?.commitId ?? null}
          provisionedPath={provisionedPath}
          onPreview={askForConfirmation}
          pickDirectory={props.pickDirectory}
          launchSession={props.launchSession}
        />
      )}

      <section aria-labelledby={activeView.id} className={view === 'graph' ? undefined : styles.sourceView} id={activeView.panelId} role="tabpanel">
        {state === undefined ? (
          loadingRepository ? (
            <EmptyState compact title="Loading repository…" />
          ) : (
            <EmptyState compact title="Choose a repository path above to open its revision graph." />
          )
        ) : view === 'graph' ? (
          <>
            <div className={styles.filters}>
              {!sidePanel && (
                <Input
                  aria-label="Filter author"
                  className={styles.filterInput}
                  onChange={event => setAuthorFilter(event.target.value)}
                  placeholder="Author"
                  value={authorFilter}
                />
              )}
              <Input
                aria-label="Search revisions"
                className={styles.filterInput}
                icon={<IconSearchOutlineRegular />}
                onChange={event => setTextFilter(event.target.value)}
                placeholder={sidePanel ? 'Search revisions…' : 'Search descriptions, IDs, bookmarks, tags, workspaces'}
                value={textFilter}
              />
              <Checkbox checked={mineOnly} label="Mine" onChange={setMineOnly} />
              <Checkbox checked={hideImmutable} label="Hide immutable" onChange={setHideImmutable} />
              {!sidePanel && (
                <>
                  <Field className={styles.dateField} label="From">
                    {control => <Input {...control} onChange={event => setFromDate(event.target.value)} type="date" value={fromDate} />}
                  </Field>
                  <Field className={styles.dateField} label="To">
                    {control => <Input {...control} onChange={event => setToDate(event.target.value)} type="date" value={toDate} />}
                  </Field>
                </>
              )}
            </div>
            <div
              className={
                sidePanel && selectedRevision !== undefined
                  ? `${styles.graphColumns} ${styles.sideDetailsOpen}`
                  : !sidePanel && selectedRevision === undefined
                    ? `${styles.graphColumns} ${styles.graphOnly}`
                    : styles.graphColumns
              }
            >
              <div className={styles.revisionList}>
                {groups.map(group => (
                  <div className={styles.dayGroup} key={group.day}>
                    <div className={styles.dayHeading}>{group.day}</div>
                    {group.rows.map(revision => {
                      const graphLayout = graphRowsByCommitId.get(revision.commitId)
                      if (graphLayout === undefined) return null
                      return (
                        <RevisionRow
                          graphLayout={graphLayout}
                          graphWidth={graphWidth}
                          key={revision.commitId}
                          onDrop={event => dropOn(event, revision)}
                          onSelect={() => selectRevision(revision)}
                          revision={revision}
                          selected={selectedRevision?.commitId === revision.commitId}
                          sidePanel={sidePanel}
                        />
                      )
                    })}
                  </div>
                ))}
                {visibleRevisions.length === 0 && <EmptyState compact title="No revisions match these filters." />}
              </div>
              {selectedRevision !== undefined && (
                <aside className={styles.details}>
                  <>
                    <div className={styles.titleRow}>
                      <h2 className={styles.heading}>Revision {selectedRevision.shortestChangeId}</h2>
                      <Button icon={<IconCloseOutlineRegular />} onClick={() => selectRevision(null)} size="sm" type="button" variant="ghost">
                        Close
                      </Button>
                    </div>
                    <p className={styles.fullDescription}>{selectedRevision.description || '(no description)'}</p>
                    <div className={styles.muted}>
                      {selectedRevision.author} · {new Date(selectedRevision.authorTime).toLocaleString()}
                    </div>
                    {details === undefined ? (
                      <EmptyState compact title="Loading revision details…" />
                    ) : (
                      <>
                        <div className={styles.counts}>
                          {details.files.length} files · +{details.additions} −{details.deletions}
                          <span>{selectedReviewProgress.reviewed}/{selectedReviewProgress.total} files reviewed</span>
                          {details.truncated && <Tag tone="warning">diff truncated; counts partial</Tag>}
                        </div>
                        <label className={styles.reviewFilter}>
                          <input type="checkbox" checked={hideReviewedFiles} onChange={event => setHideReviewedFiles(event.target.checked)} />
                          Hide reviewed files
                        </label>
                        {reviewNotice.length > 0 && (
                          <p role="status" className={styles.muted}>
                            {reviewNotice}
                          </p>
                        )}
                        <ul className={styles.fileList}>
                          {details.files
                            .filter(file => !hideReviewedFiles || !isFileReviewed(reviewStore, state?.root ?? '', selectedRevision.commitId, file))
                            .map(file => {
                              const reviewed = isFileReviewed(reviewStore, state?.root ?? '', selectedRevision.commitId, file)
                              return (
                                <li className={styles.reviewRow} key={file.path}>
                                  <span className={styles.reviewPath}>{file.path}</span>
                                  <span>
                                    +{file.additions} −{file.deletions}
                                  </span>
                                  <label className={styles.reviewControl}>
                                    <input
                                      type="checkbox"
                                      aria-label={`Mark ${file.path} reviewed`}
                                      checked={reviewed}
                                      disabled={file.contentDigest === null}
                                      onChange={event => updateFileReview(file, event.target.checked)}
                                    />
                                    Reviewed
                                  </label>
                                </li>
                              )
                            })}
                        </ul>
                        {hideReviewedFiles &&
                          selectedReviewProgress.total > 0 &&
                          selectedReviewProgress.reviewed === selectedReviewProgress.total && (
                            <p className={styles.muted}>All reviewable files are hidden.</p>
                          )}
                        <details className={styles.disclosure}>
                          <summary>Change evolution</summary>
                          <pre className={styles.code}>{details.evolution}</pre>
                        </details>
                        <details className={styles.disclosure} open>
                          <summary>Diff</summary>
                          <pre className={styles.code}>{details.patch}</pre>
                        </details>
                      </>
                    )}
                    {!selectedRevision.immutable && (
                      <div className={styles.actionBox}>
                        <Field label="New description">
                          {control => (
                            <TextArea
                              {...control}
                              onChange={event => setDescribeDrafts(current => ({ ...current, [selectedRevision.commitId]: event.target.value }))}
                              rows={3}
                              value={selectedDescribeText}
                            />
                          )}
                        </Field>
                        <Button
                          disabled={!selectedDescribeChanged}
                          onClick={() => askForConfirmation({ kind: 'describe', commitId: selectedRevision.commitId, message: selectedDescribeText })}
                          type="button"
                          variant="primary"
                        >
                          Preview describe
                        </Button>
                      </div>
                    )}
                  </>
                </aside>
              )}
            </div>
          </>
        ) : (
          <>
            <div className={styles.sourceSummary}>
              <div>
                <h2 className={styles.heading}>Working copy</h2>
                <pre className={styles.workingStatus}>{state.status || 'Clean working copy.'}</pre>
              </div>
              <div className={styles.sourceActions}>
                <Button
                  onClick={() => {
                    if (showWorkingDiff) void workingDiffQuery.refetch()
                    else setShowWorkingDiff(true)
                  }}
                  type="button"
                  variant="outline"
                >
                  Show full diff
                </Button>
                <Field label="Ancestor groups">
                  {control => (
                    <Select
                      {...control}
                      onValueChange={value => setAncestorLimit(Number(value))}
                      options={ANCESTOR_LIMIT_OPTIONS}
                      value={String(ancestorLimit)}
                    />
                  )}
                </Field>
              </div>
            </div>
            {workingDiffQuery.data !== undefined && (
              <details className={styles.disclosure} open>
                <summary>Working-copy diff</summary>
                <pre className={styles.code}>{workingDiffQuery.data.patch}</pre>
              </details>
            )}
            <div className={styles.sourceColumns}>
              <div className={styles.ancestorList}>
                <h3 className={styles.subheading}>Ancestor groups</h3>
                {ancestors.map(({ depth, revision }) => (
                  <button className={styles.ancestor} key={revision.commitId} onClick={() => setSquashTarget(revision.commitId)} type="button">
                    <span>@-{depth}</span>
                    <span className={styles.ancestorTitle}>{firstLine(revision.description)}</span>
                    <code className={styles.changeId}>{revision.shortestChangeId}</code>
                  </button>
                ))}
                {ancestors.length === 0 && <EmptyState compact title="No visible @-1 ancestors in this graph window." />}
              </div>
              <div className={styles.sourceActions}>
                <h3 className={styles.subheading}>Describe working copy</h3>
                <TextArea
                  aria-label="Working copy description"
                  onChange={event => workingCopy && setDescribeDrafts(current => ({ ...current, [workingCopy.commitId]: event.target.value }))}
                  rows={3}
                  value={workingDescribeText}
                />
                {workingCopy && (
                  <Button
                    disabled={!workingDescribeChanged}
                    onClick={() => askForConfirmation({ kind: 'describe', commitId: workingCopy.commitId, message: workingDescribeText })}
                    type="button"
                    variant="primary"
                  >
                    Preview describe
                  </Button>
                )}
                <h3 className={styles.subheading}>Split selected files from @</h3>
                <div className={styles.fileChoices}>
                  {state.changedPaths.map(file => {
                    const selectable = safeSplitPath(file)
                    return (
                      <Checkbox
                        checked={splitPaths.includes(file)}
                        disabled={!selectable}
                        key={file}
                        label={selectable ? file : `${file} — unsafe path format unavailable`}
                        onChange={checked => setSplitPaths(current => (checked ? [...current, file] : current.filter(item => item !== file)))}
                      />
                    )
                  })}
                </div>
                <TextArea
                  aria-label="Split description"
                  onChange={event => setSplitText(event.target.value)}
                  placeholder="Description for selected changes"
                  rows={2}
                  value={splitText}
                />
                {workingCopy && (
                  <Button
                    disabled={splitPaths.length === 0 || splitText.trim().length === 0}
                    onClick={() => askForConfirmation({ kind: 'split', commitId: workingCopy.commitId, paths: [...splitPaths], message: splitText })}
                    type="button"
                    variant="primary"
                  >
                    Preview split
                  </Button>
                )}
                <h3 className={styles.subheading}>Squash working copy into ancestor</h3>
                <Select
                  aria-label="Squash destination"
                  onValueChange={setSquashTarget}
                  options={[
                    { value: '', label: 'Choose an ancestor' },
                    ...ancestors.map(({ depth, revision }) => ({ value: revision.commitId, label: `@-${depth} · ${revision.shortestChangeId}` })),
                  ]}
                  value={squashTarget}
                />
                <TextArea
                  aria-label="Squash description"
                  onChange={event => setSquashText(event.target.value)}
                  placeholder="Resulting description"
                  rows={2}
                  value={squashText}
                />
                {workingCopy && (
                  <Button
                    disabled={!squashTarget || squashText.trim().length === 0}
                    onClick={() => askForConfirmation({ kind: 'squash', sourceId: workingCopy.commitId, destinationId: squashTarget, message: squashText })}
                    type="button"
                    variant="primary"
                  >
                    Preview squash
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </section>

      {preview !== undefined && (
        <ConfirmDialog
          busy={confirmMutation.isPending}
          cancelLabel="Cancel"
          closeLabel="Close"
          confirmLabel="Confirm and run"
          onCancel={() => prepareMutation.reset()}
          onConfirm={confirmPreview}
          open
          title={`Confirm ${preview.title.toLocaleLowerCase()}`}
        >
          <strong className={styles.previewSummary}>{preview.summary}</strong>
          <pre className={styles.previewDetail}>{preview.detail}</pre>
        </ConfirmDialog>
      )}
    </main>
  )
}

interface RevisionRowProps {
  readonly revision: Revision
  readonly selected: boolean
  readonly graphLayout: RevisionGraphRow
  readonly graphWidth: number
  readonly sidePanel: boolean
  readonly onSelect: () => void
  readonly onDrop: (event: DragEvent) => void
}

const RevisionRow = (props: RevisionRowProps): JSX.Element => {
  const revision = props.revision
  const rowHeight = props.sidePanel ? 26 : 30
  const graphCenter = Math.floor(rowHeight / 2)
  const laneCenter = (lane: number): number => lane * 14 + 7
  return (
    <article className={props.selected ? styles.revisionSelected : styles.revision} onDragOver={event => event.preventDefault()} onDrop={props.onDrop}>
      <svg aria-hidden="true" className={styles.graphSvg} height={rowHeight} viewBox={`0 0 ${props.graphWidth} ${rowHeight}`} width={props.graphWidth}>
        {props.graphLayout.topLanes.map(lane => (
          <path className={styles.graphPath} d={`M ${laneCenter(lane)} 0 V ${graphCenter}`} data-lane={lane % 5} key={`top-${lane}`} />
        ))}
        {props.graphLayout.bottomLanes.map(lane => (
          <path className={styles.graphPath} d={`M ${laneCenter(lane)} ${graphCenter} V ${rowHeight}`} data-lane={lane % 5} key={`bottom-${lane}`} />
        ))}
        {props.graphLayout.edges.map((edge, index) => {
          const fromX = laneCenter(edge.fromLane)
          const toX = laneCenter(edge.toLane)
          const path =
            fromX === toX
              ? `M ${fromX} ${graphCenter} V ${rowHeight}`
              : `M ${fromX} ${graphCenter} C ${fromX} ${graphCenter + 5}, ${toX} ${graphCenter + 5}, ${toX} ${rowHeight}`
          return (
            <path
              className={styles.graphPath}
              d={path}
              data-lane={edge.toLane % 5}
              key={`${edge.fromLane}-${edge.toLane}-${index}`}
              strokeDasharray={edge.dashed ? '3 3' : undefined}
            />
          )
        })}
        <circle
          className={revision.workingCopy ? styles.graphNodeCurrent : styles.graphNode}
          cx={laneCenter(props.graphLayout.commitLane)}
          cy={graphCenter}
          data-lane={props.graphLayout.commitLane % 5}
          r={revision.workingCopy ? 4.1 : 3.2}
        />
      </svg>
      <button className={styles.revisionBody} onClick={props.onSelect} type="button">
        <div className={styles.revisionTitle}>
          {revision.workingCopy && <Tag tone="solid">Editing</Tag>}
          <span className={styles.revisionSummary}>{firstLine(revision.description)}</span>
          <span className={styles.labels}>
            {revision.bookmarks.map(name => {
              const local = revision.localBookmarks.includes(name)
              return (
                <span
                  className={local ? styles.draggableBookmark : undefined}
                  draggable={local}
                  key={name}
                  onDragStart={event => {
                    event.dataTransfer.setData('application/x-jujutsu-bookmark', name)
                    event.dataTransfer.effectAllowed = 'move'
                  }}
                >
                  <Tag tone={local ? 'info' : 'quiet'}>{name}</Tag>
                </span>
              )
            })}
            {revision.tags.map(name => (
              <Tag key={name} tone="neutral">
                tag {name}
              </Tag>
            ))}
          </span>
        </div>
        <div className={styles.revisionMeta}>
          <span>{revision.author || 'Unknown author'}</span>
          {revision.workspaces.map(workspace => (
            <Tag key={workspace} tone="outline">
              {workspace}
            </Tag>
          ))}
          {revision.immutable && <Tag tone="warning">immutable</Tag>}
          {revision.evolved && <Tag tone="info">evolved</Tag>}
          {revision.divergent && <Tag tone="danger">divergent</Tag>}
        </div>
      </button>
      <time className={styles.relative} dateTime={revision.authorTime}>
        {relativeTime(revision.authorTime)}
      </time>
      <span className={styles.changeId} title={revision.changeId}>
        {revision.shortestChangeId}
      </span>
      <Tooltip label="Drag revision to rebase after preview" portal side="top">
        <Button
          aria-label="Drag revision to rebase after preview"
          className={styles.dragHandle}
          draggable
          onDragStart={event => {
            event.dataTransfer.setData('application/x-jujutsu-revision', revision.commitId)
            event.dataTransfer.effectAllowed = 'move'
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          <span aria-hidden>⠿</span>
        </Button>
      </Tooltip>
    </article>
  )
}
