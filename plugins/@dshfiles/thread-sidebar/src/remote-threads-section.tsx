import { useApi } from '@dshfiles/dshx/client'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { ServerIcon } from '@dshfiles/plugin-ui/icons'
import { PluginQueryProvider, useQuery } from '@dshfiles/plugin-ui/query'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { multiHostApi, multiHostKeys, openRemoteThreadRef, RemoteThreadSelection } from '@dshfiles/multi-host/destination'

/**
 * Threads started on other hosts, with their host as a badge. They are Sessions of another runtime, so they live in
 * their own section and open in the remote thread view. Nothing renders when multi-host is not installed.
 */
export const RemoteThreadsSection = (props: { readonly headerClassName: string; readonly onOpen: () => void }) => (
  <PluginQueryProvider>
    <RemoteThreadRows {...props} />
  </PluginQueryProvider>
)

const RemoteThreadRows = (props: { readonly headerClassName: string; readonly onOpen: () => void }) => {
  const api = useApi(multiHostApi)
  const threads = useQuery({
    queryKey: multiHostKeys.threads,
    queryFn: ({ signal }) => api.threadList(undefined, { signal }),
    refetchInterval: query => (isApiOwnerMissing(query.state.error) ? false : 15_000),
    retry: false,
  })
  const open = openRemoteThreadRef.useValue()
  const rows = [...(threads.data?.threads ?? [])].reverse()
  if (rows.length === 0) return null
  return (
    <section className="dshx:mt-1" aria-label="Remote threads" data-remote-threads="">
      <button
        type="button"
        aria-label="All remote threads, including ones started on a host"
        title="Every thread on every host, including ones started there"
        className={cn(
          props.headerClassName,
          'dshx:flex dshx:h-8 dshx:w-full dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-2.5 dshx:text-left dshx:text-sm dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-accent dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50',
        )}
        onClick={() => {
          RemoteThreadSelection.clear()
          props.onOpen()
        }}
      >
        <ServerIcon className="dshx:size-3" aria-hidden />
        <span className="dshx:whitespace-nowrap">Remote</span>
        <span className="dshx:text-xs dshx:tabular-nums">({rows.length})</span>
        <span className="dshx:h-px dshx:flex-1 dshx:bg-border" aria-hidden="true" />
      </button>
      {rows.map(thread => {
        const active = open?.runtimeId === thread.runtimeId && open.sessionId === thread.sessionId
        return (
          <button
            key={thread.runtimeId + thread.sessionId}
            type="button"
            title={`${thread.title}\n${thread.hostName}: ${thread.cwd}`}
            className={cn(
              'dshx:flex dshx:h-8 dshx:w-full dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-2.5 dshx:text-left dshx:text-sm dshx:outline-none dshx:hover:bg-accent dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50',
              active && 'dshx:bg-accent',
            )}
            onClick={() => {
              RemoteThreadSelection.open({ runtimeId: thread.runtimeId, sessionId: thread.sessionId })
              props.onOpen()
            }}
          >
            <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{thread.title}</span>
            <span className="dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:rounded-sm dshx:border dshx:px-1 dshx:text-[11px] dshx:text-muted-foreground">
              <span className={cn('dshx:size-1.5 dshx:rounded-full', thread.connected ? 'dshx:bg-emerald-500' : 'dshx:bg-muted-foreground/50')} aria-hidden />
              {thread.hostName}
            </span>
          </button>
        )
      })}
    </section>
  )
}
