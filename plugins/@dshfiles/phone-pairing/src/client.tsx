import { Byte, Encoder } from '@nuintun/qrcode'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { QrCodeIcon } from '@dshfiles/plugin-ui/icons'
import { createApiClient, defineClient } from '@dshfiles/dshx/client'
import { useState } from 'react'
import { phonePairingApi, type PairingOffer } from './api.js'
import { PhonePairingQr } from './contract.js'

const QUIET_ZONE = 2

/** The code as vector squares: the QR encoder hands back a BitMatrix, so no markup string is injected. */
const QrCode = (props: { readonly value: string }): JSX.Element => {
  const encoded = new Encoder({ level: 'M' }).encode(new Byte(props.value))
  const size = encoded.size + QUIET_ZONE * 2
  const squares: JSX.Element[] = []
  for (let y = 0; y < encoded.size; y += 1)
    for (let x = 0; x < encoded.size; x += 1)
      if (encoded.get(x, y) === 1) squares.push(<rect key={String(x) + ':' + String(y)} x={x + QUIET_ZONE} y={y + QUIET_ZONE} width={1} height={1} />)
  return (
    <svg
      aria-label="Phone pairing QR code"
      role="img"
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      className="dshx:size-48 dshx:rounded-md dshx:bg-white dshx:p-1"
    >
      <g fill="currentColor" className="dshx:text-black">
        {squares}
      </g>
    </svg>
  )
}

type OfferState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly offer: PairingOffer }
  | { readonly kind: 'failed' }

const minutesLeft = (expiresAt: number, now: number): number => Math.max(0, Math.ceil((expiresAt - now) / 60_000))

/** The sidebar footer's QR button: one fresh single-use offer per open, discarded when the popover closes. */
const PairingQrButton = (props: { readonly offer: () => Promise<PairingOffer> }): JSX.Element => {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<OfferState>({ kind: 'idle' })
  const request = (): void => {
    setState({ kind: 'loading' })
    void props
      .offer()
      .then(offer => setState({ kind: 'ready', offer }))
      .catch(() => setState({ kind: 'failed' }))
  }
  return (
    <Popover
      open={open}
      onOpenChange={next => {
        setOpen(next)
        if (next) request()
        else setState({ kind: 'idle' })
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="dshx:shrink-0 dshx:text-muted-foreground" aria-label="Show pairing QR code">
          <QrCodeIcon className="dshx:size-4" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="end"
        className="dshx-root dshx:flex dshx:w-72 dshx:max-w-[calc(100vw-16px)] dshx:flex-col dshx:items-center dshx:gap-3"
        aria-label="Phone pairing"
      >
        {state.kind === 'loading' ? <p className="dshx:text-sm dshx:text-muted-foreground">Making a pairing code…</p> : null}
        {state.kind === 'failed' ? (
          <div className="dshx:flex dshx:flex-col dshx:items-center dshx:gap-2">
            <p className="dshx:text-center dshx:text-sm dshx:text-muted-foreground">The pairing code could not be created.</p>
            <Button size="sm" variant="outline" onClick={request}>
              Try again
            </Button>
          </div>
        ) : null}
        {state.kind === 'ready' && state.offer.state === 'off' ? (
          <p className="dshx:text-center dshx:text-sm dshx:text-muted-foreground">Phone access is off. Ask the agent to enable it, then open this again.</p>
        ) : null}
        {state.kind === 'ready' && state.offer.state === 'ready' ? (
          <>
            <QrCode value={state.offer.payload} />
            <p className="dshx:font-mono dshx:text-lg dshx:tracking-[0.2em]" data-testid="pairing-code">
              {state.offer.code}
            </p>
            <p className="dshx:text-center dshx:text-xs dshx:text-muted-foreground">
              Scan once, or open {state.offer.origin}/pair and type the code. Expires in {minutesLeft(state.offer.expiresAt, Date.now())} min.
            </p>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

export default defineClient({
  name: '@dshfiles/phone-pairing',
  inject: ['slots'],
  setup(ctx, _decorate, metadata) {
    const plugin = metadata?.plugin
    if (plugin === undefined) return
    const client = createApiClient(ctx, phonePairingApi)
    plugin.provide(PhonePairingQr, {
      Button: plugin.bind(() => <PairingQrButton offer={() => client.offer({})} />),
    })
  },
})
