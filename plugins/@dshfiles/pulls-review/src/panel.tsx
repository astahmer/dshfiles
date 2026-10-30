import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { useApi, useSubscribable, type HostStore } from '@dshfiles/dshx/client'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Progress } from '@dshfiles/plugin-ui/components/ui/progress'
import { PatchView, parsePatchFiles } from '@dshfiles/plugin-ui/diff'
import { Check, ChevronDown, RefreshCw, Sparkles } from '@dshfiles/plugin-ui/icons'
import { ListSelectionModel, type ListSelection } from '@dshfiles/plugin-ui/hooks/list-selection'
import { errorMessage, useMutation, useQuery } from '@dshfiles/plugin-ui/query'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { ProjectFolderPicker, type ProjectFolderSelection, type RegisteredProject, type WorkspacePickerPorts } from '@dshfiles/project-folder-picker'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { pullsReviewApi } from './api.js'
import { jjIntegrationApi } from '@dshfiles/jj-integration/api'
import { ReviewedMarksModel, type ReviewedMarks } from './reviewed.js'
import { PageReviewContextModel } from './review-page-context.js'
import { reviewWithHistoryFallback } from './review-source.js'
import type { SessionFocus } from './session-focus.js'

export interface PullsReviewPanelProps {
  readonly sessions: ISessions
  readonly focus: SessionFocus
  readonly workspacePicker: WorkspacePickerPorts
  /** Kept on the Host, so marks made in one browser show in every other. */
  readonly reviewed: HostStore<ReviewedMarks>
}

const noBody = (): undefined => undefined

const HINT = 'dshx:text-xs dshx:text-muted-foreground'
const SURFACE = 'dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card'

const Stat = (props: { readonly label: string; readonly tone?: 'add' | 'del' }): ReactNode => (
  <span
    className={cn(
      'dshx:font-mono dshx:text-xs',
      props.tone === 'add' ? 'dshx:text-success' : props.tone === 'del' ? 'dshx:text-destructive' : 'dshx:text-muted-foreground',
    )}
  >
    {props.label}
  </span>
)

