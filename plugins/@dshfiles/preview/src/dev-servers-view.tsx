import type { ProcessPageViewProps, ProcessThreadViewProps } from '@dshfiles/background-jobs/process-views'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { useApi } from '@dshfiles/dshx/client'
import { EntityList, EntityRow } from '@dshfiles/plugin-ui/components/entity-row'
import { EmptyState, PageSection } from '@dshfiles/plugin-ui/components/page'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ExternalLinkIcon, PanelRightIcon, SquareIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, queryOptions, useMutation, useQueries, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'
import { previewApi, type DevServerView } from './api.js'
import { DevServerPoll } from './dev-server-poll.js'
import { PreviewOpener } from './preview-opener.js'

/**
 * Dev servers in Observe › Processes and in the thread panel's Jobs facet (plans/ade-ux §6 "Processes in 3 boards").
 * The thread header chip stays the quick view; these list the same `devServers` reads with the same Open and Stop.
 */
const ServerRows = (props: { readonly sessionId: string; readonly servers: readonly DevServerView[] }): JSX.Element => {
  const api = useApi(previewApi)
  const opener = PreviewOpener.use()
  const OpenIcon = opener.paneAvailable ? PanelRightIcon : ExternalLinkIcon
  const queryClient = useQueryClient()
  const [armed, setArmed] = useState<number | null>(null)
  const stop = useMutation({
    mutationFn: (server: DevServerView) => api.stopDevServer({ sessionId: props.sessionId, pid: server.pid, startedAt: server.startedAt, confirm: true }),
    onSettled: () => {
      setArmed(null)
      void queryClient.invalidateQueries({ queryKey: DevServerPoll.serversKey(props.sessionId) })
    },
  })
  return (
    <>
      <EntityList>
        {props.servers.map(server => (
          <EntityRow
            key={server.pid}
            heading={<span className="dshx:font-mono! dshx:text-xs">{`${server.ports.map(port => `:${String(port.port)}`).join(' ')} ${server.name}`}</span>}
            description={<span className="dshx:font-mono! dshx:text-xs">{server.command}</span>}
            trailing={
              <span className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1">
                {server.ports[0] === undefined ? null : (
                  <Button variant="outline" size="xs" onClick={() => opener.open(server.ports[0]?.url ?? '')}>
                    <OpenIcon aria-hidden />
                    Open
                  </Button>
                )}
                <Button
                  variant={armed === server.pid ? 'destructive' : 'outline'}
                  size="xs"
                  disabled={stop.isPending}
                  onClick={() => (armed === server.pid ? stop.mutate(server) : setArmed(server.pid))}
                >
                  <SquareIcon aria-hidden />
                  {armed === server.pid ? 'Confirm stop' : 'Stop'}
                </Button>
              </span>
            }
          />
        ))}
      </EntityList>
      {stop.isError ? (
        <p className="dshx:text-xs dshx:text-destructive">{errorMessage(stop.error, 'Stopping failed.')} Refresh the list and try again.</p>
      ) : null}
    </>
  )
}

const usePreviewApi = () => useApi(previewApi)
type PreviewClient = ReturnType<typeof usePreviewApi>

const serversQuery = (api: PreviewClient, sessionId: string) =>
  queryOptions({
    queryKey: DevServerPoll.serversKey(sessionId),
    queryFn: ({ signal }) => api.devServers({ sessionId }, { signal }),
    refetchInterval: query => DevServerPoll.serversIntervalMs({ ownerMissing: query.state.error !== null && isApiOwnerMissing(query.state.error) }),
    retry: false,
  })

/** Threads that serve at least one port, in the order asked, with their servers. */
const threadsWithServers = (
  threadIds: readonly string[],
  servers: readonly (readonly DevServerView[] | undefined)[],
): readonly { readonly sessionId: string; readonly servers: readonly DevServerView[] }[] =>
  threadIds.flatMap((sessionId, index) => {
    const listed = servers[index] ?? []
    return listed.length === 0 ? [] : [{ sessionId, servers: listed }]
  })

/** Observe › Processes › Dev servers: every thread that runs a job, and the ports its processes listen on. */
const DevServersTab = (props: ProcessPageViewProps): JSX.Element => {
  const api = usePreviewApi()
  const results = useQueries({ queries: props.threadIds.map(sessionId => serversQuery(api, sessionId)) })
  const threads = threadsWithServers(
    props.threadIds,
    results.map(result => result.data?.servers),
  )
  const loading = results.some(result => result.isPending)
  const failed = results.find(result => result.isError && !isApiOwnerMissing(result.error))
  return (
    <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-4" data-process-view="dev-servers">
      <PageSection heading="Dev servers" description="Ports your threads' processes listen on. Open one beside its thread, or stop it." />
      {failed === undefined ? null : (
        <p className="dshx:text-xs dshx:text-destructive">{errorMessage(failed.error, 'Dev servers could not be read.')} Try again in a moment.</p>
      )}
      {threads.length === 0 ? (
        <EmptyState className="dshx:rounded-lg dshx:border dshx:border-border">
          {loading ? 'Looking for dev servers…' : 'No thread is serving a port. Ask an agent to start a dev server and it shows here.'}
        </EmptyState>
      ) : (
        threads.map(thread => (
          <PageSection
            key={thread.sessionId}
            heading={props.threadLabel(thread.sessionId)}
            meta={thread.servers.length}
            actions={
              <Button variant="ghost" size="sm" onClick={() => props.openThread(thread.sessionId)}>
                Open thread
              </Button>
            }
          >
            <ServerRows sessionId={thread.sessionId} servers={thread.servers} />
          </PageSection>
        ))
      )}
    </div>
  )
}

/** The Jobs facet's dev-server part: this thread's ports, or one line when it serves none. */
const ThreadDevServers = (props: ProcessThreadViewProps): JSX.Element => {
  const api = usePreviewApi()
  const query = useQuery(serversQuery(api, props.sessionId))
  const servers = query.data?.servers ?? []
  return (
    <PageSection heading="Dev servers" meta={servers.length === 0 ? undefined : servers.length}>
      {servers.length === 0 ? (
        <p className="dshx:text-xs dshx:text-muted-foreground">{query.isPending ? 'Looking for dev servers…' : 'This thread serves no port.'}</p>
      ) : (
        <ServerRows sessionId={props.sessionId} servers={servers} />
      )}
    </PageSection>
  )
}

export class DevServerViews {
  static readonly Tab = DevServersTab
  static readonly Thread = ThreadDevServers
  static readonly threadsWithServers = threadsWithServers
}
