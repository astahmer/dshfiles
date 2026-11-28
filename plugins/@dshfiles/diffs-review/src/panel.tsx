import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { useApi } from '@dshfiles/dshx/client'
import { EmptyState, PAGE_FRAME_CLASS, Page } from '@dshfiles/plugin-ui/components/page'
import { DiffStat } from '@dshfiles/plugin-ui/components/diff-stat'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { ProjectMark } from '@dshfiles/plugin-ui/components/ui/project-mark'
import { Progress } from '@dshfiles/plugin-ui/components/ui/progress'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { PatchView, parsePatchFiles } from '@dshfiles/plugin-ui/diff'
import { ReviewLook } from './review-look.js'
import { PackageJsonTables, usePackageJsonTables } from './package-json-table.js'
import { ArrowLeft, ChevronDown, GitMerge, PanelRight, RefreshCw, Sparkles } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useMutation, useQuery } from '@dshfiles/plugin-ui/query'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { ProjectFolderPicker, type ProjectFolderSelection, type RegisteredProject, type WorkspacePickerPorts } from '@dshfiles/workspace-folder-picker/picker'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { diffsReviewApi } from './api.js'
import { jjIntegrationApi } from '@dshfiles/jj-integration/api'
import type { ChangesRequest } from './changes-scope.js'
import { ChangedImages } from './changed-images.js'
import { CombinedReview } from './combined-review.js'
import { ReviewImageModel, WORKING_COPY } from './review-image-query.js'
import { orderReviewFiles } from './file-importance.js'
import { useRangeViewedMarks } from './viewed-marks.js'
import { PageReviewContextModel } from './review-page-context.js'
import { reviewWithHistoryFallback } from './review-source.js'
import { ReviewHeader } from './review-header.js'
import { BaseCombobox } from './base-combobox.js'
import type { SessionFocus } from './session-focus.js'

/** Bring a thread on screen and open its Changes facet; false when it cannot. */
export type OpenInThread = (sessionId: string, request?: ChangesRequest) => boolean

export interface DiffsReviewPanelProps {
  readonly sessions: ISessions
  readonly focus: SessionFocus
  readonly workspacePicker: WorkspacePickerPorts
  /** The thread panel's Changes facet is the per-thread view; this page stays the cross-project one. */
  readonly openInThread: OpenInThread
}

const noBody = (): undefined => undefined

const HINT = 'dshx:text-xs dshx:text-muted-foreground'
/** A control's label above it: 12/16 in secondary ink (council round 8, D3). */
const REVIEW_CONTROL_LABEL = 'dshx:text-xs dshx:leading-4 dshx:text-muted-foreground'
const SURFACE = 'dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card'

/** A counter in the UI sans with tabular figures: these are numbers to compare, not text to copy verbatim. */
const Stat = (props: { readonly label: string }): ReactNode => <span className="dshx:text-xs dshx:text-muted-foreground dshx:tabular-nums">{props.label}</span>

/** The page's combined review, for revisions selected in a graph no thread on screen belongs to. */
const CombinedReviewPage = (props: { readonly workspacePath: string; readonly revisions: readonly string[] }): ReactNode => (
  <div className="dshx-root dshx:@container dshx:flex dshx:size-full dshx:min-h-0 dshx:flex-col dshx:overflow-y-auto">
    <Page
      mark={<GitMerge />}
      markTone="land"
      heading="Review"
      description="The selected revisions, each as its own change, on the graph they form."
      actions={[
        {
          id: 'back-to-workspace',
          label: 'Back to workspace review',
          icon: <ArrowLeft aria-hidden />,
          onSelect: () => PageReviewContextModel.set({ workspacePath: props.workspacePath }),
        },
      ]}
      className="dshx:shrink-0"
    />
    <div className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col dshx:gap-3 dshx:px-5 dshx:pb-5 dshx:@max-pane-narrow:px-3">
      <CombinedReview key={props.revisions.join(' ')} refreshable revisions={props.revisions} workspacePath={props.workspacePath} />
    </div>
  </div>
)

