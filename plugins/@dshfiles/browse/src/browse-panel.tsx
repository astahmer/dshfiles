import { relativeTime, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { Alert, AlertDescription, AlertTitle } from '@dshfiles/plugin-ui/components/ui/alert'
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
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@dshfiles/plugin-ui/components/ui/card'
import { StatusDot } from '@dshfiles/plugin-ui/components/ui/status-dot'
import { CheckIcon, CopyIcon, GlobeIcon, HandIcon, Link2Icon, RefreshCwIcon, Unlink2Icon, XIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useState, type ReactNode } from 'react'
import type { BrowseStatus, BrowseTab, PairedBrowser, Pairing, Pairings } from './model.js'

/** What the panel needs from the Host; the client passes the dshx API calls. */
export interface BrowsePanelServices {
  readonly status: (signal: AbortSignal) => Promise<BrowseStatus>
  readonly pairings: (signal: AbortSignal) => Promise<Pairings>
  readonly startPairing: () => Promise<Pairing>
  readonly cancelPairing: () => Promise<Pairing>
  readonly revoke: (target: string) => Promise<{ readonly revoked: boolean; readonly message: string }>
}

export const BROWSE_QUERY_KEYS = { status: ['browse', 'status'] as const, pairings: ['browse', 'pairings'] as const }

/** While a code waits for its browser, read status at least every two seconds so the outcome shows promptly. */
const PENDING_POLL_MS = 2_000

const AGO_SUFFIX = { minutes: 'm ago', hours: 'h ago', days: 'd ago', months: 'mo ago', years: 'y ago' } as const
const ago = (at: number): string => {
  const age = relativeTime(at, Date.now())
  return age.unit === 'now' ? 'just now' : `${String(age.n)}${AGO_SUFFIX[age.unit]}`
}
const agoOf = (iso: string | null): string | null => {
  if (iso === null) return null
  const at = Date.parse(iso)
  return Number.isNaN(at) ? null : ago(at)
}

const touch = 'dshx:pointer-coarse:min-h-11'

const Section = (props: { readonly title: string; readonly description?: ReactNode; readonly action?: ReactNode; readonly children: ReactNode }) => (
  <Card className="dshx:gap-3 dshx:py-4">
    <CardHeader className="dshx:flex dshx:flex-row dshx:items-start dshx:justify-between dshx:gap-2 dshx:px-4">
      <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
        <CardTitle className="dshx:text-sm">{props.title}</CardTitle>
        {props.description === undefined ? null : <CardDescription className="dshx:text-xs">{props.description}</CardDescription>}
      </div>
      {props.action}
    </CardHeader>
    <CardContent className="dshx:flex dshx:flex-col dshx:gap-2 dshx:px-4">{props.children}</CardContent>
  </Card>
)

const Row = (props: { readonly label: string; readonly children: ReactNode }) => (
  <div className="dshx:flex dshx:min-w-0 dshx:items-baseline dshx:justify-between dshx:gap-3 dshx:text-sm">
    <span className="dshx:shrink-0 dshx:text-muted-foreground">{props.label}</span>
    <span className="dshx:min-w-0 dshx:truncate dshx:text-right">{props.children}</span>
  </div>
)

const RelaySection = (props: { readonly status: Extract<BrowseStatus, { kind: 'ready' }> }) => {
  const status = props.status
  const extensionLabel = status.extension.connected ? 'connected' : (status.extension.pairingState ?? 'unknown')
  return (
    <Section title="Relay and extension">
      <Row label="browse">{status.version ?? 'unknown version'}</Row>
      <Row label="Relay">
        <span className="dshx:inline-flex dshx:items-center dshx:gap-1.5">
          <StatusDot tone={status.relay.running ? 'success' : 'muted'} />
          {status.relay.running ? `running at ${status.relay.endpoint ?? '?'}` : 'not running'}
        </span>
      </Row>
      {status.relay.running ? (
        <Row label="Extension">
          <span className="dshx:inline-flex dshx:items-center dshx:gap-1.5">
            <StatusDot tone={status.extension.connected ? 'success' : 'warning'} />
            {extensionLabel}
          </span>
        </Row>
      ) : (
        <p className="dshx:text-xs dshx:text-muted-foreground">The relay starts by itself when an agent uses browse or when you pair a browser below.</p>
      )}
      {status.extension.nextStep === null ? null : <p className="dshx:text-xs dshx:text-muted-foreground">{status.extension.nextStep}</p>}
      {status.browsers.length === 0 ? null : (
        <ul className="dshx:flex dshx:flex-col dshx:gap-1" aria-label="Connected browsers">
          {status.browsers.map(browser => (
            <li key={browser.id} className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:text-sm">
              <StatusDot tone={browser.connected ? 'success' : 'muted'} />
              <span className="dshx:min-w-0 dshx:truncate">{browser.name}</span>
              {browser.isDefault ? <Badge variant="muted">default</Badge> : null}
              <span className="dshx:ml-auto dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground">
                {browser.tabs} {browser.tabs === 1 ? 'tab' : 'tabs'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

const TabRow = (props: { readonly tab: BrowseTab }) => {
  const tab = props.tab
  const since = agoOf(tab.handoff?.startedAt ?? null)
  return (
    <li className={cn('dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5 dshx:rounded-md dshx:border dshx:p-2', tab.handoff !== null && 'dshx:border-warning')}>
      <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:text-sm">
        {tab.handoff === null ? (
          <GlobeIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0" />
        ) : (
          <HandIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0 dshx:text-warning" />
        )}
        <span className="dshx:min-w-0 dshx:truncate">{tab.title.length > 0 ? tab.title : tab.url}</span>
        {tab.busy ? <Badge variant="info">busy</Badge> : null}
        {tab.lent ? <Badge variant="muted">lent</Badge> : null}
      </div>
      <span className="dshx:min-w-0 dshx:truncate dshx:font-mono dshx:text-xs dshx:text-muted-foreground">{tab.url}</span>
      {tab.handoff === null ? null : (
        <p className="dshx:text-sm">
          <span className="dshx:font-medium">Waiting on you{since === null ? '' : ` (${since})`}:</span> {tab.handoff.message} Do it in that tab, then click
          Continue on its card.
        </p>
      )}
    </li>
  )
}

const TabsSection = (props: { readonly tabs: readonly BrowseTab[]; readonly running: boolean }) => {
  const waiting = props.tabs.filter(tab => tab.handoff !== null)
  const others = props.tabs.filter(tab => tab.handoff === null)
  return (
    <Section title="Agent tabs" description={props.running ? `${props.tabs.length} open, ${waiting.length} waiting on you.` : 'No relay, so no agent tabs.'}>
      {props.tabs.length === 0 ? (
        <p className="dshx:text-xs dshx:text-muted-foreground">Agents open their tabs in the background of your browser; they show here while open.</p>
      ) : (
        <ul className="dshx:flex dshx:flex-col dshx:gap-2" aria-label="Agent tabs">
          {[...waiting, ...others].map(tab => (
            <TabRow key={tab.tab} tab={tab} />
          ))}
        </ul>
      )}
    </Section>
  )
}

/** The CLI repeats the steps above; its line matters only when the relay runs on another port, which it then names. */
const relayAddressHint = (instructions: string | null): ReactNode =>
  instructions !== null && instructions.includes('relay address') ? <p className="dshx:text-xs dshx:text-muted-foreground">{instructions}</p> : null

const PairingCode = (props: { readonly pairing: Pairing; readonly onCancel: () => void; readonly cancelling: boolean }) => {
  const [copied, setCopied] = useState(false)
  const code = props.pairing.code ?? ''
  const expires = props.pairing.expiresAt
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-3" aria-live="polite">
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        <output aria-label="Pairing code" className="dshx:font-mono! dshx:text-3xl dshx:font-semibold dshx:tracking-widest dshx:select-all">
          {code}
        </output>
        <Button
          className={touch}
          variant="outline"
          size="sm"
          onClick={() => {
            void writeClipboard(code).then(ok => setCopied(ok))
          }}
        >
          {copied ? <CheckIcon /> : <CopyIcon />} {copied ? 'Copied' : 'Copy code'}
        </Button>
      </div>
      <ol className="dshx:list-decimal dshx:pl-5 dshx:text-sm">
        <li>In the browser to pair, open the Extensions menu → browse → Options.</li>
        <li>Expand advanced (or click Pair with a code) and enter the code above.</li>
        <li>Click Connect. This panel shows the result.</li>
      </ol>
      {relayAddressHint(props.pairing.instructions)}
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        <span className="dshx:text-xs dshx:text-muted-foreground">
          Works once{expires === null ? '' : `, until ${new Date(expires).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}.
        </span>
        <Button className={cn('dshx:ml-auto', touch)} variant="ghost" size="sm" disabled={props.cancelling} onClick={props.onCancel}>
          <XIcon /> Cancel pairing
        </Button>
      </div>
    </div>
  )
}

const OUTCOME_TONE = { paired: 'success', expired: 'warning', failed: 'destructive', cancelled: 'muted' } as const

const PairingSection = (props: { readonly pairing: Pairing; readonly services: BrowsePanelServices }) => {
  const queryClient = useQueryClient()
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: BROWSE_QUERY_KEYS.status }),
      queryClient.invalidateQueries({ queryKey: BROWSE_QUERY_KEYS.pairings }),
    ])
  const start = useMutation({ mutationFn: props.services.startPairing, onSettled: refresh })
  const cancel = useMutation({ mutationFn: props.services.cancelPairing, onSettled: refresh })
  const pairing = start.data !== undefined && props.pairing.state === 'idle' ? start.data : props.pairing
  const pending = pairing.state === 'pending'
  return (
    <Section title="Pair a browser" description="Connect a Chrome-family browser that has the browse extension, so agents can use it.">
      {pending ? (
        <PairingCode cancelling={cancel.isPending} onCancel={() => cancel.mutate()} pairing={pairing} />
      ) : (
        <div className="dshx:flex dshx:flex-col dshx:gap-2">
          {pairing.state === 'idle' ? null : (
            <p className="dshx:flex dshx:items-start dshx:gap-2 dshx:text-sm" role="status">
              <StatusDot className="dshx:mt-1.5" tone={OUTCOME_TONE[pairing.state]} />
              <span>{pairing.state === 'paired' ? `Paired ${pairing.browser ?? 'the browser'}.` : (pairing.message ?? `Pairing ${pairing.state}.`)}</span>
            </p>
          )}
          <Button className={cn('dshx:self-start', touch)} disabled={start.isPending} onClick={() => start.mutate()}>
            <Link2Icon /> {start.isPending ? 'Getting a code…' : pairing.state === 'idle' ? 'Pair a browser' : 'Pair another browser'}
          </Button>
        </div>
      )}
      {start.isError ? (
        <Alert variant="destructive">
          <AlertTitle>No pairing code</AlertTitle>
          <AlertDescription>
            {errorMessage(start.error, 'browse pair failed.')} Run <code>browse pair</code> in a terminal to see why, then try again.
          </AlertDescription>
        </Alert>
      ) : null}
    </Section>
  )
}

const PairedBrowserList = (props: {
  readonly browsers: readonly PairedBrowser[] | undefined
  readonly error: string | null
  readonly label: (browser: PairedBrowser) => string
  readonly onUnpair: (browser: PairedBrowser) => void
}) => {
  if (props.error !== null) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not list paired browsers</AlertTitle>
        <AlertDescription>
          {props.error} Check <code>browse pair --list</code> in a terminal, then reload.
        </AlertDescription>
      </Alert>
    )
  }
  if (props.browsers === undefined) return <p className="dshx:text-xs dshx:text-muted-foreground">Loading…</p>
  if (props.browsers.length === 0) return <p className="dshx:text-xs dshx:text-muted-foreground">No paired browsers yet. Pair one above.</p>
  return (
    <ul className="dshx:flex dshx:flex-col dshx:gap-2" aria-label="Paired browsers">
      {props.browsers.map(browser => (
        <li key={browser.profile} className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
          <div className="dshx:flex dshx:min-w-0 dshx:flex-col">
            <span className="dshx:truncate dshx:text-sm">{props.label(browser)}</span>
            <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">
              paired {browser.paired}, last seen {browser.lastSeen}
            </span>
          </div>
          <Button className={cn('dshx:ml-auto dshx:shrink', touch)} size="sm" variant="outline" onClick={() => props.onUnpair(browser)}>
            <Unlink2Icon /> Unpair
          </Button>
        </li>
      ))}
    </ul>
  )
}

const PairedBrowsersSection = (props: { readonly services: BrowsePanelServices }) => {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState<PairedBrowser | null>(null)
  const pairings = useQuery({ queryKey: BROWSE_QUERY_KEYS.pairings, queryFn: ({ signal }) => props.services.pairings(signal), retry: false })
  const revoke = useMutation({
    mutationFn: async (target: string) => {
      const outcome = await props.services.revoke(target)
      if (!outcome.revoked) throw new Error(outcome.message)
      return outcome
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: BROWSE_QUERY_KEYS.pairings }),
  })
  const label = (browser: PairedBrowser): string => browser.name ?? browser.id ?? 'A browser not connected yet'
  return (
    <Section
      title="Paired browsers"
      action={
        <Button aria-label="Reload paired browsers" className={touch} size="icon-sm" variant="ghost" onClick={() => void pairings.refetch()}>
          <RefreshCwIcon />
        </Button>
      }
    >
      <PairedBrowserList
        browsers={pairings.data?.browsers}
        error={pairings.isError ? errorMessage(pairings.error, 'browse pair --list failed.') : null}
        label={label}
        onUnpair={setConfirming}
      />
      {revoke.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Not unpaired</AlertTitle>
          <AlertDescription>{errorMessage(revoke.error, 'browse pair --revoke failed.')}</AlertDescription>
        </Alert>
      ) : null}
      <AlertDialog open={confirming !== null} onOpenChange={open => (open ? undefined : setConfirming(null))}>
        <AlertDialogContent className="dshx-root">
          <AlertDialogHeader>
            <AlertDialogTitle>Unpair {confirming === null ? 'this browser' : label(confirming)}?</AlertDialogTitle>
            <AlertDialogDescription>Agents can no longer use it until you pair it again with a new code.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={touch}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className={touch}
              variant="destructive"
              onClick={() => {
                if (confirming !== null) revoke.mutate(confirming.profile)
                setConfirming(null)
              }}
            >
              Unpair
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  )
}

const StatusBody = (props: { readonly status: BrowseStatus | undefined; readonly error: string | null }) => {
  if (props.error !== null) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Status unavailable</AlertTitle>
        <AlertDescription>{props.error} If DSH was just updated, restart it so the browse Host half loads, then check again.</AlertDescription>
      </Alert>
    )
  }
  const status = props.status
  if (status === undefined) return <p className="dshx:text-sm dshx:text-muted-foreground">Reading browse status…</p>
  if (status.kind === 'not-installed') {
    return (
      <Alert>
        <AlertTitle>browse is not installed</AlertTitle>
        <AlertDescription>
          <p>
            DSH could not find <code>{status.command}</code>.
          </p>
          <p>{status.recovery}</p>
        </AlertDescription>
      </Alert>
    )
  }
  if (status.kind === 'failed') {
    return (
      <Alert variant="destructive">
        <AlertTitle>browse status failed</AlertTitle>
        <AlertDescription>
          <p>{status.message}</p>
          <p>{status.recovery}</p>
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <>
      <RelaySection status={status} />
      <TabsSection running={status.relay.running} tabs={status.tabs} />
    </>
  )
}

/** Browser (browse): relay, extension and agent tabs from `browse status --json`, pairing, and paired browsers. */
export const BrowsePanel = (props: { readonly services: BrowsePanelServices; readonly pollIntervalMs: number }) => {
  const status = useQuery({
    queryKey: BROWSE_QUERY_KEYS.status,
    queryFn: ({ signal }) => props.services.status(signal),
    refetchInterval: query => (query.state.data?.pairing.state === 'pending' ? Math.min(PENDING_POLL_MS, props.pollIntervalMs) : props.pollIntervalMs),
    retry: false,
  })
  const data = status.data
  const waiting = data?.kind === 'ready' ? data.waiting : 0
  return (
    <main className="dshx-root dshx:@container dshx:flex dshx:h-full dshx:min-w-0 dshx:flex-col dshx:gap-4 dshx:overflow-y-auto dshx:p-5 dshx:@max-pane-narrow:p-3">
      <header className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
        <GlobeIcon aria-hidden className="dshx:size-5 dshx:shrink-0" />
        <h1 className="dshx:min-w-0 dshx:truncate dshx:text-lg dshx:font-semibold">Browser (browse)</h1>
        {waiting > 0 ? (
          <Badge aria-label={`${waiting} tabs waiting on you`} variant="warning">
            {waiting} waiting
          </Badge>
        ) : null}
        <Button aria-label="Check status now" className={cn('dshx:ml-auto', touch)} size="icon-sm" variant="ghost" onClick={() => void status.refetch()}>
          <RefreshCwIcon className={cn(status.isFetching && 'dshx:animate-spin')} />
        </Button>
      </header>
      <StatusBody error={status.isError ? errorMessage(status.error, 'The browse plugin did not answer.') : null} status={data} />
      {data !== undefined && data.kind !== 'not-installed' ? (
        <>
          <PairingSection pairing={data.pairing} services={props.services} />
          <PairedBrowsersSection services={props.services} />
        </>
      ) : null}
    </main>
  )
}
