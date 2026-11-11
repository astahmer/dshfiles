import { useApi } from '@dshfiles/dshx/client'
import { EmptyState } from '@dshfiles/plugin-ui/components/page'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { Progress } from '@dshfiles/plugin-ui/components/ui/progress'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { PatchView, parsePatchFiles, type PatchLineSelection } from '@dshfiles/plugin-ui/diff'
import { PackageJsonTables, usePackageJsonTables } from './package-json-table.js'
import { ChevronLeft, ChevronRight, RefreshCw } from '@dshfiles/plugin-ui/icons'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useQuery } from '@dshfiles/plugin-ui/query'
import { GRAPH_DENSITY, GraphLanes, graphWidthFor, RevisionGraphCell } from '@dshfiles/jj-integration/revision-graph'
import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { diffsReviewApi, type RevisionReview } from './api.js'
import { ReviewGraphModel, type ReviewGraphEntry } from './review-graph.js'
import { useRevisionsViewedMarks, type RevisionFile } from './viewed-marks.js'
import { orderReviewFiles } from './file-importance.js'
import { ChangedImages } from './changed-images.js'
import { ReviewImageModel } from './review-image-query.js'

const METRICS = GRAPH_DENSITY.compact
const CHIP = 'dshx:inline-flex dshx:h-4 dshx:shrink-0 dshx:items-center dshx:rounded-sm dshx:px-1 dshx:font-mono! dshx:text-[10px] dshx:leading-none'

const HINT = 'dshx:text-xs dshx:text-muted-foreground'
const STAT = 'dshx:font-mono dshx:text-xs dshx:tabular-nums dshx:text-muted-foreground'

export interface CombinedReviewProps {
  readonly workspacePath: string
  /** Commit ids or change ids; the Host reads each as it is now and orders them. */
  readonly revisions: readonly string[]
  /** Where the surface shows its line comments; without `onLineSelection` lines are not selectable. */
  readonly comments?: ReactNode
  readonly onLineSelection?: (selection: PatchLineSelection, revision: RevisionReview) => void
  /** Offer a refresh of its own, for a surface that has none. */
  readonly refreshable?: boolean
}

const noRevisions: readonly RevisionReview[] = []

const filesOf = (revision: RevisionReview): readonly RevisionFile[] => revision.files.map(file => ({ commitId: revision.commitId, path: file.path }))

const subject = (revision: RevisionReview): string => (revision.description.length === 0 ? '(no description)' : revision.description)

const Counts = (props: { readonly added: number; readonly deleted: number }): JSX.Element => (
  <>
    <span className="dshx:font-mono dshx:text-xs dshx:tabular-nums dshx:text-success">+{props.added}</span>
    <span className="dshx:font-mono dshx:text-xs dshx:tabular-nums dshx:text-destructive">−{props.deleted}</span>
  </>
)

/**
 * Several revisions reviewed in one panel. A selection may have gaps, and `jj diff` has no answer across a gap, so each
 * revision stays its own change: every file is listed under the revision that made it, one revision's diff is on screen
 * at a time, and a viewed mark belongs to one file of one revision.
 */
