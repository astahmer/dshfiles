import { useEffect, useMemo, useState } from 'react'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { Browser, useApi, useApiEvent, useContract } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { ExternalLinkIcon, GlobeIcon, SquareIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { previewApi, type DevServerView, type PreviewPageView } from './api.js'

const POLL_MS = 10_000
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
  const key = useMemo(() => ['dshfiles-preview', props.sessionId] as const, [props.sessionId])
  const canOpen = browser.status === 'active' && browser.value.available.get()
  const openInTab = (url: string): void => {
    if (browser.status === 'active') browser.value.open(url)
  }

  const events = useApiEvent(previewApi, 'pagesChanged', payload => {
    if (payload.sessionId !== props.sessionId) return
    void queryClient.invalidateQueries({ queryKey: key })
    const reveal = payload.reveal
    if (reveal === null) return
    const id = `${props.sessionId}:${reveal.pageId}:${String(reveal.requestedAt)}`
    if (revealed.has(id)) return
    revealed.add(id)
    openInTab(reveal.url)
  })
  useEffect(() => {
    if (events === 'live') void queryClient.invalidateQueries({ queryKey: key })
  }, [events, queryClient, key])

  const state = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const [servers, pages] = await Promise.all([
        api.devServers({ sessionId: props.sessionId }, { signal }),
        api.list({ sessionId: props.sessionId }, { signal }),
      ])
      return { servers: servers.servers, pages: pages.pages }
    },
    refetchInterval: query => (query.state.error !== null && isApiOwnerMissing(query.state.error) ? false : POLL_MS),
    retry: false,
  })

  const stop = useMutation({
    mutationFn: (server: DevServerView) => api.stopDevServer({ sessionId: props.sessionId, pid: server.pid, startedAt: server.startedAt, confirm: true }),
    onSettled: () => {
      setArmed(null)
      void queryClient.invalidateQueries({ queryKey: key })
    },
  })

  const servers = state.data?.servers ?? []
  const pages = state.data?.pages ?? []
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
                <Button
                  variant="outline"
                  size="sm"
                  className="dshx:h-6 dshx:px-2 dshx:text-xs"
                  disabled={!canOpen}
                  onClick={() => openInTab(server.ports[0]?.url ?? '')}
                >
                  <ExternalLinkIcon className="dshx:size-3" />
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
              <Button variant="outline" size="sm" className="dshx:h-6 dshx:px-2 dshx:text-xs" disabled={!canOpen} onClick={() => openInTab(page.url)}>
                <ExternalLinkIcon className="dshx:size-3" />
                Open
              </Button>
            </div>
          ))}
          {stop.isError ? (
            <p className="dshx:px-1 dshx:text-destructive dshx:text-xs">{errorMessage(stop.error, 'Stopping failed.')} Refresh the list and try again.</p>
          ) : null}
          {canOpen ? null : <p className="dshx:px-1 dshx:text-muted-foreground dshx:text-xs">Open needs the browser tab of the thread on screen.</p>}
        </section>
      </PopoverContent>
    </Popover>
  )
}
