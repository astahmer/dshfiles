import { useApi } from '@dshfiles/dshx/client'
import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import { EmptyState, Page, PageSection } from '@dshfiles/plugin-ui/components/page'
import { EntityList, EntityRow } from '@dshfiles/plugin-ui/components/entity-row'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
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
 * composer: the Host mirrors the remote Session, so this panel is a list, not a second thread viewer.
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
    return message === undefined
      ? []
      : [{ runtimeId: runtime.id, hostName: hostNameFor(runtime.id, runtime.name), message, retry: () => void result.refetch() }]
  })
  const inventory = mergeInventory({ startedHere: threads.data?.threads ?? [], statuses: inventoryStatuses })
  const grouped = new Map<string, InventoryRow[]>()
  for (const row of inventory) grouped.set(row.hostName, [...(grouped.get(row.hostName) ?? []), row])

  return (
    <Page
      scroll
      data-remote-thread-inventory=""
      heading="Remote threads"
      description="Threads on every registered host. Open one to continue it in this window."
      count={inventory.length}
    >
      {unavailable.map(host => (
        <p key={host.runtimeId} role="alert" className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-destructive">
          <span className="dshx:min-w-0">
            {host.hostName} is unavailable: {host.message}
          </span>
          <Button size="xs" variant="outline" onClick={host.retry}>
            Try again
          </Button>
        </p>
      ))}
      {inventory.length === 0 && unavailable.length === 0 ? (
        <EntityList>
          <EmptyState>No remote threads yet. Pick a host in the New thread bar and send a message to start one.</EmptyState>
        </EntityList>
      ) : null}
      {[...grouped].map(([hostName, rows]) => (
        <PageSection key={hostName} heading={hostName} meta={rows.length} aria-label={`Threads on ${hostName}`}>
          <EntityList>
            {rows.map(row => (
              <EntityRow
                key={row.runtimeId + '\u0000' + row.sessionId}
                role="listitem"
                status={row.running ? 'working' : 'idle'}
                heading={rowLabel(row)}
                meta={
                  <>
                    {row.title === undefined ? null : <span className="dshx:min-w-0 dshx:truncate">{folderName(row.cwd)}</span>}
                    {row.startedHere ? null : <span className="dshx:@max-pane-compact:hidden">started on host</span>}
                    <span className="dshx:tabular-nums">{age(row.updatedAt, Date.now())}</span>
                  </>
                }
                onSelect={() => props.onOpenSession(row.sessionId as SessionId)}
              />
            ))}
          </EntityList>
        </PageSection>
      ))}
    </Page>
  )
}
