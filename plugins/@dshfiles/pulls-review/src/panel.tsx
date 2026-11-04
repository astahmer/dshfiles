import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { useApi } from '@dshfiles/dshx/client'
import { EmptyState, Page } from '@dshfiles/plugin-ui/components/page'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Progress } from '@dshfiles/plugin-ui/components/ui/progress'
import { PatchView, parsePatchFiles } from '@dshfiles/plugin-ui/diff'
import { Check, ChevronDown, PanelRight, RefreshCw, Sparkles } from '@dshfiles/plugin-ui/icons'
import { ListSelectionModel, type ListSelection } from '@dshfiles/plugin-ui/hooks/list-selection'
import { errorMessage, useMutation, useQuery } from '@dshfiles/plugin-ui/query'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { ProjectFolderPicker, type ProjectFolderSelection, type RegisteredProject, type WorkspacePickerPorts } from '@dshfiles/workspace-folder-picker/picker'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { pullsReviewApi } from './api.js'
import { jjIntegrationApi } from '@dshfiles/jj-integration/api'
import type { ChangesRequest } from './changes-scope.js'
import { useRangeViewedMarks } from './viewed-marks.js'
import { PageReviewContextModel } from './review-page-context.js'
import { reviewWithHistoryFallback } from './review-source.js'
import type { SessionFocus } from './session-focus.js'

/** Bring a thread on screen and open its Changes facet; false when it cannot. */
export type OpenInThread = (sessionId: string, request?: ChangesRequest) => boolean

export interface PullsReviewPanelProps {
  readonly sessions: ISessions
  readonly focus: SessionFocus
  readonly workspacePicker: WorkspacePickerPorts
  /** The thread panel's Changes facet is the per-thread view; this page stays the cross-project one. */
  readonly openInThread: OpenInThread
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
        : `Other folder · ${reviewPath.split('/').filter(Boolean).at(-1) ?? reviewPath}`
      : selectedProject.title

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
  // Marks live in diff-viewed's one store, keyed by workspace, base and head commit: the Changes facet reads the same ones.
  const marks = useRangeViewedMarks(head !== undefined && base !== undefined ? { workspacePath: reviewPath, base, head } : undefined)
  const reviewedPaths = marks.viewed

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

  const markReviewed = (path: string): void => marks.set([path], !reviewedPaths.has(path))
  const applyReviewed = (nextReviewed: boolean): void => {
    if (selection.ids.length === 0) return
    marks.set(selection.ids, nextReviewed)
    setSelection(ListSelectionModel.empty())
  }

  const failure = (message: string, retry: () => void): ReactNode => (
    <p role="alert" className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-destructive">
      <span className="dshx:min-w-0">{message}</span>
      <Button size="xs" variant="outline" onClick={retry}>
        Try again
      </Button>
    </p>
  )
  const footer = ((): ReactNode => {
    if (reviewPath.length === 0) return null
    if (query.isPending) return <p className={HINT}>Reading the workspace diff…</p>
    if (query.isError) return failure(errorMessage(query.error, 'The workspace diff could not be read.'), () => void query.refetch())
    if (result === undefined) return null
    if (result.status === 'failed') return failure(result.message, () => void query.refetch())
    if (summarize.isError) return failure(errorMessage(summarize.error, 'Summarizing failed.'), () => summarize.mutate())
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

  const canSummarize = result?.status === 'ok' && result.fileCount > 0 && scopes.length > 0

  return (
    <div className="dshx-root dshx:@container dshx:flex dshx:size-full dshx:min-h-0 dshx:flex-col dshx:overflow-y-auto">
      <Page
        heading="Review"
        description="Changed files of a project or workspace against its base, grouped by scope. Marks are kept across browsers."
        meta={
          result?.status === 'ok' ? (
            <Badge variant="secondary" className="dshx:font-mono dshx:text-[11px]">
              {result.range}
            </Badge>
          ) : undefined
        }
        {...(canSummarize
          ? {
              primaryAction: {
                id: 'summarize',
                label: aiSummaries === undefined ? 'Summarize' : 'Re-summarize',
                icon: <Sparkles aria-hidden className="dshx:size-3.5" />,
                onSelect: () => summarize.mutate(),
                pending: summarize.isPending,
              },
            }
          : {})}
        actions={[
          ...(reviewSessionId === undefined
            ? []
            : [
                {
                  id: 'open-in-thread',
                  label: 'Open in thread',
                  icon: <PanelRight aria-hidden />,
                  onSelect: () => void props.openInThread(String(reviewSessionId), { scope: 'target' }),
                },
              ]),
          { id: 'refresh', label: 'Refresh', icon: <RefreshCw aria-hidden />, onSelect: () => void query.refetch(), pending: query.isFetching },
        ]}
        className="dshx:shrink-0"
      >
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
          <Button
            aria-label="Choose project or workspace"
            className="dshx:min-w-48 dshx:max-w-full dshx:shrink dshx:justify-between dshx:font-normal"
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
            className="dshx:w-48 dshx:max-w-full dshx:font-mono!"
          />
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
          <p className={HINT}>The diff was too large for one read and is truncated; refresh once the thread stops writing to the workspace.</p>
        ) : null}

        {footer}

        {reviewPath.length === 0 ? (
          <div className={SURFACE}>
            <EmptyState action={{ label: 'Choose project or workspace', onSelect: () => setPickerOpen(true) }}>
              Choose a project or workspace to review its changes.
            </EmptyState>
          </div>
        ) : null}
        {result?.status === 'ok' && result.fileCount === 0 ? (
          <div className={SURFACE}>
            <EmptyState>This thread has no changes since {result.base} yet.</EmptyState>
          </div>
        ) : null}

        {allPaths.length > 0 ? (
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-xs">
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
                <Button size="xs" variant="outline" onClick={() => applyReviewed(true)}>
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
      </Page>

      {scopes.length > 0 ? (
        <div
          data-testid="pulls-review-diffs"
          className={cn(
            SURFACE,
            'dshx:mx-5 dshx:mb-5 dshx:flex dshx:min-h-64 dshx:flex-1 dshx:flex-col dshx:overflow-hidden dshx:@max-pane-narrow:mx-3 dshx:@max-pane-narrow:mb-3',
          )}
        >
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
    </div>
  )
}
