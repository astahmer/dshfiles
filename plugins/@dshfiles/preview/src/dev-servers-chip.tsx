import { useEffect, useMemo, useState } from 'react'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { Browser, useApi, useApiEvent, useContract } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { ExternalLinkIcon, GlobeIcon, PanelRightIcon, SquareIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { previewApi, type DevServerView, type PreviewPageView } from './api.js'
import { DevServerPoll } from './dev-server-poll.js'
import { PreviewOpener } from './preview-opener.js'

const revealed = new Set<string>()

const portLabel = (servers: readonly DevServerView[], pages: readonly PreviewPageView[]): string => {
  const ports = servers.flatMap(server => server.ports.map(port => port.port))
  if (ports.length === 1) return `:${String(ports[0])}`
  if (ports.length > 1) return `${String(ports.length)} ports`
  return pages.length === 1 ? '1 preview' : `${String(pages.length)} previews`
}

export const DevServersChip = (props: { readonly sessionId: string }) => {
  const api = useApi(previewApi)
  const browser = useContract(Browser)
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [armed, setArmed] = useState<number | null>(null)
  const key = useMemo(() => DevServerPoll.serversKey(props.sessionId), [props.sessionId])
  const pagesKey = useMemo(() => DevServerPoll.pagesKey(props.sessionId), [props.sessionId])
  const opener = PreviewOpener.use()
  const OpenIcon = opener.paneAvailable ? PanelRightIcon : ExternalLinkIcon
  // An agent's reveal is not a click, so a new tab would be blocked: it only goes to the pane.
  const revealInPane = (url: string): void => {
    if (browser.status === 'active') browser.value.open(url)
  }

  const events = useApiEvent(previewApi, 'pagesChanged', payload => {
    if (payload.sessionId !== props.sessionId) return
    void queryClient.invalidateQueries({ queryKey: pagesKey })
    const reveal = payload.reveal
    if (reveal === null) return
    const id = `${props.sessionId}:${reveal.pageId}:${String(reveal.requestedAt)}`
    if (revealed.has(id)) return
    revealed.add(id)
    revealInPane(reveal.url)
  })
  useEffect(() => {
    if (events === 'live') {
      void queryClient.invalidateQueries({ queryKey: key })
      void queryClient.invalidateQueries({ queryKey: pagesKey })
    }
  }, [events, queryClient, key, pagesKey])

  // A port a thread starts is not pushed, so this one polls. Pages are: `pagesChanged` invalidates them below,
  // and polling them as well doubled every round of an otherwise event-driven read.
  const serversQuery = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.devServers({ sessionId: props.sessionId }, { signal }),
    refetchInterval: query => DevServerPoll.serversIntervalMs({ ownerMissing: query.state.error !== null && isApiOwnerMissing(query.state.error) }),
    retry: false,
  })
  const pagesQuery = useQuery({
    queryKey: pagesKey,
    queryFn: ({ signal }) => api.list({ sessionId: props.sessionId }, { signal }),
    refetchInterval: DevServerPoll.pagesIntervalMs,
    retry: false,
  })

  const stop = useMutation({
    mutationFn: (server: DevServerView) => api.stopDevServer({ sessionId: props.sessionId, pid: server.pid, startedAt: server.startedAt, confirm: true }),
    onSettled: () => {
      setArmed(null)
      void queryClient.invalidateQueries({ queryKey: key })
    },
  })

  const servers = serversQuery.data?.servers ?? []
  const pages = pagesQuery.data?.pages ?? []
  if (servers.length === 0 && pages.length === 0) return null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="dshx-root dshx:h-6 dshx:gap-1 dshx:px-1.5 dshx:font-mono! dshx:text-xs"
          aria-label="Dev servers and previews"
        >
          <GlobeIcon className="dshx:size-3.5" />
          {portLabel(servers, pages)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="dshx-root dshx:w-96 dshx:max-w-[90vw] dshx:p-2">
        <section aria-label="Dev servers" className="dshx:flex dshx:flex-col dshx:gap-1">
          {servers.map(server => (
            <div key={server.pid} className="dshx:flex dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-1 dshx:py-1 dshx:hover:bg-accent">
              <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
                <span className="dshx:truncate dshx:font-mono dshx:text-xs">
                  {server.ports.map(port => `:${String(port.port)}`).join(' ')} {server.name}
                </span>
                <span className="dshx:truncate dshx:text-muted-foreground dshx:text-xs">{server.command}</span>
              </div>
              {server.ports[0] === undefined ? null : (
                <Button variant="outline" size="sm" className="dshx:h-6 dshx:px-2 dshx:text-xs" onClick={() => opener.open(server.ports[0]?.url ?? '')}>
                  <OpenIcon className="dshx:size-3" />
                  Open
                </Button>
              )}
              <Button
                variant={armed === server.pid ? 'destructive' : 'outline'}
                size="sm"
                className="dshx:h-6 dshx:px-2 dshx:text-xs"
                disabled={stop.isPending}
                onClick={() => (armed === server.pid ? stop.mutate(server) : setArmed(server.pid))}
              >
                <SquareIcon className="dshx:size-3" />
                {armed === server.pid ? 'Confirm stop' : 'Stop'}
              </Button>
            </div>
          ))}
          {pages.map(page => (
            <div key={page.pageId} className={cn('dshx:flex dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-1 dshx:py-1 dshx:hover:bg-accent')}>
              <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
                <span className="dshx:truncate dshx:text-xs">{page.title === '' ? page.url : page.title}</span>
                <span className="dshx:truncate dshx:font-mono dshx:text-muted-foreground dshx:text-xs">
                  {page.pageId} · {page.url}
                </span>
              </div>
              <Button variant="outline" size="sm" className="dshx:h-6 dshx:px-2 dshx:text-xs" onClick={() => opener.open(page.url)}>
                <OpenIcon className="dshx:size-3" />
                Open
              </Button>
            </div>
          ))}
          {stop.isError ? (
            <p className="dshx:px-1 dshx:text-destructive dshx:text-xs">{errorMessage(stop.error, 'Stopping failed.')} Refresh the list and try again.</p>
          ) : null}
        </section>
      </PopoverContent>
    </Popover>
  )
}
