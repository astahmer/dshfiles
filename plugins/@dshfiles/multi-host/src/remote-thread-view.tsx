import { useApi } from '@dshfiles/dshx/client'
import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { ServerIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useQueries, useQuery } from '@dshfiles/plugin-ui/query'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { multiHostApi } from './api.js'
import { multiHostKeys, multiHostQueries } from './destination/queries.js'
import { mergeInventory, type InventoryRow, type InventoryStatus } from './inventory.js'

const folderName = (path: string | undefined): string | undefined => path?.split(/[\\/]/).filter(Boolean).at(-1)
const rowLabel = (row: InventoryRow): string => row.title ?? folderName(row.cwd) ?? row.sessionId
const ageSuffix = { minutes: 'm', hours: 'h', days: 'd', months: 'mo', years: 'y' } as const
const age = (updatedAt: number, now: number): string => {
  const time = relativeTime(updatedAt, now)
  return time.unit === 'now' ? 'now' : `${String(time.n)}${ageSuffix[time.unit]}`
}

/**
 * Every thread on every registered host, grouped by host. A row opens the Session in this client's own chat and
 * composer: the Host mirrors the remote Session, so this panel is a list, not a second conversation viewer.
 */
export const RemoteThreadView = (props: { readonly onOpenSession: (sessionId: SessionId) => void }) => {
  const api = useApi(multiHostApi)
  const threads = useQuery({ queryKey: multiHostKeys.threads, queryFn: ({ signal }) => api.threadList(undefined, { signal }), refetchInterval: 30_000 })
  const directory = useQuery(multiHostQueries.directory(api))
  const runtimes = directory.data?.runtimes ?? []
  const hosts = directory.data?.hosts ?? []
  const hostNameFor = (runtimeId: string, fallback: string): string =>
    hosts.find(host => host.id === (runtimes.find(runtime => runtime.id === runtimeId)?.hostId ?? ''))?.name ?? fallback
  const statuses = useQueries({ queries: runtimes.map(runtime => multiHostQueries.status(api, runtime.id, 60_000)) })
  const inventoryStatuses: readonly InventoryStatus[] = statuses.flatMap((result, index) => {
    const runtime = runtimes[index]
    if (runtime === undefined || result.data === undefined) return []
    return [{ runtimeId: runtime.id, hostName: hostNameFor(runtime.id, runtime.name), status: result.data }]
  })
  const unavailable = statuses.flatMap((result, index) => {
    const runtime = runtimes[index]
    if (runtime === undefined) return []
    const message =
      result.data !== undefined
        ? result.data.ok
          ? undefined
          : result.data.message
        : result.isError
          ? errorMessage(result.error, 'The host did not answer.')
          : undefined
    return message === undefined ? [] : [{ runtimeId: runtime.id, hostName: hostNameFor(runtime.id, runtime.name), message }]
  })
  const inventory = mergeInventory({ startedHere: threads.data?.threads ?? [], statuses: inventoryStatuses })
  const grouped = new Map<string, InventoryRow[]>()
  for (const row of inventory) grouped.set(row.hostName, [...(grouped.get(row.hostName) ?? []), row])

  return (
    <div className="dshx-root dshx:@container dshx:flex dshx:h-full dshx:flex-col dshx:gap-4 dshx:overflow-auto dshx:p-6" data-remote-thread-inventory="">
      <h2 className="dshx:text-sm dshx:font-semibold">Remote threads</h2>
      {unavailable.map(host => (
        <p key={host.runtimeId} className="dshx:text-xs dshx:text-muted-foreground">
          {host.hostName} unavailable: {host.message}
        </p>
      ))}
      {inventory.length === 0 && unavailable.length === 0 ? (
        <p className="dshx:text-sm dshx:text-muted-foreground">Pick a host in the New thread bar and send a message to start one.</p>
      ) : null}
      {[...grouped].map(([hostName, rows]) => (
        <section key={hostName} aria-label={`Threads on ${hostName}`} className="dshx:flex dshx:flex-col dshx:gap-1">
          <h3 className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:px-1 dshx:text-xs dshx:font-medium dshx:text-muted-foreground">
            <ServerIcon className="dshx:size-3" />
            {hostName}
          </h3>
          {rows.map(row => (
            <button
              key={row.runtimeId + '\u0000' + row.sessionId}
              type="button"
              title={row.cwd ?? row.sessionId}
              className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:rounded-md dshx:border dshx:p-2 dshx:text-left dshx:text-sm dshx:hover:bg-accent"
              onClick={() => props.onOpenSession(row.sessionId as SessionId)}
            >
              <ServerIcon className="dshx:size-3.5 dshx:shrink-0" />
              <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
                <span className="dshx:truncate">{rowLabel(row)}</span>
                {row.cwd === undefined || row.title === undefined ? null : (
                  <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">{row.cwd}</span>
                )}
              </span>
              {row.startedHere ? null : (
                <Badge variant="secondary" className="dshx:shrink-0 dshx:font-normal dshx:text-muted-foreground dshx:@max-pane-compact:hidden">
                  started on host
                </Badge>
              )}
              {row.running ? (
                <Badge variant="outline" className="dshx:shrink-0 dshx:gap-1">
                  <Spinner className="dshx:size-3" />
                  Working
                </Badge>
              ) : null}
              <span className="dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground">{age(row.updatedAt, Date.now())}</span>
            </button>
          ))}
        </section>
      ))}
    </div>
  )
}