export const PullsReviewPanel = (props: PullsReviewPanelProps): ReactNode => {
  const api = useApi(pullsReviewApi)
  const jjApi = useApi(jjIntegrationApi)
  const reviewedStore = props.reviewed
  const reviewed = useSubscribable(reviewedStore)

  const subscribeMounted = useCallback((listener: () => void) => props.focus.subscribe(listener), [props.focus])
  const readMounted = useCallback(() => props.focus.getSnapshot(), [props.focus])
  const sessionId = useSyncExternalStore(subscribeMounted, readMounted, noBody)
  const pageReview = useSyncExternalStore(PageReviewContextModel.subscribe, PageReviewContextModel.read, noBody)

  const subscribeSessions = useCallback((listener: () => void) => props.sessions.list.subscribe(listener), [props.sessions])
  const readCwd = useCallback(() => (sessionId === undefined ? undefined : props.sessions.list.getSnapshot().byId[sessionId]?.cwd), [props.sessions, sessionId])
  const cwd = useSyncExternalStore(subscribeSessions, readCwd, noBody)
  const [selectedPath, setSelectedPath] = useState(() => pageReview?.workspacePath ?? '')
  const [baseRef, setBaseRef] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const projectsQuery = useQuery({
    queryKey: ['pulls-review', 'projects'],
    queryFn: ({ signal }) => runHostRequest({ signal, timeoutMs: 30_000, request: hostSignal => jjApi.projects({}, { signal: hostSignal }) }),
    staleTime: 60_000,
  })
  useEffect(() => {
    if (pageReview === undefined) return
    setSelectedPath(pageReview.workspacePath ?? '')
  }, [pageReview])
  const reviewPath = selectedPath || pageReview?.workspacePath || cwd || ''
  const reviewSessionId = pageReview?.sessionId ?? sessionId
  const pickerProjects: RegisteredProject[] = [
    ...(projectsQuery.data?.projects ?? []).map(project => ({ workspaceId: project.workspaceId, title: project.title, canonicalPath: project.path })),
    ...(projectsQuery.data?.workspaces ?? []).map(workspace => ({
      workspaceId: workspace.workspaceId,
      title: workspace.title,
      canonicalPath: workspace.path,
      isJjWorkspace: true,
    })),
  ]
  const selectedProject = pickerProjects.find(project => project.canonicalPath === reviewPath)
  const pickerLabel =
    selectedProject === undefined
      ? reviewPath === ''
        ? 'Choose project or workspace'
        : `Other folder · ${reviewPath}`
      : `${selectedProject.title} · ${selectedProject.canonicalPath}`

  const query = useQuery({
    queryKey: ['pulls-review', reviewPath, baseRef],
    enabled: reviewPath.length > 0,
    queryFn: ({ signal }) =>
      reviewWithHistoryFallback({
        path: reviewPath,
        ...(baseRef === '' ? undefined : { base: baseRef }),
        readReview: input =>
          runHostRequest({
            signal,
            timeoutMs: 60_000,
            request: hostSignal => api.review(input, { signal: hostSignal }),
          }),
        readHistory: path =>
          runHostRequest({
            signal,
            timeoutMs: 30_000,
            request: hostSignal => jjApi.reviewHistory({ path }, { signal: hostSignal }),
          }),
      }),
  })

  const result = query.data
  const head = result?.status === 'ok' ? result.head : undefined
  const base = result?.status === 'ok' ? result.base : undefined
  const summarize = useMutation({
    mutationFn: () =>
      runHostRequest({
        timeoutMs: 120_000,
        request: signal =>
          api.summarize(
            {
              path: reviewPath,
              ...(baseRef !== '' && { base: baseRef }),
              ...(reviewSessionId !== undefined && { sessionId: String(reviewSessionId) }),
            },
            { signal },
          ),
      }),
  })
  const summarized = summarize.data
  const aiSummaries = summarized?.status === 'ok' ? summarized.summaries : undefined
  const scopeKeyOf = head !== undefined ? ReviewedMarksModel.keyOf(reviewPath, base ?? '', head) : undefined
  const reviewedPaths = useMemo(() => {
    const paths = scopeKeyOf === undefined ? undefined : reviewed[scopeKeyOf]
    return new Set(paths ?? [])
  }, [reviewed, scopeKeyOf])

  const scopes = useMemo(() => (result?.status === 'ok' ? result.scopes : []), [result])

  const resetSummarize = summarize.reset
  useEffect(() => {
    resetSummarize()
  }, [head, resetSummarize])

  const parsed = useMemo(() => (result?.status === 'ok' && result.patch.length > 0 ? parsePatchFiles(result.patch).flatMap(file => file.files) : []), [result])
  const reviewFiles = useMemo(
    () =>
      scopes.flatMap(scope => {
        const paths = new Set(scope.filePaths)
        return parsed.filter(file => paths.has(file.name))
      }),
    [parsed, scopes],
  )
  const scopeByPath = useMemo(() => {
    const result = new Map<string, (typeof scopes)[number]>()
    for (const scope of scopes) {
      for (const path of scope.filePaths) result.set(path, scope)
    }
    return result
  }, [scopes])
  const allPaths = useMemo(() => reviewFiles.map(file => file.name), [reviewFiles])
  const [selection, setSelection] = useState<ListSelection<string>>(() => ListSelectionModel.empty())
  useEffect(() => {
    setSelection(ListSelectionModel.empty())
  }, [reviewPath, head])
  useEffect(() => {
    setSelection(current => {
      const next = ListSelectionModel.prune({ state: current, visibleIds: allPaths })
      return next.ids.length === current.ids.length && next.anchorId === current.anchorId ? current : next
    })
  }, [allPaths])
  const selectedPaths = useMemo(() => new Set(selection.ids), [selection.ids])

  const totalReviewed =
    result?.status === 'ok' ? result.scopes.reduce((total, item) => total + item.filePaths.filter(path => reviewedPaths.has(path)).length, 0) : 0
  const progress = result !== undefined && result.status === 'ok' && result.fileCount > 0 ? Math.round((totalReviewed / result.fileCount) * 100) : 0

  const markReviewed = (path: string): void => {
    if (scopeKeyOf === undefined) return
    reviewedStore.set(ReviewedMarksModel.record(reviewed, scopeKeyOf, ReviewedMarksModel.toggle(reviewed[scopeKeyOf] ?? [], path)))
  }
  const applyReviewed = (nextReviewed: boolean): void => {
    if (scopeKeyOf === undefined || selection.ids.length === 0) return
    const current = reviewed[scopeKeyOf] ?? []
    const next = nextReviewed ? ReviewedMarksModel.mark(current, selection.ids) : ReviewedMarksModel.unmark(current, selection.ids)
    reviewedStore.set(ReviewedMarksModel.record(reviewed, scopeKeyOf, next))
    setSelection(ListSelectionModel.empty())
  }

  const footer = ((): ReactNode => {
    if (reviewPath.length === 0) return <p className={HINT}>Choose a project or workspace to review.</p>
    if (query.isPending) return <p className={HINT}>Reading the workspace diff…</p>
    if (query.isError) return <p className="dshx:text-xs dshx:text-destructive">{errorMessage(query.error, 'The workspace diff could not be read.')}</p>
    if (result === undefined) return null
    if (result.status === 'failed') return <p className="dshx:text-xs dshx:text-destructive">{result.message}</p>
    if (summarize.isError) return <p className="dshx:text-xs dshx:text-destructive">{errorMessage(summarize.error, 'Summarizing failed.')}</p>
    if (summarized?.status === 'failed') return <p className={HINT}>{summarized.message}</p>
    if (summarize.isPending)
      return (
        <p className={HINT}>
          Summarizing {scopes.length} scope{scopes.length === 1 ? '' : 's'} with the thread model…
        </p>
      )
    if (summarized?.status === 'ok')
      return (
        <p className={HINT}>
          Summaries from {summarized.route.provider} · {summarized.route.model}
        </p>
      )
    return null
  })()

  return (
    <section className="dshx-root dshx:@container dshx:flex dshx:size-full dshx:min-h-0 dshx:flex-col dshx:gap-3 dshx:p-4">
      <header className="dshx:flex dshx:flex-col dshx:gap-2">
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
          <Button
            aria-label="Choose project or workspace"
            className="dshx:min-w-48 dshx:max-w-full dshx:justify-between dshx:font-normal"
            onClick={() => setPickerOpen(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            <span className="dshx:min-w-0 dshx:truncate">{pickerLabel}</span>
            <ChevronDown aria-hidden className="dshx:size-4 dshx:shrink-0" />
          </Button>
          {pickerOpen ? (
            <ProjectFolderPicker
              directoryPicker={props.workspacePicker.directoryPicker}
              disabled={projectsQuery.isLoading}
              heading="Choose project or workspace"
              loading={projectsQuery.isLoading}
              onClose={() => setPickerOpen(false)}
              onRegisterWorkspace={props.workspacePicker.registerWorkspace}
              onSelect={(selection: ProjectFolderSelection) => {
                setSelectedPath(selection.canonicalPath)
                setPickerOpen(false)
              }}
              projects={pickerProjects}
              showNativePicker={false}
            />
          ) : null}
          <Input
            aria-label="Base branch or bookmark"
            placeholder="Base branch (default)"
            value={baseRef}
            onChange={event => setBaseRef(event.target.value)}
            className="dshx:w-48 dshx:font-mono!"
          />
        </div>
        <div className="dshx:flex dshx:items-center dshx:gap-2">
          <h2 className="dshx:text-sm dshx:font-semibold">pulls.review</h2>
          {result?.status === 'ok' ? (
            <Badge variant="secondary" className="dshx:font-mono dshx:text-[11px]">
              {result.range}
            </Badge>
          ) : null}
          <span className="dshx:ml-auto" />
          {result?.status === 'ok' && result.fileCount > 0 && scopes.length > 0 ? (
            <Button variant="outline" size="sm" disabled={summarize.isPending} onClick={() => summarize.mutate()} className="dshx:gap-1.5 dshx:shrink">
              <Sparkles aria-hidden className={cn('dshx:size-3.5', summarize.isPending && 'dshx:animate-pulse')} />
              {aiSummaries === undefined ? 'Summarize' : 'Re-summarize'}
            </Button>
          ) : null}
          <Button variant="ghost" size="icon" aria-label="Refresh" disabled={query.isFetching} onClick={() => void query.refetch()}>
            <RefreshCw aria-hidden className={cn(query.isFetching && 'dshx:animate-spin')} />
          </Button>
        </div>
        {result?.status === 'ok' ? (
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
            <Stat label={result.fileCount === 1 ? '1 file' : `${result.fileCount} files`} />
            <Stat label={`+${result.additions}`} tone="add" />
            <Stat label={`−${result.deletions}`} tone="del" />
            <Stat label={`${totalReviewed}/${result.fileCount} reviewed`} />
            <Progress value={progress} className="dshx:min-w-24 dshx:flex-1" />
          </div>
        ) : null}
        {result?.status === 'ok' && result.truncated ? (
          <p className={HINT}>The diff was too large for one read and is truncated; refresh after the workspace settles.</p>
        ) : null}
      </header>

      {footer}

      {result?.status === 'ok' && result.fileCount === 0 ? <p className={HINT}>This thread has no changes since {result.base} yet.</p> : null}

      {allPaths.length > 0 ? (
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-[11px]">
          <label className="dshx:flex dshx:items-center dshx:gap-1">
            <input
              type="checkbox"
              aria-label="Select all files in this review"
              checked={ListSelectionModel.isComplete({ state: selection, orderedIds: allPaths })}
              onChange={() => setSelection(current => ListSelectionModel.toggleAllVisible({ state: current, orderedIds: allPaths }))}
              className="dshx:size-3.5 dshx:accent-[var(--color-info)]"
            />
            Select all files
          </label>
          {selection.ids.length === 0 ? null : (
            <span className="dshx:ml-auto dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1">
              <span className="dshx:mr-1 dshx:tabular-nums">{selection.ids.length} selected</span>
              <Button size="xs" variant="secondary" onClick={() => applyReviewed(true)}>
                Mark selected reviewed
              </Button>
              <Button size="xs" variant="ghost" onClick={() => applyReviewed(false)}>
                Mark selected unreviewed
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setSelection(ListSelectionModel.empty())}>
                Clear
              </Button>
            </span>
          )}
        </div>
      ) : null}

      {scopes.length > 0 ? (
        <div data-testid="pulls-review-diffs" className={cn(SURFACE, 'dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col dshx:overflow-hidden')}>
          <PatchView
            files={reviewFiles}
            className="dshx:flex-1"
            empty={<p className={cn(HINT, 'dshx:p-3')}>No diff hunks to display.</p>}
            renderHeaderPrefix={file => {
              const scope = scopeByPath.get(file.name)
              if (scope === undefined) return null
              return (
                <span className="dshx:mr-2 dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
                  <Badge variant="secondary" className="dshx:text-[10px]">
                    {scope.label}
                  </Badge>
                  <span className={cn(HINT, 'dshx:truncate')}>{aiSummaries?.[scope.key] ?? scope.summary}</span>
                </span>
              )
            }}
            renderHeaderMetadata={file => {
              const isReviewed = reviewedPaths.has(file.name)
              const isSelected = selectedPaths.has(file.name)
              return (
                <span className="dshx:flex dshx:items-center dshx:gap-1">
                  <input
                    type="checkbox"
                    aria-label={`Select ${file.name} for batch review`}
                    checked={isSelected}
                    onChange={event => {
                      const click = event.nativeEvent instanceof MouseEvent ? event.nativeEvent : undefined
                      if (click?.shiftKey) {
                        setSelection(current => ListSelectionModel.extend({ state: current, orderedIds: allPaths, id: file.name }))
                        return
                      }
                      setSelection(current => ListSelectionModel.toggle({ state: current, id: file.name }))
                    }}
                    className="dshx:size-3.5 dshx:accent-[var(--color-info)]"
                  />
                  <Button
                    variant={isReviewed ? 'secondary' : 'ghost'}
                    size="sm"
                    className="dshx:gap-1 dshx:text-[11px]"
                    onClick={() => markReviewed(file.name)}
                  >
                    <Check aria-hidden className="dshx:size-3" />
                    {isReviewed ? 'Reviewed' : 'Mark reviewed'}
                  </Button>
                </span>
              )
            }}
          />
        </div>
      ) : null}
    </section>
  )
}
