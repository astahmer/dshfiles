import { useEffect, useMemo, useState } from 'react'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { Browser, useApi, useApiEvent, useContract, useSettings } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { ExternalLinkIcon, GlobeIcon, MonitorIcon, PanelRightIcon, SquareIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import * as Schema from 'effect/Schema'
import { previewApi, type DevServerView, type PreviewPageView } from './api.js'
import { DevServerPoll } from './dev-server-poll.js'
import { PreviewOpener } from './preview-opener.js'
import { LoopbackNoticeView } from './loopback-notice.js'
import type { ListeningPort } from './remote-reach.js'
import { PreviewReveal, type RevealRequest } from './preview-reveal.js'
import { previewSettings } from './settings.js'

const HANDLED_LIMIT = 100
const REVEAL_RETRY_MS = 1_000
const REVEAL_RETRIES = 20

/** Reveals shown and dev servers previewed or dismissed in this browser, so a reload does not repeat them. */
const storedHandled = createStoredValue({ key: 'dshfiles-preview:handled', schema: Schema.Array(Schema.String), fallback: [] })

/** Whether only the Host can load this URL, as read from the GUI page this bundle runs in. */
const hostOnly = (url: string): boolean => PreviewOpener.hostOnly({ guiHostname: window.location.hostname, url })

const OpenGlyph = (props: { readonly url: string; readonly paneAvailable: boolean }): JSX.Element => {
  if (hostOnly(props.url)) return <MonitorIcon className="dshx:size-3" />
  return props.paneAvailable ? <PanelRightIcon className="dshx:size-3" /> : <ExternalLinkIcon className="dshx:size-3" />
}

const recordHandled = (key: string): void => {
  storedHandled.set([...storedHandled.get().filter(entry => entry !== key), key].slice(-HANDLED_LIMIT))
}

const portLabel = (servers: readonly DevServerView[], pages: readonly PreviewPageView[]): string => {
  const ports = servers.flatMap(server => server.ports.map(port => port.port))
  if (ports.length === 1) return `:${String(ports[0])}`
  if (ports.length > 1) return `${String(ports.length)} ports`
  return pages.length === 1 ? '1 preview' : `${String(pages.length)} previews`
}

export const DevServersChip = (props: {
  readonly sessionId: string
  /** Whether this thread is the one on screen, the only one whose pane a reveal may open. */
  readonly onScreen: boolean
  /** Show the agent's own page, live, in the thread panel; false when no panel is on screen to take it. */
  readonly onWatch: (input: { readonly sessionId: string; readonly pageId: string }) => boolean
}) => {
  const api = useApi(previewApi)
  const browser = useContract(Browser)
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [armed, setArmed] = useState<number | null>(null)
  const [pushed, setPushed] = useState<RevealRequest | null>(null)
  const [retry, setRetry] = useState(0)
  const handledList = storedHandled.useValue()
  const handled = useMemo(() => new Set(handledList), [handledList])
  // An older Host lacks the field, and a missing namespace reads as undefined: both keep auto-open off.
  const autoOpen = useSettings(previewSettings).value?.autoOpenDevServers === true
  const key = useMemo(() => DevServerPoll.serversKey(props.sessionId), [props.sessionId])
  const pagesKey = useMemo(() => DevServerPoll.pagesKey(props.sessionId), [props.sessionId])
  const opener = PreviewOpener.use()

  const events = useApiEvent(previewApi, 'pagesChanged', payload => {
    if (payload.sessionId !== props.sessionId) return
    void queryClient.invalidateQueries({ queryKey: pagesKey })
    if (payload.reveal === null) return
    setPushed(payload.reveal)
    setRetry(0)
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

  const pagesData = pagesQuery.data
  const onWatch = props.onWatch
  const pane = browser.status === 'active' ? browser.value : undefined
  useEffect(() => {
    const result = PreviewReveal.attempt({
      sessionId: props.sessionId,
      pushed,
      pages: pagesData?.pages ?? [],
      shown: handled,
      onScreen: props.onScreen,
      // An agent's reveal is not a click, so a new tab would be blocked: it only goes to the pane, or to the mirror of
      // its page when the pane would load the viewer's machine.
      open: request => (hostOnly(request.url) ? onWatch({ sessionId: props.sessionId, pageId: request.pageId }) : pane?.open(request.url) === true),
    })
    if (result.shown !== undefined) recordHandled(result.shown)
    if (!result.retry || retry >= REVEAL_RETRIES) return
    const timer = setTimeout(() => setRetry(count => count + 1), REVEAL_RETRY_MS)
    return () => clearTimeout(timer)
  }, [props.sessionId, props.onScreen, onWatch, pushed, pagesData, handled, retry, pane, opener.paneAvailable])

  const offer = PreviewReveal.offer({ sessionId: props.sessionId, servers: serversQuery.data?.servers ?? [], handled })
  const offerKey = offer?.key
  const offerUrl = offer?.url
  useEffect(() => {
    if (offerKey === undefined || offerUrl === undefined || !autoOpen || !props.onScreen || hostOnly(offerUrl)) return
    if (pane?.open(offerUrl) === true) recordHandled(offerKey)
  }, [offerKey, offerUrl, autoOpen, props.onScreen, pane, opener.paneAvailable])

  const stop = useMutation({
    mutationFn: (server: DevServerView) => api.stopDevServer({ sessionId: props.sessionId, pid: server.pid, startedAt: server.startedAt, confirm: true }),
    onSettled: () => {
      setArmed(null)
      void queryClient.invalidateQueries({ queryKey: key })
    },
  })

  // A GUI on another machine cannot load the Host's loopback, so the Host loads it in a preview page and the mirror shows it.
  const watchUrl = useMutation({
    mutationFn: (url: string) => api.open({ sessionId: props.sessionId, url }),
    onSuccess: page => {
      setOpen(false)
      props.onWatch({ sessionId: props.sessionId, pageId: page.pageId })
    },
    onError: () => setOpen(true),
  })
  // dshfiles: a loopback port the viewer can still reach (bound to every interface) opens as a real tab; only when it
  // is loopback-only does the Host load it in a preview page instead of showing the loopback notice.
  const watchInstead = (url: string): void => {
    opener.dismissNotice()
    watchUrl.mutate(url)
  }
  const openUrl = (url: string, ports: readonly ListeningPort[] = []): void => {
    if (opener.open(url, ports) === null && hostOnly(url)) watchInstead(url)
  }
  const openPort = (port: ListeningPort): void => {
    if (opener.openPort(port) === null && hostOnly(port.url)) watchInstead(port.url)
  }

  const servers = serversQuery.data?.servers ?? []
  const pages = pagesQuery.data?.pages ?? []
  if (servers.length === 0 && pages.length === 0) return null

  const popover = (
    <Popover
      open={open}
      onOpenChange={next => {
        // Pages refresh only on `pagesChanged`; opening the list re-reads both, so a missed event never hides a page.
        if (next) {
          void queryClient.invalidateQueries({ queryKey: pagesKey })
          void queryClient.invalidateQueries({ queryKey: key })
        }
        setOpen(next)
      }}
    >
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
        <LoopbackNoticeView notice={opener.notice} onDismiss={opener.dismissNotice} />
        <section aria-label="Dev servers" className="dshx:flex dshx:flex-col dshx:gap-1">
          {servers.map(server => (
            <div key={server.pid} className="dshx:flex dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-1 dshx:py-1 dshx:hover:bg-accent">
              <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
                <span className="dshx:truncate dshx:font-mono dshx:text-xs">
                  {server.ports.map(port => `:${String(port.port)}`).join(' ')} {server.name}
                </span>
                <span className="dshx:truncate dshx:text-muted-foreground dshx:text-xs">{server.command}</span>
              </div>
              {server.ports.slice(0, 1).map(port => {
                return (
                  <Button
                    key={port.url}
                    variant="outline"
                    size="sm"
                    className="dshx:h-6 dshx:px-2 dshx:text-xs"
                    disabled={watchUrl.isPending}
                    onClick={() => {
                      recordHandled(PreviewReveal.serverKey({ sessionId: props.sessionId, server }))
                      openPort(port)
                    }}
                  >
                    <OpenGlyph url={port.url} paneAvailable={opener.paneAvailable} />
                    Open
                  </Button>
                )
              })}
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
              <Button
                variant="outline"
                size="sm"
                className="dshx:h-6 dshx:px-2 dshx:text-xs"
                onClick={() => {
                  setOpen(false)
                  props.onWatch({ sessionId: props.sessionId, pageId: page.pageId })
                }}
              >
                <MonitorIcon className="dshx:size-3" />
                Watch
              </Button>
              {hostOnly(page.url) ? null : (
                <Button
                  variant="outline"
                  size="sm"
                  className="dshx:h-6 dshx:px-2 dshx:text-xs"
                  onClick={() =>
                    opener.open(
                      page.url,
                      servers.flatMap(server => server.ports),
                    )
                  }
                >
                  <OpenGlyph url={page.url} paneAvailable={opener.paneAvailable} />
                  Open
                </Button>
              )}
            </div>
          ))}
          {stop.isError ? (
            <p className="dshx:px-1 dshx:text-destructive dshx:text-xs">{errorMessage(stop.error, 'Stopping failed.')} Refresh the list and try again.</p>
          ) : null}
          {watchUrl.isError ? (
            <p className="dshx:px-1 dshx:text-destructive dshx:text-xs">
              {errorMessage(watchUrl.error, 'The preview browser could not open this server.')} Check Settings › dshfiles-preview, or open it on the DSH
              machine.
            </p>
          ) : null}
        </section>
      </PopoverContent>
    </Popover>
  )
  if (offer === undefined || (autoOpen && !hostOnly(offer.url))) return popover
  return (
    <div className="dshx-root dshx:flex dshx:items-center dshx:gap-0.5">
      <Button
        variant="outline"
        size="sm"
        className="dshx:h-6 dshx:gap-1 dshx:px-1.5 dshx:text-xs"
        disabled={watchUrl.isPending}
        onClick={() => {
          recordHandled(offer.key)
          openUrl(offer.url)
        }}
      >
        <OpenGlyph url={offer.url} paneAvailable={opener.paneAvailable} />
        Preview
      </Button>
      <Button variant="ghost" size="icon" className="dshx:size-6" aria-label="Dismiss preview" onClick={() => recordHandled(offer.key)}>
        <XIcon className="dshx:size-3" />
      </Button>
      {popover}
    </div>
  )
}
