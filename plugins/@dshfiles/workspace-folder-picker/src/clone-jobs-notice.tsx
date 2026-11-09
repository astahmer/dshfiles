import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Progress } from '@dshfiles/plugin-ui/components/ui/progress'
import { errorMessage, useMutation, useQuery, useQueryClient, type Query } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { useState } from 'react'
import { cloneStepLabel } from './clone-labels.js'
import { projectLifecycleApi, type CloneJob, type ProjectLifecycleClient } from './project-lifecycle-api.js'

const CLONE_JOBS_KEY = ['workspace-folder-picker', 'clone-jobs'] as const
const MAX_NOTICES = 3

/**
 * One query for the dialog and the overlay. React Query keeps one refetch timer per query, so both observers must agree
 * on the interval; an overlay polling `false` would otherwise stop the dialog's 500 ms progress too.
 */
export const cloneJobsQuery = (api: ProjectLifecycleClient) => ({
  queryKey: CLONE_JOBS_KEY,
  queryFn: () => api.cloneJobs({}),
  // The plugin client keeps a 30 s staleness default, and the overlay fetches at boot: without this the dialog's own
  // observer mounts with "fresh" empty data and never reads the job it just started.
  staleTime: 0,
  refetchInterval: (query: Query<{ readonly jobs: readonly CloneJob[] }>) =>
    query.state.data?.jobs.some(job => job.state === 'running') === true ? 500 : false,
})

/** Jobs worth a notice outside the dialog: still running, or failed and not dismissed yet. */
export const cloneJobsToAnnounce = (jobs: readonly CloneJob[], dismissed: readonly string[]): readonly CloneJob[] =>
  jobs.filter(job => job.state === 'running' || (job.state === 'failed' && !dismissed.includes(job.id))).slice(0, MAX_NOTICES)

/**
 * The clone keeps running after its dialog closes, so the shell overlay carries it: phase, progress, cancel and retry.
 * It reads the same query the dialog does, so a clone started there shows up here without a second source of truth.
 */
export const CloneJobsNotice = (props: { readonly api: ProjectLifecycleClient }): JSX.Element | null => {
  const [dismissed, setDismissed] = useState<readonly string[]>([])
  const queryClient = useQueryClient()
  const jobs = useQuery({ ...cloneJobsQuery(props.api), refetchOnWindowFocus: false })
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: CLONE_JOBS_KEY })
  }
  const cancel = useMutation({ mutationFn: (jobId: string) => props.api.cancelClone({ jobId, confirm: true }), onSettled: refresh })
  const retry = useMutation({ mutationFn: (jobId: string) => props.api.retryClone({ jobId }), onSettled: refresh })
  const jobsShown = cloneJobsToAnnounce(jobs.data?.jobs ?? [], dismissed)
  if (jobsShown.length === 0) return null
  const failure = cancel.isError
    ? errorMessage(cancel.error, 'Could not cancel the clone.')
    : retry.isError
      ? errorMessage(retry.error, 'Could not retry the clone.')
      : null
  return (
    <div
      aria-live="polite"
      className="dshx-root dshx:pointer-events-none dshx:fixed dshx:right-4 dshx:bottom-4 dshx:z-50 dshx:flex dshx:w-80 dshx:flex-col dshx:gap-2"
    >
      {jobsShown.map(job => (
        <div
          key={job.id}
          className="dshx:pointer-events-auto dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-background dshx:p-3 dshx:shadow-lg"
        >
          <div className="dshx:flex dshx:items-start dshx:justify-between dshx:gap-2">
            <div className="dshx:min-w-0">
              <p className="dshx:text-sm dshx:font-medium">{job.state === 'failed' ? 'Clone failed' : cloneStepLabel(job)}</p>
              <p className="dshx:truncate dshx:font-mono dshx:text-xs dshx:text-muted-foreground">{job.path}</p>
            </div>
            {job.state === 'failed' ? (
              <Button aria-label="Dismiss clone notice" onClick={() => setDismissed(current => [...current, job.id])} size="sm" variant="ghost">
                Dismiss
              </Button>
            ) : null}
          </div>
          {job.state === 'running' ? <Progress value={job.progress.percent ?? 0} /> : null}
          {job.state === 'failed' ? <p className="dshx:text-xs dshx:text-destructive">{job.error}</p> : null}
          <div className="dshx:flex dshx:justify-end dshx:gap-2">
            {job.state === 'running' ? (
              <Button disabled={cancel.isPending} onClick={() => cancel.mutate(job.id)} size="sm" variant="outline">
                Cancel clone
              </Button>
            ) : (
              <Button disabled={retry.isPending} onClick={() => retry.mutate(job.id)} size="sm" variant="outline">
                Retry clone
              </Button>
            )}
          </div>
        </div>
      ))}
      {failure === null ? null : <p className="dshx:pointer-events-auto dshx:text-xs dshx:text-destructive">{failure}</p>}
    </div>
  )
}

/** Resolves the API from the browser context; the overlay slot renders it above every screen. */
export const CloneJobsNoticeHost = (): JSX.Element | null => {
  const api = useApi(projectLifecycleApi)
  return <CloneJobsNotice api={api} />
}
