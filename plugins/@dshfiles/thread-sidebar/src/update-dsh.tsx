import type { StatusItemProps } from '@dshfiles/frame-layout/status-strip'
import { jjIntegrationApi, type UpdateCheckView } from '@dshfiles/jj-integration/api'
import { useApi } from '@dshfiles/dshx/client'
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
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { DownloadIcon, RefreshCwIcon, RotateCcwIcon } from '@dshfiles/plugin-ui/icons'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, PluginQueryProvider, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useState, useSyncExternalStore } from 'react'
import { RestartBridge } from './restart-bridge.js'

/** The Settings section id (settings-shell places it under About). */
export const UPDATE_DSH_SECTION_ID = 'dshfiles-update-dsh'

type UpdateCheck = UpdateCheckView

const checkKey = ['thread-sidebar', 'update-dsh'] as const
const HINT = 'dshx:text-xs dshx:text-muted-foreground'

/** Open Settings on this section through settings-shell's cross-plugin event. */
export const openUpdateDshSettings = (): void => {
  window.dispatchEvent(new CustomEvent('dshfiles:open-settings', { detail: { section: UPDATE_DSH_SECTION_ID }, cancelable: true }))
}

const headline = (check: UpdateCheck | undefined): string => {
  if (check === undefined) return 'Reading the DSH checkout…'
  if (check.job?.state === 'running') return check.job.phase === 'fetching' ? 'Updating DSH: fetching…' : 'Updating DSH: syncing and rebuilding…'
  if (check.checkout === null) return 'Update DSH is unavailable here'
  if (check.incomingCount === 0) return 'DSH is up to date'
  return `${String(check.incomingCount)} new revision${check.incomingCount === 1 ? '' : 's'}`
}

