import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { CircleCheckIcon, TriangleAlertIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useEffect, useRef, useState } from 'react'
import type { CleanupJobView } from '@dshfiles/jj-integration/api'
import { CleanupJobTrailModel, useCleanupJobs } from './cleanup-jobs-queries.js'

/** A finished job keeps its line long enough to be noticed, not for the rest of the day. */
const SETTLED_TRAIL_WINDOW_MS = 15 * 60_000

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
 * Removals outlive the click that asked for them, so the trail — not the dialog — is where progress lives. It polls only
 * while a job runs and keeps the last settled job on screen until the user dismisses it.
 */
export const WorkspaceCleanupTrail = (props: { readonly onFinished: () => void }): JSX.Element | null => {
  const jobs = useCleanupJobs()
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [settledVisible, setSettledVisible] = useState(false)
  const reported = useRef<string | null>(null)
  const onFinished = useRef(props.onFinished)
  onFinished.current = props.onFinished
  const entries = jobs.data?.jobs ?? []
  // A second scope can queue behind the one that runs, and the running job is what has progress to show.
  const active = entries.find(job => job.state === 'running') ?? entries.find(CleanupJobTrailModel.isActive)
  const latest = entries[0]

  // A finished line is worth seeing for a while, not forever: a page reloaded the next day starts clean.
  useEffect(() => {
    setSettledVisible(latest !== undefined && latest.finishedAt !== null && Date.now() - latest.finishedAt <= SETTLED_TRAIL_WINDOW_MS)
  }, [latest])

  useEffect(() => {
    if (latest === undefined || CleanupJobTrailModel.isActive(latest) || reported.current === latest.id) return
    reported.current = latest.id
    onFinished.current()
  }, [latest])

  if (active === undefined) {
    if (latest === undefined || !settledVisible || latest.id === dismissed) return null
    const summary = CleanupJobTrailModel.summary(latest)
    if (summary === '') return null
    const failed = latest.state === 'failed'
    return (
      <TooltipProvider delayDuration={500}>
        <div
          aria-live="polite"
          className={cn(
            'dshx:flex dshx:min-w-0 dshx:flex-none dshx:items-center dshx:gap-2 dshx:border-b dshx:px-3 dshx:py-1.5 dshx:text-xs',
            failed ? 'dshx:text-destructive' : 'dshx:text-muted-foreground',
          )}
          role="status"
        >
          {failed ? <TriangleAlertIcon className="dshx:size-3.5 dshx:flex-none" /> : <CircleCheckIcon className="dshx:size-3.5 dshx:flex-none" />}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate" title={summary}>
                {summary}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">{summary}</TooltipContent>
          </Tooltip>
          <Button
            aria-label="Dismiss the cleanup result"
            className="dshx:flex-none"
            onClick={() => setDismissed(latest.id)}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <XIcon />
          </Button>
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
