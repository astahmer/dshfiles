import { relativeTime, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
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
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { EntityList, EntityRow } from '@dshfiles/plugin-ui/components/entity-row'
import { CheckIcon, CopyIcon, KeyRoundIcon, LinkIcon, UnlinkIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useState, type ReactNode } from 'react'
import { needsPlainHttpConsent } from './link-urls.js'
import { multiHostKeys, multiHostQueries, type MultiHostClient } from './queries.js'

type LinkStatus = Extract<Awaited<ReturnType<MultiHostClient['linkStatus']>>, { readonly ok: true }>['status']
type LinkListen = LinkStatus['settings']['listen']
type LinkPeer = Extract<Awaited<ReturnType<MultiHostClient['linkPeers']>>, { readonly ok: true }>['peers'][number]
type LinkSettingsDraft = { readonly listen: LinkListen; readonly port: string; readonly advertiseUrl: string }

const LISTEN_LABELS = { tailscale: 'Tailscale', loopback: 'Loopback', all: 'All interfaces' } satisfies Record<LinkListen, string>
const LISTEN_MODES: readonly LinkListen[] = ['tailscale', 'loopback', 'all']

const failure = (result: { readonly ok: boolean; readonly code?: string; readonly message?: string }): Error =>
  new Error(result.message === undefined ? 'The link request failed.' : `${result.message}${result.code === undefined ? '' : ` (${result.code})`}`)

const validPort = (value: string): number | undefined => {
  const port = Number(value)
  return Number.isInteger(port) && port >= 1024 && port <= 65_535 ? port : undefined
}

const AGO_SUFFIX = { minutes: 'm ago', hours: 'h ago', days: 'd ago', months: 'mo ago', years: 'y ago' } as const
const ago = (at: string): string => {
  const age = relativeTime(Date.parse(at), Date.now())
  return age.unit === 'now' ? 'just now' : `${String(age.n)}${AGO_SUFFIX[age.unit]}`
}

const draftOf = (status: LinkStatus): LinkSettingsDraft => ({
  listen: status.settings.listen,
  port: String(status.settings.port),
  advertiseUrl: status.settings.advertiseUrl ?? '',
})

/** A value shown in monospace with a copy button that confirms in place. */
const CopyValue = (props: { readonly label: string; readonly value: string; readonly large?: boolean }) => {
  const [copied, setCopied] = useState<'copied' | 'failed' | null>(null)
  return (
    <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
      <code
        className={
          props.large === true
            ? 'dshx:min-w-0 dshx:truncate dshx:font-mono dshx:text-2xl dshx:font-semibold dshx:tracking-widest'
            : 'dshx:min-w-0 dshx:truncate dshx:font-mono dshx:text-xs'
        }
      >
        {props.value}
      </code>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        className="dshx:pointer-coarse:size-11"
        aria-label={`Copy ${props.label}`}
        onClick={() => void writeClipboard(props.value).then(ok => setCopied(ok ? 'copied' : 'failed'))}
      >
        {copied === 'copied' ? <CheckIcon className="dshx:size-3.5" /> : <CopyIcon className="dshx:size-3.5" />}
      </Button>
      {copied === 'failed' ? <span className="dshx:shrink-0 dshx:text-xs dshx:text-destructive">Allow clipboard access, then copy again.</span> : null}
    </div>
  )
}

const CheckboxRow = (props: { readonly checked: boolean; readonly onChange: (checked: boolean) => void; readonly children: ReactNode }) => (
  <label className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:text-sm dshx:pointer-coarse:min-h-11">
    <Checkbox checked={props.checked} onCheckedChange={checked => props.onChange(checked === true)} />
    <span className="dshx:min-w-0">{props.children}</span>
  </label>
)

const LinkSettingsForm = (props: { readonly api: MultiHostClient; readonly status: LinkStatus }) => {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<LinkSettingsDraft | null>(null)
  const current = draft ?? draftOf(props.status)
  const port = validPort(current.port)
  const save = useMutation({
    mutationFn: async (next: LinkSettingsDraft) => {
      const nextPort = validPort(next.port)
      if (nextPort === undefined) throw new Error('Pick a port from 1024 to 65535.')
      const advertiseUrl = next.advertiseUrl.trim()
      const result = await props.api.linkConfigure({ listen: next.listen, port: nextPort, advertiseUrl: advertiseUrl === '' ? null : advertiseUrl })
      if (!result.ok) throw failure(result)
      return result.status
    },
    onSuccess: status => {
      queryClient.setQueryData(multiHostKeys.linkStatus, status)
      setDraft(null)
    },
  })
  return (
    <form
      className="dshx:flex dshx:flex-col dshx:gap-3"
      onSubmit={event => {
        event.preventDefault()
        save.mutate(current)
      }}
    >
      <div className="dshx:grid dshx:grid-cols-[minmax(0,1fr)_7rem] dshx:gap-3 dshx:@max-pane-narrow:grid-cols-1">
        <label className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1 dshx:text-xs dshx:font-medium">
          Listen on
          <Select value={current.listen} onValueChange={value => setDraft({ ...current, listen: LISTEN_MODES.find(mode => mode === value) ?? current.listen })}>
            <SelectTrigger aria-label="Listen on" className="dshx:w-full dshx:pointer-coarse:h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="dshx-root">
              {LISTEN_MODES.map(mode => (
                <SelectItem key={mode} value={mode}>
                  {LISTEN_LABELS[mode]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1 dshx:text-xs dshx:font-medium">
          Port
          <Input
            inputMode="numeric"
            className="dshx:font-mono! dshx:pointer-coarse:h-11"
            value={current.port}
            aria-invalid={port === undefined}
            onChange={event => setDraft({ ...current, port: event.target.value })}
          />
        </label>
      </div>
      <label className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1 dshx:text-xs dshx:font-medium">
        Advertise URL
        <Input
          className="dshx:font-mono! dshx:pointer-coarse:h-11"
          placeholder="https://machine.tailnet.ts.net"
          value={current.advertiseUrl}
          onChange={event => setDraft({ ...current, advertiseUrl: event.target.value })}
        />
      </label>
      {save.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(save.error, 'The link settings could not be saved.')}</AlertDescription>
        </Alert>
      ) : null}
      {draft === null ? null : (
        <div className="dshx:flex dshx:flex-wrap dshx:justify-end dshx:gap-2">
          <Button type="button" size="sm" variant="ghost" className="dshx:pointer-coarse:min-h-11" disabled={save.isPending} onClick={() => setDraft(null)}>
            Cancel
          </Button>
          <Button type="submit" size="sm" className="dshx:pointer-coarse:min-h-11" disabled={port === undefined || save.isPending}>
            {save.isPending ? <Spinner className="dshx:size-3.5" /> : null}
            Save
          </Button>
        </div>
      )}
    </form>
  )
}

const PairingOffer = (props: { readonly api: MultiHostClient; readonly disabled: boolean }) => {
  const offer = useMutation({
    mutationFn: async () => {
      const result = await props.api.linkOffer()
      if (!result.ok) throw failure(result)
      return result
    },
  })
  return (
    <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2">
      <div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="dshx:pointer-coarse:min-h-11"
          disabled={props.disabled || offer.isPending}
          onClick={() => offer.mutate()}
        >
          {offer.isPending ? <Spinner className="dshx:size-3.5" /> : <KeyRoundIcon className="dshx:size-3.5" />}
          New pairing code
        </Button>
      </div>
      {offer.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(offer.error, 'No pairing code could be made.')}</AlertDescription>
        </Alert>
      ) : null}
      {offer.data === undefined ? null : (
        <div data-testid="link-pairing-offer" className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2 dshx:rounded-lg dshx:border dshx:p-3">
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-2">
            <CopyValue label="pairing code" value={offer.data.code} large />
            <Badge variant="secondary" className="dshx:text-2xs">
              Expires {new Date(offer.data.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Badge>
          </div>
          {offer.data.pairingLinks.map(link => (
            <CopyValue key={link} label={`pairing link ${link}`} value={link} />
          ))}
        </div>
      )}
    </div>
  )
}

const LinkedMachines = (props: { readonly api: MultiHostClient }) => {
  const queryClient = useQueryClient()
  const peers = useQuery(multiHostQueries.linkPeers(props.api, 30_000))
  const [unlinking, setUnlinking] = useState<LinkPeer | null>(null)
  const revoke = useMutation({
    mutationFn: async (peer: LinkPeer) => {
      const result = await props.api.linkRevoke({ peerId: peer.id, confirm: true })
      if (!result.ok) throw failure(result)
      return result.peer
    },
    onSuccess: () => setUnlinking(null),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: multiHostKeys.link }),
  })
  const list = peers.data ?? []
  return (
    <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2">
      <h3 className="dshx:text-xs dshx:font-medium dshx:text-muted-foreground">Linked machines</h3>
      {peers.isError ? (
        <Alert variant="destructive">
          <AlertDescription className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-2">
            <span className="dshx:min-w-0">{errorMessage(peers.error, 'Linked machines are unavailable.')}</span>
            <Button size="xs" variant="outline" onClick={() => void peers.refetch()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {revoke.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(revoke.error, 'The machine could not be unlinked.')}</AlertDescription>
        </Alert>
      ) : null}
      {peers.isPending ? <Spinner aria-label="Loading linked machines" /> : null}
      {peers.isSuccess && list.length === 0 ? <p className="dshx:text-sm dshx:text-muted-foreground">None</p> : null}
      {list.length === 0 ? null : (
        <EntityList aria-label="Linked machines">
          {list.map(peer => (
            <EntityRow
              key={peer.id}
              role="listitem"
              data-testid={`link-peer-${peer.id}`}
              heading={<span className="dshx:font-medium">{peer.name}</span>}
              meta={
                peer.hostId === undefined ? null : (
                  <Badge variant="outline" className="dshx:shrink-0 dshx:text-2xs">
                    Both ways
                  </Badge>
                )
              }
              description={<span className="dshx:min-w-0 dshx:truncate">Linked {ago(peer.createdAt)}</span>}
              trailing={
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="dshx:pointer-coarse:min-h-11"
                  disabled={revoke.isPending}
                  onClick={() => {
                    revoke.reset()
                    setUnlinking(peer)
                  }}
                >
                  <UnlinkIcon className="dshx:size-3.5" />
                  Unlink
                </Button>
              }
            />
          ))}
        </EntityList>
      )}
      <AlertDialog open={unlinking !== null} onOpenChange={open => (open ? undefined : setUnlinking(null))}>
        <AlertDialogContent className="dshx-root">
          <AlertDialogHeader>
            <AlertDialogTitle>Unlink {unlinking?.name}?</AlertDialogTitle>
            <AlertDialogDescription>It can no longer run threads here and must pair again with a new code to come back.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={revoke.isPending}
              onClick={event => {
                event.preventDefault()
                if (unlinking !== null) revoke.mutate(unlinking)
              }}
            >
              {revoke.isPending ? <Spinner className="dshx:size-3.5" /> : null}
              Unlink
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** Hosts page section: this machine's link gateway, its pairing codes and the machines linked to it. */
export const LinkThisMachine = (props: { readonly api: MultiHostClient; readonly onPair: () => void }) => {
  const queryClient = useQueryClient()
  const status = useQuery(multiHostQueries.linkStatus(props.api, 30_000))
  const toggle = useMutation({
    mutationFn: async (enabled: boolean) => {
      const result = await props.api.linkConfigure({ enabled })
      if (!result.ok) throw failure(result)
      return result.status
    },
    onSuccess: next => queryClient.setQueryData(multiHostKeys.linkStatus, next),
  })
  const data = status.data
  const enabled = data?.settings.enabled ?? false
  return (
    <section
      data-testid="link-this-machine"
      aria-labelledby="link-this-machine-heading"
      className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-4 dshx:rounded-lg dshx:border dshx:p-4 dshx:@max-pane-narrow:p-3"
    >
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-2">
        <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
          <h2 id="link-this-machine-heading" className="dshx:text-sm dshx:font-semibold">
            Link this machine
          </h2>
          {data === undefined ? null : data.listening ? (
            <Badge variant="secondary" className="dshx:text-2xs">
              Listening
            </Badge>
          ) : (
            <Badge variant="outline" className="dshx:text-2xs">
              {enabled ? 'Not listening' : 'Off'}
            </Badge>
          )}
        </div>
        <div className="dshx:flex dshx:items-center dshx:gap-2">
          <Button type="button" size="sm" variant="outline" className="dshx:pointer-coarse:min-h-11" onClick={props.onPair}>
            <LinkIcon className="dshx:size-3.5" />
            Pair a machine
          </Button>
          <span className="dshx:flex dshx:items-center dshx:pointer-coarse:min-h-11">
            <Switch
              aria-label="Linking"
              checked={enabled}
              disabled={data === undefined || toggle.isPending}
              onCheckedChange={checked => toggle.mutate(checked)}
            />
          </span>
        </div>
      </div>
      {status.isPending ? <Spinner aria-label="Loading link status" /> : null}
      {status.isError ? (
        <Alert variant="destructive">
          <AlertDescription className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-2">
            <span className="dshx:min-w-0">{errorMessage(status.error, 'The link status is unavailable.')}</span>
            <Button size="xs" variant="outline" onClick={() => void status.refetch()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {toggle.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(toggle.error, 'Linking could not be switched.')}</AlertDescription>
        </Alert>
      ) : null}
      {data?.error === undefined ? null : (
        <Alert variant="destructive" data-testid="link-gateway-error">
          <AlertDescription>{data.error.message}</AlertDescription>
        </Alert>
      )}
      {data === undefined ? null : (
        <>
          {data.urls.length === 0 ? null : (
            <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
              {data.urls.map(url => (
                <CopyValue key={url} label={`link URL ${url}`} value={url} />
              ))}
            </div>
          )}
          <LinkSettingsForm api={props.api} status={data} />
          <PairingOffer api={props.api} disabled={!data.listening} />
        </>
      )}
      <LinkedMachines api={props.api} />
    </section>
  )
}

type PairDraft = { readonly link: string; readonly code: string; readonly name: string; readonly linkBack: boolean; readonly allowPlainHttp: boolean }

const blankPair: PairDraft = { link: '', code: '', name: '', linkBack: true, allowPlainHttp: false }

const PairForm = (props: { readonly api: MultiHostClient; readonly onClose: () => void }) => {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<PairDraft>(blankPair)
  const plainHttp = needsPlainHttpConsent(draft.link)
  const pair = useMutation({
    mutationFn: async (input: PairDraft) => {
      const code = input.code.trim()
      const name = input.name.trim()
      const result = await props.api.linkPair({
        link: input.link.trim(),
        code: code === '' ? undefined : code,
        name: name === '' ? undefined : name,
        linkBack: input.linkBack,
        allowPlainHttp: plainHttp && input.allowPlainHttp,
      })
      if (!result.ok) throw failure(result)
      return result
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: multiHostKeys.all }),
  })
  if (pair.data !== undefined) {
    const back = pair.data.linkBack
    return (
      <div data-testid="link-pair-result" className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3">
        <p role="status" className="dshx:text-sm dshx:text-success">
          Paired with {pair.data.runtime.name}.
        </p>
        {back === undefined ? null : back.ok ? (
          <p className="dshx:text-sm dshx:text-success">Linked back: it can run threads here.</p>
        ) : (
          <Alert variant="destructive">
            <AlertDescription>Link back failed: {back.message}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button type="button" className="dshx:pointer-coarse:min-h-11" onClick={props.onClose}>
            Done
          </Button>
        </DialogFooter>
      </div>
    )
  }
  const ready = draft.link.trim() !== '' && (!plainHttp || draft.allowPlainHttp)
  return (
    <form
      className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3"
      onSubmit={event => {
        event.preventDefault()
        if (ready) pair.mutate(draft)
      }}
    >
      <label className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1 dshx:text-xs dshx:font-medium">
        Pairing link or URL
        <Input
          autoFocus
          className="dshx:font-mono! dshx:pointer-coarse:h-11"
          placeholder="https://machine.tailnet.ts.net/link#code=…"
          value={draft.link}
          onChange={event => setDraft({ ...draft, link: event.target.value })}
        />
      </label>
      <div className="dshx:grid dshx:grid-cols-2 dshx:gap-3 dshx:@max-pane-narrow:grid-cols-1">
        <label className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1 dshx:text-xs dshx:font-medium">
          Code
          <Input className="dshx:font-mono! dshx:pointer-coarse:h-11" value={draft.code} onChange={event => setDraft({ ...draft, code: event.target.value })} />
        </label>
        <label className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1 dshx:text-xs dshx:font-medium">
          Name
          <Input className="dshx:pointer-coarse:h-11" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} />
        </label>
      </div>
      <CheckboxRow checked={draft.linkBack} onChange={linkBack => setDraft({ ...draft, linkBack })}>
        Link back so it can run threads here
      </CheckboxRow>
      {plainHttp ? (
        <CheckboxRow checked={draft.allowPlainHttp} onChange={allowPlainHttp => setDraft({ ...draft, allowPlainHttp })}>
          Allow plain HTTP
        </CheckboxRow>
      ) : null}
      {pair.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(pair.error, 'Pairing failed.')}</AlertDescription>
        </Alert>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="ghost" className="dshx:pointer-coarse:min-h-11" disabled={pair.isPending} onClick={props.onClose}>
          Cancel
        </Button>
        <Button type="submit" className="dshx:pointer-coarse:min-h-11" disabled={!ready || pair.isPending}>
          {pair.isPending ? <Spinner className="dshx:size-3.5" /> : null}
          Pair
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Pair with another machine from the pairing link or URL and code it shows. */
export const PairMachineDialog = (props: { readonly api: MultiHostClient; readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) => (
  <Dialog open={props.open} onOpenChange={props.onOpenChange}>
    <DialogContent className="dshx-root dshx:@container dshx:max-h-[calc(100dvh-2rem)] dshx:overflow-x-hidden dshx:overflow-y-auto dshx:sm:max-w-lg">
      <DialogHeader className="dshx:min-w-0">
        <DialogTitle>Pair a machine</DialogTitle>
        <DialogDescription className="dshx:sr-only">Paste the pairing link the other machine shows under Link this machine.</DialogDescription>
      </DialogHeader>
      {props.open ? <PairForm api={props.api} onClose={() => props.onOpenChange(false)} /> : null}
    </DialogContent>
  </Dialog>
)
