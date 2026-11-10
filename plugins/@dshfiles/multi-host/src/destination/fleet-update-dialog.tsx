import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { CheckIcon, RotateCwIcon, ServerIcon, TriangleAlertIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useMutation, useQuery } from '@dshfiles/plugin-ui/query'
import { useEffect, useRef } from 'react'
import type { HostSummary } from '../api.js'
import { type MultiHostClient } from './queries.js'

type UpdateResult = Awaited<ReturnType<MultiHostClient['hostUpdate']>>

/** One host's row: whether it succeeded, what it says, and whether an update would change something. */
type RowOutcome = { readonly ok: boolean; readonly text: string; readonly pending: boolean }

/** What is on the move for this checkout. A host that has not loaded this version reports neither count. */
const movementOf = (result: { readonly incoming?: number | undefined; readonly outgoing?: number | undefined }): string => {
  const incoming = result.incoming ?? 0
  const outgoing = result.outgoing ?? 0
  return incoming + outgoing === 0 ? '' : `${incoming} incoming · ${outgoing} not pushed · `
}

const outcomeOf = (result: UpdateResult): RowOutcome => {
  if (!('detail' in result)) return { ok: false, text: result.message, pending: false }
  if (!result.ok) {
    const recovery = (result.recovery ?? []).filter(step => step.label !== result.detail).map(step => step.command ?? step.label)
    return { ok: false, text: [result.detail, ...recovery].join(' '), pending: false }
  }
  const counts = movementOf(result)
  if (!result.applied) return { ok: true, text: `${counts}${result.detail}`, pending: result.rebuilt.length > 0 || (result.incoming ?? 0) > 0 }
  return { ok: true, text: `${counts}${result.restartNeeded ? `${result.detail} · restart DSH on this host to load it` : result.detail}`, pending: false }
}

type RowState = 'busy' | 'failed' | 'pending' | 'done'

const rowStateOf = (input: { readonly busy: boolean; readonly failed: boolean; readonly pending: boolean }): RowState => {
  if (input.busy) return 'busy'
  if (input.failed) return 'failed'
  if (input.pending) return 'pending'
  return 'done'
}

const statusTextOf = (input: { readonly updating: boolean; readonly checking: boolean; readonly text: string }): string => {
  if (input.updating) return 'Updating: fetching, rebasing and rebuilding…'
  if (input.checking) return 'Checking…'
  return input.text
}

const failureOf = (input: {
  readonly update: { readonly isError: boolean; readonly error: unknown }
  readonly check: { readonly isError: boolean; readonly error: unknown }
}): string | undefined => {
  if (input.update.isError) return errorMessage(input.update.error, 'The update failed.')
  if (input.check.isError) return errorMessage(input.check.error, 'The check failed.')
  return undefined
}

const RowAction = (props: { readonly state: RowState; readonly onRetry: () => void }) => {
  switch (props.state) {
    case 'busy':
      return <Spinner className="dshx:size-4" />
    case 'failed':
      return (
        <Button size="sm" variant="outline" className="dshx:h-7" onClick={props.onRetry}>
          <RotateCwIcon className="dshx:size-3.5" />
          Retry
        </Button>
      )
    case 'pending':
      return <TriangleAlertIcon className="dshx:size-4 dshx:text-warning" aria-label="Update available" />
    case 'done':
      return <CheckIcon className="dshx:size-4 dshx:text-success" aria-label="Up to date" />
  }
}

const FleetUpdateRow = (props: { readonly api: MultiHostClient; readonly host: HostSummary; readonly updateRequest: number }) => {
  const { api, host } = props
  const check = useQuery({
    queryKey: ['multi-host', 'fleet-update', host.id],
    queryFn: ({ signal }) => api.hostUpdate({ hostId: host.id, apply: false }, { signal }),
    staleTime: 60_000,
    retry: false,
  })
  const update = useMutation({ mutationFn: () => api.hostUpdate({ hostId: host.id, apply: true }) })
  const handled = useRef(props.updateRequest)
  const checked = check.data === undefined ? undefined : outcomeOf(check.data)
  useEffect(() => {
    if (props.updateRequest === handled.current || checked?.pending !== true || update.isPending) return
    handled.current = props.updateRequest
    update.mutate()
  }, [props.updateRequest, checked?.pending, update])

  const shown = update.data !== undefined ? outcomeOf(update.data) : checked
  const failure = failureOf({ update, check })
  const state = rowStateOf({
    busy: check.isFetching || update.isPending,
    failed: failure !== undefined || shown?.ok === false,
    pending: shown?.pending === true,
  })
  const statusText = statusTextOf({ updating: update.isPending, checking: check.isFetching, text: failure ?? shown?.text ?? '' })
  const retry = (): void => {
    if (update.isError || update.data !== undefined) {
      update.mutate()
      return
    }
    void check.refetch()
  }
  return (
    <li data-testid={`fleet-update-${host.id}`} className="dshx:flex dshx:items-start dshx:gap-2 dshx:rounded-lg dshx:border dshx:p-3">
      <ServerIcon className="dshx:mt-0.5 dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" />
      <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-0.5">
        <span className="dshx:truncate dshx:font-medium">{host.name}</span>
        <span role="status" className={state === 'failed' ? 'dshx:text-xs dshx:text-destructive' : 'dshx:text-xs dshx:text-muted-foreground'}>
          {statusText}
        </span>
      </div>
      <RowAction state={state} onRetry={retry} />
    </li>
  )
}

/**
 * Bring every visible SSH host's dshfiles checkout onto main from origin: each host fetches, then its own
 * `dshx checkout sync` rebases, installs and rebuilds. A host is never restarted from here; the row says when it needs one.
 */
export const FleetUpdateDialog = (props: {
  readonly api: MultiHostClient
  readonly hosts: readonly HostSummary[]
  readonly open: boolean
  readonly updateRequest: number
  readonly onUpdateAll: () => void
  readonly onOpenChange: (open: boolean) => void
}) => {
  const hosts = props.hosts.filter(host => !host.hidden && host.connector.kind === 'ssh')
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent aria-describedby={undefined} className="dshx-root dshx:max-h-[calc(100dvh-2rem)] dshx:overflow-y-auto dshx:sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Update hosts</DialogTitle>
        </DialogHeader>
        {hosts.length === 0 ? (
          <p className="dshx:text-sm dshx:text-muted-foreground">No visible SSH host to update. Add one, or show a hidden host on the Hosts page.</p>
        ) : (
          <ul className="dshx:flex dshx:flex-col dshx:gap-2" aria-label="Hosts to update">
            {hosts.map(host => (
              <FleetUpdateRow key={host.id} api={props.api} host={host} updateRequest={props.updateRequest} />
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
            Close
          </Button>
          <Button type="button" disabled={hosts.length === 0} onClick={props.onUpdateAll}>
            Update all
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