export const DiffsReviewPanel = (props: DiffsReviewPanelProps): ReactNode => {
  const pageReview = useSyncExternalStore(PageReviewContextModel.subscribe, PageReviewContextModel.read, noBody)
  if (pageReview?.revisions !== undefined && pageReview.workspacePath !== undefined) {
    return <CombinedReviewPage revisions={pageReview.revisions} workspacePath={pageReview.workspacePath} />
  }
  return (
    <TooltipProvider>
      <WorkspaceReview {...props} />
    </TooltipProvider>
  )
}

const WorkspaceReview = (props: DiffsReviewPanelProps): ReactNode => {
  const api = useApi(diffsReviewApi)
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
  const baseFieldId = useId()
  const projectsQuery = useQuery({
    queryKey: ['diffs-review', 'projects'],
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
  // The repository's bookmarks for the base list; an unregistered folder offers only its default.
  const bookmarksQuery = useQuery({
    queryKey: ['diffs-review', 'bookmarks', selectedProject?.workspaceId],
    enabled: selectedProject !== undefined,
    queryFn: ({ signal }) =>
      runHostRequest({
        signal,
        timeoutMs: 30_000,
        request: hostSignal => jjApi.destination({ workspaceId: selectedProject?.workspaceId ?? '' }, { signal: hostSignal }),
      }),
    staleTime: 60_000,
  })
  // The project a thread workspace belongs to ("sample · thread-e4fde2" → "sample"): its ProjectMark leads the picker.
  const pickerProjectName = selectedProject === undefined ? undefined : selectedProject.title.split(' · ')[0]?.trim() || selectedProject.title
  const pickerLabel =
    selectedProject === undefined
      ? reviewPath === ''
        ? 'Choose project or workspace'
        : `Other folder · ${reviewPath.split('/').filter(Boolean).at(-1) ?? reviewPath}`
      : selectedProject.isJjWorkspace === true
        ? // A thread workspace is registered as "sample · thread-e4fde2"; the label names its project and says it is the
          // thread's own workspace, never the folder (b:212a).
          `${selectedProject.title.split(' · ')[0]?.trim() || selectedProject.title} · Own workspace`
        : selectedProject.title
  // The thing the empty state names: the project, the thread's own workspace, or the folder.
  const reviewTarget =
    selectedProject === undefined
      ? (reviewPath.split('/').filter(Boolean).at(-1) ?? reviewPath)
      : selectedProject.isJjWorkspace === true
        ? "this thread's workspace"
        : selectedProject.title

  // An empty base field leaves the base to the Host: the project's main branch (chosen, declared or detected), else
  // main, master or trunk. The placeholder names the one it used.
  const query = useQuery({
    queryKey: ['diffs-review', reviewPath, baseRef],
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
  const reviewFiles = useMemo(() => {
    if (result?.status !== 'ok') return []
    const paths = new Set(scopes.flatMap(scope => scope.filePaths))
    const order = new Map(orderReviewFiles({ files: result.files }).map((file, index) => [file.path, index]))
    return parsed.filter(file => paths.has(file.name)).sort((left, right) => (order.get(left.name) ?? Infinity) - (order.get(right.name) ?? Infinity))
  }, [parsed, result, scopes])
  const scopeByPath = useMemo(() => {
    const result = new Map<string, (typeof scopes)[number]>()
    for (const scope of scopes) {
      for (const path of scope.filePaths) result.set(path, scope)
    }
    return result
  }, [scopes])
  const allPaths = useMemo(() => reviewFiles.map(file => file.name), [reviewFiles])
  /** The file whose Reviewed box was toggled last: a Shift-click carries the same mark over every file between. */
  const [anchorPath, setAnchorPath] = useState<string | null>(null)
  useEffect(() => {
    setAnchorPath(null)
  }, [reviewPath, head])

  const totalReviewed =
    result?.status === 'ok' ? result.scopes.reduce((total, item) => total + item.filePaths.filter(path => reviewedPaths.has(path)).length, 0) : 0
  const progress = result !== undefined && result.status === 'ok' && result.fileCount > 0 ? Math.round((totalReviewed / result.fileCount) * 100) : 0

  const allReviewed = allPaths.length > 0 && allPaths.every(path => reviewedPaths.has(path))
  const someReviewed = allPaths.some(path => reviewedPaths.has(path))
  const toggleReviewed = (path: string, extend: boolean): void => {
    const from = extend && anchorPath !== null ? allPaths.indexOf(anchorPath) : -1
    const to = allPaths.indexOf(path)
    marks.set(from < 0 || to < 0 ? [path] : allPaths.slice(Math.min(from, to), Math.max(from, to) + 1), !reviewedPaths.has(path))
    setAnchorPath(path)
  }
  const packageJson = usePackageJsonTables(result?.status === 'ok' ? result.patch : '', reviewFiles)
  const images = useMemo(
    () =>
      result?.status === 'ok'
        ? ReviewImageModel.rangeImages({
            workspacePath: result.path,
            files: result.files,
            base: result.baseCommit,
            head: result.workingCopy === false ? result.head : WORKING_COPY,
          })
        : [],
    [result],
  )
  const textFiles = useMemo(() => {
    const imagePaths = new Set(images.map(image => image.path))
    return packageJson.textFiles.filter(file => !imagePaths.has(file.name))
  }, [images, packageJson.textFiles])
  /**
   * One reviewed control per file (council round 2, D3): a checkbox labelled Reviewed; Shift-click marks a range. It is
   * a bounded 32 px box on the file row, so the target reads as one (council round 4, D3). The persistence note lives on
   * this control, not in the page subtitle (council round 17, D4).
   */
  const reviewControls = (path: string): ReactNode => (
    <Tooltip>
      <TooltipTrigger asChild>
        <label className={ReviewLook.REVIEWED_TOGGLE}>
          <Checkbox
            aria-label={`Reviewed: ${path}`}
            checked={reviewedPaths.has(path)}
            onClick={event => {
              event.preventDefault()
              toggleReviewed(path, event.shiftKey)
            }}
          />
          <span aria-hidden>Mark reviewed</span>
        </label>
      </TooltipTrigger>
      <TooltipContent side="bottom">Marks are kept across browsers. Shift-click marks a range.</TooltipContent>
    </Tooltip>
  )

  const failure = (message: string, retry: () => void): ReactNode => (
    <p role="alert" className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-destructive">
      <span className="dshx:min-w-0">{message}</span>
      <Button size="xs" variant="outline" onClick={retry}>
        Retry
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
        width="wide"
        // The Land destination's glyph in its tone before the h1 (council round 7, D1).
        mark={<GitMerge />}
        markTone="land"
        heading="Review"
        // One short line; the persistence note sits on Mark reviewed (council round 17, D4).
        description="Changed files, most important first."
        // The base is named once, in the branch control ("Base: main"), not again in a chip beside the title (round 5, D3).
        // Summarize is an outline action and Refresh sits in the overflow: the page has no filled primary (council round 4/5, D3).
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
          {
            id: 'refresh',
            label: 'Refresh',
            icon: <RefreshCw aria-hidden />,
            onSelect: () => void query.refetch(),
            pending: query.isFetching,
            placement: 'overflow',
          },
          ...(canSummarize
            ? [
                {
                  id: 'summarize',
                  label: aiSummaries === undefined ? 'Summarize' : 'Re-summarize',
                  icon: <Sparkles aria-hidden className="dshx:size-3.5" />,
                  onSelect: () => summarize.mutate(),
                  pending: summarize.isPending,
                },
              ]
            : []),
        ]}
        className="dshx:shrink-0"
      >
        {/* Each control carries a 12/16 label above it, so the row reads without its values (council round 8, D3). */}
        <div className="dshx:flex dshx:flex-wrap dshx:items-end dshx:gap-2">
          <div className="dshx:flex dshx:min-w-0 dshx:max-w-full dshx:flex-col dshx:gap-1">
            <span aria-hidden className={REVIEW_CONTROL_LABEL}>
              Project or workspace
            </span>
            {/* It shows a value, so it takes the field look of the base field beside it (council round 7, D4 / A4). */}
            <Button
              aria-label="Choose project or workspace"
              className="dshx:min-w-48 dshx:max-w-full dshx:shrink"
              onClick={() => setPickerOpen(true)}
              type="button"
              variant="field"
            >
              {pickerProjectName === undefined ? null : <ProjectMark name={pickerProjectName} size="dense" />}
              <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-left">{pickerLabel}</span>
              <ChevronDown aria-hidden className="dshx:size-4 dshx:shrink-0" />
            </Button>
          </div>
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
          {/* The effective base reads as the field's value in ink with a "default" tag; a typed or chosen bookmark overrides it. */}
          <div className="dshx:flex dshx:max-w-full dshx:flex-col dshx:gap-1" data-review-base>
            <label htmlFor={baseFieldId} className={REVIEW_CONTROL_LABEL}>
              Compare against
            </label>
            <BaseCombobox id={baseFieldId} base={base} value={baseRef} onValueChange={setBaseRef} bookmarks={bookmarksQuery.data?.bookmarks} />
          </div>
        </div>
        {/* The file toolbar over the diff card: what changed on the left, review progress on the right (round 4, D3). */}
        {result?.status === 'ok' && ReviewHeader.showStats(result.fileCount) ? (
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-x-4 dshx:gap-y-2" data-review-toolbar>
            <span className="dshx:flex dshx:items-center dshx:gap-2">
              <Stat label={result.fileCount === 1 ? '1 file' : `${result.fileCount} files`} />
              <DiffStat added={result.additions} removed={result.deletions} />
            </span>
            <span className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-3">
              {allPaths.length > 1 ? (
                <label className="dshx:flex dshx:w-fit dshx:cursor-pointer dshx:items-center dshx:gap-1.5 dshx:text-xs">
                  <Checkbox
                    checked={allReviewed ? true : someReviewed ? 'indeterminate' : false}
                    onCheckedChange={() => {
                      marks.set(allPaths, !allReviewed)
                      setAnchorPath(null)
                    }}
                  />
                  All files reviewed
                </label>
              ) : null}
              {/* One file: its header's Mark reviewed control is the whole review state (council round 5, D3). */}
              {result.fileCount > 1 ? (
                <>
                  <Stat label={`${totalReviewed}/${result.fileCount} reviewed`} />
                  <Progress value={progress} className={ReviewLook.PROGRESS} />
                </>
              ) : null}
            </span>
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
            <EmptyState>{ReviewHeader.emptyText({ target: reviewTarget, base: result.base })}</EmptyState>
          </div>
        ) : null}
      </Page>

      {/* The cards sit outside Page, so they take its wide frame: the same start inset and 1200 px cap (round 5, D3). */}
      <div className={cn(PAGE_FRAME_CLASS.wide, 'dshx:px-6 dshx:@max-pane-narrow:px-3')} data-review-cards>
        {scopes.length > 0 && packageJson.files.length > 0 ? (
          <div className="dshx:mb-3">
            <PackageJsonTables headerActions={reviewControls} view={packageJson} />
          </div>
        ) : null}
        {scopes.length > 0 && images.length > 0 ? (
          <div className="dshx:mb-3">
            <ChangedImages images={images} renderActions={reviewControls} />
          </div>
        ) : null}
        {scopes.length > 0 && textFiles.length > 0 ? (
          <div
            data-testid="diffs-review-diffs"
            className={cn(
              SURFACE,
              // The card ends at its last file instead of stretching to the pane foot (council round 2, D3).
              'dshx:mb-6 dshx:flex dshx:flex-col dshx:overflow-hidden dshx:@max-pane-narrow:mb-3',
            )}
          >
            <PatchView
              files={textFiles}
              className={cn('dshx:flex-1', ReviewLook.DARK_DIFF_TINTS)}
              empty={<p className={cn(HINT, 'dshx:p-3')}>No diff hunks to display.</p>}
              // The header leads with the file-type mark and the path at 13/600; the scope is quiet trailing text, and
              // only when it says something: several scopes, or a written summary (council round 6, D2).
              renderHeaderMetadata={file => {
                const scope = scopeByPath.get(file.name)
                const summary = scope === undefined ? undefined : aiSummaries?.[scope.key]
                const shown = scope !== undefined && ReviewHeader.showScope({ scopeCount: scopes.length, summarized: summary !== undefined })
                return (
                  <>
                    {shown ? (
                      <span className={cn(HINT, 'dshx:max-w-80 dshx:truncate')} data-review-scope-note>
                        <span className="dshx:font-medium">{scope.label}</span> · {ReviewHeader.scopeNote(summary ?? scope.summary)}
                      </span>
                    ) : null}
                    {reviewControls(file.name)}
                  </>
                )
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