export const CombinedReview = (props: CombinedReviewProps): JSX.Element => {
  const review = useApi(diffsReviewApi)
  const { workspacePath, revisions: requested } = props
  const query = useQuery({
    queryKey: ['diffs-review', 'combined', workspacePath, requested.join(' ')],
    queryFn: ({ signal }) =>
      runHostRequest({
        signal,
        timeoutMs: 120_000,
        request: hostSignal => review.reviewRevisions({ path: workspacePath, revisions: requested }, { signal: hostSignal }),
      }),
  })
  const result = query.data
  const revisions = result?.status === 'ok' ? result.revisions : noRevisions
  const commitIds = useMemo(() => revisions.map(revision => revision.commitId), [revisions])
  const marks = useRevisionsViewedMarks({ workspacePath, commitIds })
  const [chosen, setChosen] = useState<{ readonly commitId: string; readonly focusPath: string | null } | null>(null)
  const currentIndex = Math.max(
    0,
    revisions.findIndex(revision => revision.commitId === chosen?.commitId),
  )
  const current = revisions[currentIndex]
  const currentPatch = current?.patch ?? ''
  const images = useMemo(
    () => (current === undefined ? [] : ReviewImageModel.revisionImages({ workspacePath, commitId: current.commitId, files: current.files })),
    [current, workspacePath],
  )
  const parsed = useMemo(() => {
    if (current === undefined || currentPatch.length === 0) return []
    const order = new Map(orderReviewFiles({ files: current.files }).map((file, index) => [file.path, index]))
    const imagePaths = new Set(images.map(image => image.path))
    return parsePatchFiles(currentPatch)
      .flatMap(file => file.files)
      .filter(file => !imagePaths.has(file.name))
      .sort((left, right) => (order.get(left.name) ?? Infinity) - (order.get(right.name) ?? Infinity))
  }, [current, currentPatch, images])
  const packageJson = usePackageJsonTables(currentPatch, parsed)
  const graph = useMemo(() => ReviewGraphModel.entries(revisions), [revisions])
  const graphWidth = graphWidthFor(METRICS, Math.max(1, ...graph.map(entry => entry.layout.laneCount)))

  if (query.isPending)
    return (
      <p className={cn(HINT, 'dshx:flex dshx:items-center dshx:gap-2')}>
        <Spinner /> Reading the selected revisions…
      </p>
    )
  if (query.isError || result?.status !== 'ok') {
    const message = result?.status === 'failed' ? result.message : errorMessage(query.error, 'The selected revisions could not be read.')
    return (
      <p className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-destructive" role="alert">
        <span className="dshx:min-w-0">{message}</span>
        <Button onClick={() => void query.refetch()} size="xs" variant="outline">
          Try again
        </Button>
      </p>
    )
  }

  const allFiles = revisions.flatMap(filesOf)
  const viewedCount = allFiles.filter(file => marks.isViewed(file)).length
  const allViewed = allFiles.length > 0 && viewedCount === allFiles.length
  const show = (revision: RevisionReview, focusPath: string | null = null): void => setChosen({ commitId: revision.commitId, focusPath })
  /** The graph lists newest first, so j and ArrowDown go to the older revision, as in the Jujutsu panel. */
  const moveByKey = (event: KeyboardEvent<HTMLOListElement>): void => {
    const delta = event.key === 'j' || event.key === 'ArrowDown' ? -1 : event.key === 'k' || event.key === 'ArrowUp' ? 1 : 0
    if (delta === 0 || event.altKey || event.ctrlKey || event.metaKey) return
    const target = revisions[currentIndex + delta]
    if (target === undefined) return
    event.preventDefault()
    show(target)
    const row = event.currentTarget.querySelector<HTMLButtonElement>(`[data-revision-commit="${target.commitId}"] > button`)
    row?.focus()
  }

  return (
    <div className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col dshx:gap-3" data-testid="combined-review">
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2" data-testid="combined-summary">
        <span className={STAT}>{revisions.length === 1 ? '1 revision' : `${String(revisions.length)} revisions`}</span>
        <span className={STAT}>{result.fileCount === 1 ? '1 file' : `${String(result.fileCount)} files`}</span>
        <Counts added={result.additions} deleted={result.deletions} />
        <span className={STAT}>
          {viewedCount}/{allFiles.length} viewed
        </span>
        <Progress className="dshx:min-w-16 dshx:flex-1" value={allFiles.length === 0 ? 0 : Math.round((viewedCount / allFiles.length) * 100)} />
        <Button
          disabled={!marks.ready || allFiles.length === 0}
          onClick={() => marks.set(allViewed ? allFiles : allFiles.filter(file => !marks.isViewed(file)), !allViewed)}
          size="xs"
          type="button"
          variant="outline"
        >
          {allViewed ? 'Mark all not viewed' : 'Mark all viewed'}
        </Button>
        {props.refreshable === true ? (
          <Button aria-label="Refresh combined review" onClick={() => void query.refetch()} size="icon-xs" type="button" variant="ghost">
            <RefreshCw aria-hidden className="dshx:size-3.5" />
          </Button>
        ) : null}
      </div>
      {result.segments > 1 ? (
        <p className={HINT} role="status">
          {result.graphComplete === false
            ? 'These revisions are not adjacent, so each one is shown as its own change. The history between them is too long to count here; select fewer or closer revisions to see the gaps.'
            : 'These revisions are not adjacent, so each one is shown as its own change. Dashed lines mark revisions between them that are not in this review.'}
        </p>
      ) : null}
      {result.truncated ? (
        <p className={HINT}>This review is too large to read whole; later revisions show only part of their diff. Select fewer revisions to read them.</p>
      ) : null}
      {result.unresolved.map(item => (
        <p className="dshx:text-xs dshx:text-destructive" key={item.revision} role="alert">
          <span className="dshx:font-mono">{item.revision}</span> was left out. {item.message}
        </p>
      ))}
      {marks.unavailable ? (
        <p className={HINT} role="status">
          Viewed marks are kept by the diff-viewed plugin, which is not loaded. Add @dshfiles/diff-viewed to the profile to mark files.
        </p>
      ) : null}
      {marks.error === null || marks.error === undefined ? null : (
        <p className="dshx:text-xs dshx:text-destructive" role="alert">
          {errorMessage(marks.error, 'Viewed marks could not be saved; try again.')}
        </p>
      )}
      {revisions.length === 0 ? <EmptyState>None of the selected revisions could be read. Select them again in the graph.</EmptyState> : null}
      <ol
        aria-label="Reviewed revisions"
        className="dshx:flex dshx:flex-col dshx:rounded-md dshx:border dshx:border-border dshx:py-0.5"
        data-testid="combined-graph"
        onKeyDown={moveByKey}
      >
        {graph.map(entry =>
          entry.kind === 'base' ? (
            <BaseRow entry={entry} key={entry.layout.commitId} width={graphWidth} />
          ) : (
            <li className="dshx:flex dshx:flex-col" data-revision-commit={entry.revision.commitId} key={entry.revision.commitId}>
              <RevisionRow
                current={entry.revision.commitId === current?.commitId}
                entry={entry}
                onShow={() => show(entry.revision)}
                viewed={entry.revision.files.filter(file => marks.isViewed({ commitId: entry.revision.commitId, path: file.path })).length}
                width={graphWidth}
              />
              {entry.revision.files.length === 0 ? null : (
                <LaneFiller lanes={entry.layout.bottomLanes} width={graphWidth}>
                  <ul aria-label={`Files of ${entry.revision.shortChangeId}`} className="dshx:flex dshx:flex-col dshx:py-0.5">
                    {orderReviewFiles({ files: entry.revision.files }).map(file => {
                      const target = { commitId: entry.revision.commitId, path: file.path }
                      const viewed = marks.isViewed(target)
                      return (
                        <li className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:py-0.5 dshx:pr-2" key={file.path}>
                          <Checkbox
                            aria-label={`${viewed ? 'Mark not viewed' : 'Mark viewed'}: ${file.path} in ${entry.revision.shortChangeId}`}
                            checked={viewed}
                            className="dshx:size-3.5 dshx:data-[state=checked]:border-success dshx:data-[state=checked]:bg-success"
                            disabled={!marks.ready}
                            onCheckedChange={next => marks.set([target], next === true)}
                          />
                          <button
                            className={cn(
                              'dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-left dshx:font-mono dshx:text-xs dshx:hover:underline',
                              viewed && 'dshx:text-muted-foreground',
                            )}
                            onClick={() => {
                              if (entry.revision.commitId === current?.commitId && packageJson.isTextHidden(file.path)) packageJson.showText(file.path)
                              show(entry.revision, file.path)
                            }}
                            type="button"
                          >
                            {file.path}
                          </button>
                          <Counts added={file.additions} deleted={file.deletions} />
                        </li>
                      )
                    })}
                  </ul>
                </LaneFiller>
              )}
              {entry.hiddenBelow === 0 ? null : (
                <LaneFiller lanes={entry.layout.bottomLanes} width={graphWidth}>
                  <p className="dshx:py-0.5 dshx:text-[11px] dshx:text-muted-foreground dshx:italic" data-testid="combined-gap">
                    {entry.hiddenBelow === 1 ? '1 revision' : `${String(entry.hiddenBelow)} revisions`} not in this review
                  </p>
                </LaneFiller>
              )}
              {entry.uncountedBelow ? (
                <LaneFiller lanes={entry.layout.bottomLanes} width={graphWidth}>
                  <p className="dshx:py-0.5 dshx:text-[11px] dshx:text-muted-foreground dshx:italic" data-testid="combined-uncounted">
                    Earlier history not counted; select fewer or closer revisions to see it
                  </p>
                </LaneFiller>
              ) : null}
            </li>
          ),
        )}
      </ol>
      {props.comments}
      {current === undefined ? null : (
        <>
          <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
            <Button
              aria-label="Previous revision"
              disabled={currentIndex === 0}
              onClick={() => {
                const previous = revisions[currentIndex - 1]
                if (previous !== undefined) show(previous)
              }}
              size="icon-xs"
              type="button"
              variant="outline"
            >
              <ChevronLeft aria-hidden className="dshx:size-3.5" />
            </Button>
            <Button
              aria-label="Next revision"
              disabled={currentIndex === revisions.length - 1}
              onClick={() => {
                const next = revisions[currentIndex + 1]
                if (next !== undefined) show(next)
              }}
              size="icon-xs"
              type="button"
              variant="outline"
            >
              <ChevronRight aria-hidden className="dshx:size-3.5" />
            </Button>
            <p className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-xs" data-testid="combined-current">
              Revision {currentIndex + 1} of {revisions.length}: <span className="dshx:font-mono">{current.shortChangeId}</span> {subject(current)}
            </p>
          </div>
          <PackageJsonTables onShowText={path => setChosen({ commitId: current.commitId, focusPath: path })} view={packageJson} />
          <ChangedImages
            images={images}
            renderActions={path => {
              const target = { commitId: current.commitId, path }
              const viewed = marks.isViewed(target)
              return (
                <Button
                  aria-label={`${viewed ? 'Mark not viewed' : 'Mark viewed'}: ${path}`}
                  className="dshx:gap-1 dshx:text-[11px]"
                  disabled={!marks.ready}
                  onClick={() => marks.set([target], !viewed)}
                  size="sm"
                  variant={viewed ? 'secondary' : 'ghost'}
                >
                  {viewed ? 'Viewed' : 'Mark viewed'}
                </Button>
              )
            }}
          />
          {packageJson.textFiles.length === 0 && (parsed.length > 0 || images.length > 0) ? null : (
            <div
              className="dshx:flex dshx:min-h-64 dshx:flex-1 dshx:flex-col dshx:overflow-hidden dshx:rounded-md dshx:border dshx:border-border"
              data-testid="combined-diff"
            >
              <PatchView
                className="dshx:flex-1"
                empty={<p className={cn(HINT, 'dshx:p-3')}>This revision changes no file contents.</p>}
                files={packageJson.textFiles}
                focusPath={chosen?.commitId === current.commitId ? chosen.focusPath : null}
                key={current.commitId}
                renderHeaderMetadata={file => {
                  const target = { commitId: current.commitId, path: file.name }
                  const viewed = marks.isViewed(target)
                  return (
                    <Button
                      aria-label={`${viewed ? 'Mark not viewed' : 'Mark viewed'}: ${file.name}`}
                      className="dshx:gap-1 dshx:text-[11px]"
                      disabled={!marks.ready}
                      onClick={() => marks.set([target], !viewed)}
                      size="sm"
                      variant={viewed ? 'secondary' : 'ghost'}
                    >
                      {viewed ? 'Viewed' : 'Mark viewed'}
                    </Button>
                  )
                }}
                {...(props.onLineSelection === undefined ? {} : { onLineSelection: (next: PatchLineSelection) => props.onLineSelection?.(next, current) })}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** Content between two graph rows, with the lanes that pass it drawn on the left so the graph stays continuous. */
const LaneFiller = (props: {
  readonly lanes: ReviewGraphEntry['layout']['bottomLanes']
  readonly width: number
  readonly children: ReactNode
}): JSX.Element => (
  <div className="dshx:relative dshx:min-w-0" style={{ paddingLeft: props.width + 8 }}>
    <GraphLanes lanes={props.lanes} metrics={METRICS} width={props.width} />
    {props.children}
  </div>
)

const RevisionRow = (props: {
  readonly entry: Extract<ReviewGraphEntry, { kind: 'revision' }>
  readonly current: boolean
  readonly viewed: number
  readonly width: number
  readonly onShow: () => void
}): JSX.Element => {
  const { revision, node, layout } = props.entry
  const id = ReviewGraphModel.changeIdParts(revision)
  const bookmarks = revision.bookmarks ?? []
  const fileCount = revision.files.length
  return (
    <button
      aria-current={props.current ? 'true' : undefined}
      className={cn(
        'dshx:flex dshx:w-full dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:pr-2 dshx:text-left dshx:text-xs dshx:hover:bg-accent dshx:focus-visible:bg-accent dshx:focus-visible:outline-none',
        props.current && 'dshx:bg-accent dshx:text-accent-foreground',
      )}
      onClick={props.onShow}
      style={{ height: METRICS.rowHeight }}
      type="button"
    >
      <RevisionGraphCell height={METRICS.rowHeight} layout={layout} metrics={METRICS} revision={node} width={props.width} />
      <code className="dshx:shrink-0 dshx:font-mono! dshx:text-[11px]">
        <span className="dshx:font-semibold">{id.prefix}</span>
        <span className="dshx:text-muted-foreground">{id.rest}</span>
      </code>
      {revision.workingCopy === true ? <span className={cn(CHIP, 'dshx:bg-info/15 dshx:text-info')}>@</span> : null}
      {revision.conflict === true ? <span className={cn(CHIP, 'dshx:bg-destructive/15 dshx:text-destructive')}>conflict</span> : null}
      {revision.divergent === true ? <span className={cn(CHIP, 'dshx:bg-violet/15 dshx:text-violet')}>divergent</span> : null}
      {revision.empty === true ? <span className={cn(CHIP, 'dshx:bg-muted dshx:text-muted-foreground')}>empty</span> : null}
      {bookmarks.slice(0, 2).map(bookmark => (
        <span className={cn(CHIP, 'dshx:max-w-24 dshx:truncate dshx:bg-success/15 dshx:text-success')} key={bookmark}>
          {bookmark}
        </span>
      ))}
      {bookmarks.length > 2 ? <span className="dshx:shrink-0 dshx:text-[10px] dshx:text-muted-foreground">+{bookmarks.length - 2}</span> : null}
      <span className={cn('dshx:min-w-0 dshx:flex-1 dshx:truncate', revision.description.length === 0 && 'dshx:text-muted-foreground dshx:italic')}>
        {subject(revision)}
      </span>
      <Counts added={revision.additions} deleted={revision.deletions} />
      {fileCount === 0 ? null : (
        <span className={cn(STAT, 'dshx:@max-pane-narrow:hidden', props.viewed === fileCount && 'dshx:text-success')}>
          {props.viewed}/{fileCount}
        </span>
      )}
    </button>
  )
}

/** A parent the selection sits on outside the review: context only, named by its bookmark when it has one. */
const BaseRow = (props: { readonly entry: Extract<ReviewGraphEntry, { kind: 'base' }>; readonly width: number }): JSX.Element => {
  const { base, node, layout } = props.entry
  const label = ReviewGraphModel.isRoot(base) ? 'root()' : base.shortChangeId
  return (
    <li
      aria-label={`Base ${base.bookmarks[0] ?? label}, not in this review`}
      className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:pr-2 dshx:text-xs dshx:text-muted-foreground"
      data-testid="combined-base"
      style={{ height: METRICS.rowHeight }}
    >
      <RevisionGraphCell height={METRICS.rowHeight} layout={layout} metrics={METRICS} revision={node} width={props.width} />
      <code className="dshx:shrink-0 dshx:font-mono! dshx:text-[11px]">{label}</code>
      {base.bookmarks.slice(0, 2).map(bookmark => (
        <span className={cn(CHIP, 'dshx:max-w-24 dshx:truncate dshx:bg-muted dshx:text-muted-foreground')} key={bookmark}>
          {bookmark}
        </span>
      ))}
      <span className="dshx:min-w-0 dshx:truncate dshx:italic">base, not in this review</span>
    </li>
  )
}
