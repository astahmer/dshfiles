import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { CircleCheckIcon, TriangleAlertIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import * as Schema from 'effect/Schema'
import { useEffect, useRef, useState } from 'react'
import type { CleanupJobView } from '@dshfiles/jj-integration/api'
import { CleanupJobTrailModel, useCleanupJobs } from './cleanup-jobs-queries.js'

/** A finished job keeps its line long enough to be noticed, not for the rest of the day. A failure stays until handled. */
const SETTLED_TRAIL_WINDOW_MS = 15 * 60_000
const MAX_DISMISSED_RESULTS = 24
const NO_DISMISSED_RESULTS: readonly string[] = []

/**
 * The one owner of dismissals, for results and failures alike, kept across reloads: a failure otherwise stays on its
 * project's panel until a later cleanup of that project supersedes it, so a dismissal is the only other way it leaves.
 */
const dismissedResults = createStoredValue({
  key: 'dshfiles-jujutsu.dismissed-cleanup-results',
  schema: Schema.Array(Schema.String),
  fallback: NO_DISMISSED_RESULTS,
})

const plural = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? '' : 's'}`

/** The counts a running job has already settled, so a long removal reads as progress instead of a spinner. */
const runningDetail = (job: CleanupJobView): string =>
  [
    job.progress.removed === 0 ? undefined : plural(job.progress.removed, 'workspace') + ' removed',
    job.progress.kept === 0 ? undefined : `${String(job.progress.kept)} kept`,
    job.progress.failed === 0 ? undefined : `${String(job.progress.failed)} failed`,
    job.progress.current ?? undefined,
  ]
    .filter(part => part !== undefined)
    .join(' · ')

/**
 * Removals outlive the click that asked for them, so the trail — not the dialog — is where progress lives. It shows the
 * jobs of the panel's project (including those asked from its thread workspaces), polls only while a job runs, and
 * keeps a failure on screen with its reason and the safe next step until it is dismissed or a later cleanup replaces it.
 */
export const WorkspaceCleanupTrail = (props: {
  /** The panel's repository root, or one of its thread workspaces: the Host traces it to the owning project. */
  readonly path: string | undefined
  readonly onFinished: () => void
  /** Opens the cleanup dialog on this project, whose preview rechecks every workspace before removing anything. */
  readonly onReview?: (() => void) | undefined
}): JSX.Element | null => {
  const jobs = useCleanupJobs(props.path)
  const dismissedKeys = dismissedResults.useValue()
  const [settledVisible, setSettledVisible] = useState(false)
  const reported = useRef<string | null>(null)
  const onFinished = useRef(props.onFinished)
  onFinished.current = props.onFinished
  const entries = jobs.data?.jobs ?? []
  // A second scope can queue behind the one that runs, and the running job is what has progress to show.
  const active = entries.find(job => job.state === 'running') ?? entries.find(CleanupJobTrailModel.isActive)
  const latest = entries[0]

  // A finished line is worth seeing for a while, not forever: a page reloaded the next day starts clean. A failure is
  // the exception: it stays until handled, so it is still there when the user comes back to the project.
  useEffect(() => {
    setSettledVisible(
      latest !== undefined &&
        latest.finishedAt !== null &&
        (CleanupJobTrailModel.hasFailure(latest) || Date.now() - latest.finishedAt <= SETTLED_TRAIL_WINDOW_MS),
    )
  }, [latest])

  useEffect(() => {
    if (latest === undefined || CleanupJobTrailModel.isActive(latest) || reported.current === latest.id) return
    reported.current = latest.id
    onFinished.current()
  }, [latest])

  if (active === undefined) {
    if (latest === undefined || !settledVisible) return null
    const dismissKey = CleanupJobTrailModel.dismissKey(latest)
    if (dismissedKeys.includes(dismissKey)) return null
    const failed = CleanupJobTrailModel.hasFailure(latest)
    const summary = CleanupJobTrailModel.summary(latest)
    if (summary === '') return null
    const failure = CleanupJobTrailModel.failure(latest)
    const recovery = CleanupJobTrailModel.recovery(latest)
    const dismiss = (): void => {
      dismissedResults.set([...dismissedKeys.filter(key => key !== dismissKey), dismissKey].slice(-MAX_DISMISSED_RESULTS))
    }
    return (
      <TooltipProvider delayDuration={500}>
        <div
          // An alert is announced at once on its own; a result waits for a pause.
          aria-live={failed ? undefined : 'polite'}
          className={cn(
            'dshx:flex dshx:min-w-0 dshx:flex-none dshx:flex-col dshx:gap-1 dshx:border-b dshx:px-3 dshx:py-1.5 dshx:text-xs',
            failed ? 'dshx:text-destructive' : 'dshx:text-muted-foreground',
          )}
          data-cleanup-failure={failed ? '' : undefined}
          role={failed ? 'alert' : 'status'}
        >
          <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
            {failed ? <TriangleAlertIcon className="dshx:size-3.5 dshx:flex-none" /> : <CircleCheckIcon className="dshx:size-3.5 dshx:flex-none" />}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={cn('dshx:min-w-0 dshx:flex-1 dshx:truncate', failure !== null && 'dshx:font-medium')}>{failure?.headline ?? summary}</span>
              </TooltipTrigger>
              <TooltipContent className="dshx:max-w-sm dshx:break-words" side="bottom">
                {summary}
              </TooltipContent>
            </Tooltip>
            {failed && props.onReview !== undefined && (
              <Button className="dshx:shrink" onClick={props.onReview} size="xs" type="button" variant="outline">
                Review cleanup…
              </Button>
            )}
            <Button
              aria-label={failed ? 'Dismiss the cleanup failure' : 'Dismiss the cleanup result'}
              className="dshx:flex-none"
              onClick={dismiss}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <XIcon />
            </Button>
          </div>
          {failure?.reason !== undefined && failure.reason !== null && (
            <p className="dshx:m-0 dshx:line-clamp-2 dshx:min-w-0 dshx:pl-5 dshx:font-mono dshx:break-all">{failure.reason}</p>
          )}
          {recovery !== null && <p className="dshx:m-0 dshx:min-w-0 dshx:pl-5 dshx:break-words dshx:text-muted-foreground">{recovery}</p>}
        </div>
      </TooltipProvider>
    )
  }

  const progress = CleanupJobTrailModel.progressLabel(active)
  const detail = runningDetail(active)
  return (
    <div
      aria-live="polite"
      className="dshx:flex dshx:min-w-0 dshx:flex-none dshx:flex-col dshx:gap-0.5 dshx:border-b dshx:px-3 dshx:py-1.5 dshx:text-xs"
      role="status"
    >
      <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
        <Spinner className="dshx:size-3.5 dshx:flex-none" />
        <span className="dshx:font-medium">{CleanupJobTrailModel.phaseLabel(active)}</span>
        {progress === '' ? null : <span className="dshx:font-mono dshx:text-muted-foreground">{progress}</span>}
      </div>
      {detail === '' ? null : <span className="dshx:min-w-0 dshx:truncate dshx:pl-5 dshx:text-muted-foreground">{detail}</span>}
    </div>
  )
}
