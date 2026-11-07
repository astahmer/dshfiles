import { useApi } from '@dshfiles/dshx/client'
import { EmptyState } from '@dshfiles/plugin-ui/components/page'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { Progress } from '@dshfiles/plugin-ui/components/ui/progress'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { PatchView, parsePatchFiles, type PatchLineSelection } from '@dshfiles/plugin-ui/diff'
import { ChevronLeft, ChevronRight, RefreshCw } from '@dshfiles/plugin-ui/icons'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useQuery } from '@dshfiles/plugin-ui/query'
import { useMemo, useState, type ReactNode } from 'react'
import { pullsReviewApi, type RevisionReview } from './api.js'
import { useRevisionsViewedMarks, type RevisionFile } from './viewed-marks.js'

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
  const review = useApi(pullsReviewApi)
  const { workspacePath, revisions: requested } = props
  const query = useQuery({
    queryKey: ['pulls-review', 'combined', workspacePath, requested.join(' ')],
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
  const parsed = useMemo(() => (currentPatch.length === 0 ? [] : parsePatchFiles(currentPatch).flatMap(file => file.files)), [currentPatch])

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
          These revisions are not adjacent, so each one is shown as its own change. Revisions between them are not part of this review.
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
      <ol aria-label="Reviewed revisions" className="dshx:flex dshx:flex-col dshx:gap-1">
        {revisions.map(revision => (
          <li className="dshx:rounded-md dshx:border dshx:border-border" data-revision-commit={revision.commitId} key={revision.commitId}>
            <button
              aria-current={revision.commitId === current?.commitId ? 'true' : undefined}
              className={cn(
                'dshx:flex dshx:w-full dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:px-2 dshx:py-1 dshx:text-left dshx:text-xs dshx:hover:bg-accent',
                revision.commitId === current?.commitId && 'dshx:bg-accent',
              )}
              onClick={() => show(revision)}
              type="button"
            >
              <span className="dshx:shrink-0 dshx:font-mono dshx:text-muted-foreground">{revision.shortChangeId}</span>
              <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{subject(revision)}</span>
              <Counts added={revision.additions} deleted={revision.deletions} />
            </button>
            {revision.files.length === 0 ? null : (
              <ul
                aria-label={`Files of ${revision.shortChangeId}`}
                className="dshx:flex dshx:flex-col dshx:divide-y dshx:divide-border dshx:border-t dshx:border-border"
              >
                {revision.files.map(file => {
                  const target = { commitId: revision.commitId, path: file.path }
                  const viewed = marks.isViewed(target)
                  return (
                    <li className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:py-1 dshx:pr-2 dshx:pl-4" key={file.path}>
                      <Checkbox
                        aria-label={`${viewed ? 'Mark not viewed' : 'Mark viewed'}: ${file.path} in ${revision.shortChangeId}`}
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
                        onClick={() => show(revision, file.path)}
                        type="button"
                      >
                        {file.path}
                      </button>
                      <Counts added={file.additions} deleted={file.deletions} />
                    </li>
                  )
                })}
              </ul>
            )}
          </li>
        ))}
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
          <div
            className="dshx:flex dshx:min-h-64 dshx:flex-1 dshx:flex-col dshx:overflow-hidden dshx:rounded-md dshx:border dshx:border-border"
            data-testid="combined-diff"
          >
            <PatchView
              className="dshx:flex-1"
              empty={<p className={cn(HINT, 'dshx:p-3')}>This revision changes no file contents.</p>}
              files={parsed}
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
        </>
      )}
    </div>
  )
}