const relative = (at: number): string => {
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${String(minutes)} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${String(hours)} h ago` : `${String(Math.round(hours / 24))} d ago`
}

const useUpdateCheck = (poll: number) => {
  const jj = useApi(jjIntegrationApi)
  return useQuery<UpdateCheck>({
    queryKey: checkKey,
    retry: false,
    refetchInterval: query => (query.state.data?.job?.state === 'running' ? 1_500 : poll),
    queryFn: ({ signal }) => runHostRequest({ signal, timeoutMs: 120_000, request: hostSignal => jj.updateCheck({ fetch: false }, { signal: hostSignal }) }),
  })
}

const Impact = (props: { readonly check: UpdateCheck }): JSX.Element | null => {
  const plan = props.check.plan
  if (plan === null) return props.check.planError === null ? null : <p className={HINT}>Could not predict the rebuild: {props.check.planError}</p>
  const hot = plan.plugins.filter(plugin => plugin.client && !plugin.host).map(plugin => plugin.name)
  const host = plan.plugins.filter(plugin => plugin.host).map(plugin => plugin.name)
  return (
    <dl className="dshx:grid dshx:grid-cols-[auto_minmax(0,1fr)] dshx:gap-x-3 dshx:gap-y-1 dshx:text-xs" data-testid="update-dsh-impact">
      <dt className="dshx:text-muted-foreground">Files</dt>
      <dd>{plan.changedFiles}</dd>
      {plan.installs.length === 0 ? null : (
        <>
          <dt className="dshx:text-muted-foreground">Installs</dt>
          <dd className="dshx:font-mono">{plan.installs.join(', ')}</dd>
        </>
      )}
      <dt className="dshx:text-muted-foreground">Hot-reloads</dt>
      <dd className="dshx:min-w-0 dshx:break-words dshx:font-mono">{hot.length === 0 ? 'nothing' : hot.join(', ')}</dd>
      <dt className="dshx:text-muted-foreground">Restart</dt>
      <dd className="dshx:min-w-0 dshx:break-words">
        {plan.restartNeeded ? `needed afterwards (${host.length === 0 ? plan.restartReasons.join('; ') : host.join(', ')})` : 'not needed'}
      </dd>
    </dl>
  )
}

type UpdateJob = NonNullable<UpdateCheck['job']>

const jobHeadline = (job: UpdateJob): string => {
  if (job.state === 'running') return job.phase === 'fetching' ? 'Fetching…' : 'Syncing the checkout and rebuilding…'
  if (job.state === 'done') return 'Updated'
  if (job.state === 'refused') return 'Stopped before changing anything'
  return 'Update failed'
}

/** The status-strip word for the update: running, stopped, how many commits wait, or nothing to say. */
const statusLabel = (job: UpdateCheck['job'], failed: boolean, incomingCount: number): string | undefined => {
  if (job?.state === 'running') return 'Updating DSH…'
  if (failed) return 'Update stopped'
  return incomingCount > 0 ? `Update · ${String(incomingCount)}` : undefined
}

const JobState = (props: { readonly check: UpdateCheck; readonly restartAvailable: boolean; readonly waitingLabel: string | null }): JSX.Element | null => {
  const job = props.check.job
  if (job === null) return null
  const failed = job.state === 'failed'
  return (
    <section
      aria-label="Last update"
      className="dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-md dshx:border dshx:border-border dshx:p-3"
      data-testid="update-dsh-job"
    >
      <p className={cn('dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm', failed && 'dshx:text-destructive')} role={failed ? 'alert' : 'status'}>
        {job.state === 'running' ? <Spinner /> : null}
        {jobHeadline(job)}
      </p>
      {job.message === null ? null : (
        <p className={cn('dshx:text-xs dshx:break-words', failed ? 'dshx:text-destructive' : 'dshx:text-muted-foreground')}>{job.message}</p>
      )}
      {job.progress.length === 0 ? null : (
        <ol aria-label="Progress" className="dshx:max-h-32 dshx:overflow-y-auto dshx:font-mono dshx:text-2xs dshx:text-muted-foreground">
          {job.progress.map((line, index) => (
            <li className="dshx:truncate" key={`${String(index)}-${line}`}>
              {line}
            </li>
          ))}
        </ol>
      )}
      {job.sync === null || job.sync.pluginsRebuilt.length === 0 ? null : <p className={HINT}>Rebuilt: {job.sync.pluginsRebuilt.join(', ')}</p>}
      {job.state === 'done' && job.sync?.restartNeeded === true ? (
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2" data-testid="update-dsh-restart">
          <p className="dshx:min-w-0 dshx:flex-1 dshx:text-xs">DSH needs a restart to load the new Host code. It waits for running turns.</p>
          {props.restartAvailable ? (
            <Button disabled={props.waitingLabel !== null} onClick={() => RestartBridge.request('restart-when-idle')} size="sm" type="button" variant="outline">
              <RotateCcwIcon aria-hidden className="dshx:size-3.5" />
              {props.waitingLabel ?? 'Restart when idle'}
            </Button>
          ) : (
            <p className={HINT}>This launcher cannot restart DSH: restart it yourself when no agent is working.</p>
          )}
        </div>
      ) : null}
    </section>
  )
}

/**
 * Settings › About › Update DSH (productivity pass E3): check `main@origin` for the checkout DSH runs from, read What's
 * new and what it would rebuild, update through jj-integration's background job, then the existing Restart when idle.
 * Nothing restarts or pushes by itself; diverged history or a checkout this plugin cannot reach shows the exact commands.
 */
const UpdateDshPanel = (): JSX.Element => {
  const jj = useApi(jjIntegrationApi)
  const queryClient = useQueryClient()
  const check = useUpdateCheck(60_000)
  const restart = useSyncExternalStore(RestartBridge.subscribe, RestartBridge.read, RestartBridge.read)
  const [confirming, setConfirming] = useState(false)
  const fetchNow = useMutation({
    mutationFn: () => runHostRequest({ timeoutMs: 180_000, request: signal => jj.updateCheck({ fetch: true }, { signal }) }),
    onSuccess: data => queryClient.setQueryData(checkKey, data),
  })
  const apply = useMutation({
    mutationFn: () => runHostRequest({ timeoutMs: 60_000, request: signal => jj.updateApply({ confirm: true }, { signal }) }),
    onSuccess: data => queryClient.setQueryData(checkKey, data.check),
  })
  const data = check.data
  const running = data?.job?.state === 'running'
  return (
    <div className="dshx-root dshx:@container dshx:flex dshx:max-w-3xl dshx:flex-col dshx:gap-4 dshx:p-1" data-testid="update-dsh">
      <header className="dshx:flex dshx:flex-col dshx:gap-1">
        <p className={HINT}>
          Bring the checkout DSH runs from onto the newest {data?.checkout?.bookmark ?? 'main'} from {data?.checkout?.remote ?? 'origin'}, rebuild what changed,
          then restart when you are ready. Nothing restarts or is pushed by itself.
        </p>
      </header>
      <section className="dshx:flex dshx:flex-col dshx:gap-3 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card dshx:p-3">
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
          <p className="dshx:min-w-0 dshx:flex-1 dshx:text-sm dshx:font-medium" data-testid="update-dsh-headline">
            {headline(data)}
          </p>
          <Button
            disabled={fetchNow.isPending || running || data?.checkout === null}
            onClick={() => fetchNow.mutate()}
            size="sm"
            type="button"
            variant="outline"
          >
            {fetchNow.isPending ? <Spinner /> : <RefreshCwIcon aria-hidden className="dshx:size-3.5" />}
            Check for updates
          </Button>
          <Button
            data-testid="update-dsh-apply"
            disabled={data?.canApply !== true || apply.isPending}
            onClick={() => setConfirming(true)}
            size="sm"
            type="button"
          >
            {apply.isPending || running ? <Spinner /> : <DownloadIcon aria-hidden className="dshx:size-3.5" />}
            Update…
          </Button>
        </div>
        {data?.checkout === undefined || data.checkout === null ? null : (
          <p className={cn(HINT, 'dshx:break-all')}>
            {data.checkout.workspace} workspace · {data.checkout.path}
            {data.fetch === null ? ' · not fetched since DSH started' : ` · fetched ${relative(data.fetch.at)}`}
            {data.localOnly > 0 ? ` · ${String(data.localOnly)} local revision${data.localOnly === 1 ? '' : 's'} not on ${data.checkout.remote}` : ''}
          </p>
        )}
        {check.isError ? (
          <p className="dshx:text-xs dshx:text-destructive" role="alert">
            {errorMessage(check.error, 'Could not read the DSH checkout.')} Try Check for updates again, or update by hand with the commands below.
          </p>
        ) : null}
        {fetchNow.isError ? (
          <p className="dshx:text-xs dshx:text-destructive" role="alert">
            {errorMessage(fetchNow.error, 'The check failed.')} Check the network and the remote, then try again.
          </p>
        ) : null}
        {data?.fetch?.status === 'failed' && data.fetch.message !== null ? (
          <p className="dshx:text-xs dshx:break-words dshx:text-destructive" role="alert">
            {data.fetch.message}
          </p>
        ) : null}
        {data?.unavailable === null || data?.unavailable === undefined ? null : <p className="dshx:text-xs dshx:break-words">{data.unavailable}</p>}
        {data?.blocked === null || data?.blocked === undefined ? null : (
          <p className="dshx:text-xs dshx:break-words" data-testid="update-dsh-blocked" role="status">
            {data.blocked}
          </p>
        )}
        {data === undefined || data.incoming.length === 0 ? null : (
          <div className="dshx:flex dshx:flex-col dshx:gap-1">
            <h3 className="dshx:text-xs dshx:font-medium dshx:text-muted-foreground">What’s new</h3>
            <ul
              aria-label="What’s new"
              className="dshx:flex dshx:max-h-64 dshx:flex-col dshx:divide-y dshx:divide-border dshx:overflow-y-auto dshx:rounded-md dshx:border dshx:border-border"
              data-testid="update-dsh-incoming"
            >
              {data.incoming.map(revision => (
                <li className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-baseline dshx:gap-x-2 dshx:px-2 dshx:py-1 dshx:text-xs" key={revision.commitId}>
                  <span className="dshx:shrink-0 dshx:font-mono dshx:text-muted-foreground">{revision.changeId.slice(0, 8)}</span>
                  <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{revision.description || '(no description)'}</span>
                  <span className="dshx:shrink-0 dshx:text-muted-foreground">{revision.author}</span>
                </li>
              ))}
            </ul>
            {data.incomingCount > data.incoming.length ? <p className={HINT}>and {data.incomingCount - data.incoming.length} more</p> : null}
            <Impact check={data} />
          </div>
        )}
        {data === undefined || data.commands.length === 0 || data.incomingCount === 0 ? null : (
          <details className="dshx:text-xs">
            <summary className="dshx:cursor-pointer dshx:text-muted-foreground">Update by hand</summary>
            <pre className="dshx:mt-1 dshx:overflow-x-auto dshx:rounded-md dshx:bg-muted dshx:p-2 dshx:font-mono dshx:text-2xs">{data.commands.join('\n')}</pre>
          </details>
        )}
      </section>
      {data === undefined ? null : <JobState check={data} restartAvailable={restart.available} waitingLabel={restart.waitingLabel} />}
      <AlertDialog onOpenChange={setConfirming} open={confirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Update DSH to {String(data?.incomingCount ?? 0)} new revision{data?.incomingCount === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Fetches {data?.checkout?.remote ?? 'origin'}, moves {data?.checkout?.bookmark ?? 'main'} forward to it and brings the{' '}
              {data?.checkout?.workspace ?? 'default'} checkout onto it, keeping its local edits, then rebuilds what changed. Nothing is pushed and DSH does not
              restart.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {data === undefined ? null : <Impact check={data} />}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="update-dsh-confirm" onClick={() => apply.mutate()}>
              Update
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {apply.isError ? (
        <p className="dshx:text-xs dshx:text-destructive" role="alert">
          {errorMessage(apply.error, 'The update did not start.')} Check for updates again, or use the commands under Update by hand.
        </p>
      ) : null}
    </div>
  )
}

export const UpdateDshSection = (): JSX.Element => (
  <PluginQueryProvider>
    <UpdateDshPanel />
  </PluginQueryProvider>
)

const UpdateStatusView = (props: StatusItemProps): JSX.Element | null => {
  const check = useUpdateCheck(5 * 60_000)
  const data = check.data
  if (data === undefined || data.checkout === null) return null
  const job = data.job
  const failed = job !== null && (job.state === 'failed' || job.state === 'refused') && data.incomingCount > 0
  const label = statusLabel(job, failed, data.incomingCount)
  if (label === undefined) return null
  return (
    <span
      className={cn(
        'dshx-root dshx:inline-flex dshx:min-w-0 dshx:items-center dshx:gap-1',
        failed && job?.state === 'failed' && 'dshx:text-destructive',
        props.compact && 'dshx:text-xs',
      )}
      data-testid="status-item-update-dsh"
    >
      {job?.state === 'running' ? <Spinner className="dshx:size-3" /> : <DownloadIcon aria-hidden className="dshx:size-3" />}
      <span className="dshx:truncate">{label}</span>
    </span>
  )
}

/** The status strip's Update item: hidden while DSH is up to date; it opens Settings › Update DSH. */
export const UpdateStatusItem = (props: StatusItemProps): JSX.Element => (
  <PluginQueryProvider>
    <UpdateStatusView {...props} />
  </PluginQueryProvider>
)
