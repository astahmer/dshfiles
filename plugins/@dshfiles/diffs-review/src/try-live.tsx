import { jjIntegrationApi, type LandImpactView } from '@dshfiles/jj-integration/api'
import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { FlaskConicalIcon } from '@dshfiles/plugin-ui/icons'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useQuery } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'

const HINT = 'dshx:text-xs dshx:text-muted-foreground'

const Group = (props: { readonly title: string; readonly names: readonly string[]; readonly empty: string; readonly testId: string }): JSX.Element => (
  <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1" data-testid={props.testId}>
    <h4 className="dshx:text-xs dshx:font-medium">{props.title}</h4>
    {props.names.length === 0 ? (
      <p className={HINT}>{props.empty}</p>
    ) : (
      <ul className="dshx:flex dshx:max-h-40 dshx:flex-col dshx:overflow-y-auto dshx:font-mono dshx:text-xs dshx:text-muted-foreground">
        {props.names.map(name => (
          <li className="dshx:truncate" key={name}>
            {name}
          </li>
        ))}
      </ul>
    )}
  </div>
)

const Impact = (props: { readonly impact: LandImpactView }): JSX.Element => {
  const plan = props.impact.plan
  if (!props.impact.applies || plan === null)
    return <p className="dshx:text-sm">{props.impact.reason ?? 'Landing this thread changes nothing in the running DSH.'}</p>
  const live = plan.plugins.filter(plugin => plugin.client && !plugin.host).map(plugin => plugin.name)
  const restart = plan.plugins.filter(plugin => plugin.host).map(plugin => plugin.name)
  return (
    <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3">
      <p className="dshx:text-sm" data-testid="try-live-summary">
        {plan.changedFiles === 1 ? '1 file' : `${String(plan.changedFiles)} files`} reach the {props.impact.checkout?.workspace ?? 'default'} checkout DSH runs
        from
        {plan.restartNeeded ? ', and DSH needs a restart to load all of it.' : ', and everything applies without a restart.'}
      </p>
      <Group empty="No plugin client changes." names={live} testId="try-live-hot" title="Hot-reloads in open tabs" />
      <Group
        empty="Nothing waits for a restart."
        names={restart.length === 0 && plan.restartNeeded ? plan.restartReasons : restart}
        testId="try-live-restart"
        title="Needs a restart"
      />
      {plan.installs.length === 0 ? null : <p className={HINT}>Reinstalls dependencies in {plan.installs.join(', ')}.</p>}
    </div>
  )
}

/**
 * Try this change live (productivity pass T3.5): before landing, what the running DSH would pick up once this thread
 * lands and its checkout syncs — which bundles hot-reload and which wait for Restart when idle (hmr-gate's rule), read
 * from jj-integration's `landImpact` (`dshx checkout plan`). It never lands, syncs or restarts.
 */
export const TryLive = (props: { readonly cwd: string; readonly bookmark: string }): JSX.Element => {
  const jj = useApi(jjIntegrationApi)
  const [open, setOpen] = useState(false)
  const impact = useQuery({
    queryKey: ['diffs-review', 'land-impact', props.cwd],
    enabled: open,
    staleTime: 15_000,
    retry: false,
    queryFn: ({ signal }) => runHostRequest({ signal, timeoutMs: 150_000, request: hostSignal => jj.landImpact({ path: props.cwd }, { signal: hostSignal }) }),
  })
  return (
    <>
      <Button
        aria-label="Try this change live"
        className="dshx:shrink-0"
        data-testid="land-card-try-live"
        onClick={() => setOpen(true)}
        size="xs"
        type="button"
        variant="ghost"
      >
        <FlaskConicalIcon aria-hidden className="dshx:size-3.5" />
        Try live
      </Button>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="dshx-root dshx:grid-cols-[minmax(0,1fr)] dshx:sm:max-w-lg" data-testid="try-live-dialog">
          <DialogHeader>
            <DialogTitle className="dshx:text-base">Try this change live</DialogTitle>
            <DialogDescription>
              What the running DSH picks up once this thread lands on {props.bookmark}. Nothing lands or restarts from here.
            </DialogDescription>
          </DialogHeader>
          {impact.isPending ? (
            <p className={cn(HINT, 'dshx:flex dshx:items-center dshx:gap-2')}>
              <Spinner /> Planning the checkout move…
            </p>
          ) : impact.isError ? (
            <p className="dshx:text-xs dshx:text-destructive" role="alert">
              {errorMessage(impact.error, 'Could not plan the change.')} Try again, or ask the agent to run jj_thread_land_impact.
            </p>
          ) : (
            <Impact impact={impact.data} />
          )}
          {/* dshfiles: Restart lives on the rail now. No restart button here: before Land nothing new is on disk to load, and
              once the checkout syncs the rail's Restart shows the pending plugins with its own confirmation. */}
          <p className={HINT} data-testid="try-live-restart-hint">
            Land it with the card's Land. The checkout then syncs in the background; when a restart is needed, use Restart DSH (bottom of the rail), which lists
            what is waiting and can wait until running turns finish.
          </p>
          <DialogFooter>
            <Button disabled={impact.isFetching} onClick={() => void impact.refetch()} size="sm" type="button" variant="outline">
              Plan again
            </Button>
            <Button onClick={() => setOpen(false)} size="sm" type="button">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
