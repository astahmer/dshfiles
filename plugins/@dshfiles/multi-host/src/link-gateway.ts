import type { Server } from 'node:http'
import { hostname, networkInterfaces } from 'node:os'
import { Clock, Context, Duration, Effect, Layer, Option, Ref, Semaphore, Stream } from 'effect'
import { FetchHttpClient, HttpClient } from 'effect/http'
import { DshxPlugin } from '@dshfiles/dshx/effect'
import { LinkGatewayOff, LinkGatewayUnavailable, LinkPairRefused, type LinkStoreFailed } from './errors.js'
import { RuntimeIdentity } from './identity.js'
import { LinkStore, type LinkSettings } from './link-store.js'
import { createLinkServer, type RedeemAnswer } from './link-server.js'

export interface LinkStatus {
  readonly settings: LinkSettings
  readonly listening: boolean
  /** Origins a peer can pair with: the advertised one first, then each bound address. */
  readonly urls: readonly string[]
  readonly peerCount: number
  readonly error?: { readonly code: string; readonly message: string }
}

export interface LinkOffer {
  readonly code: string
  readonly expiresAt: string
  readonly urls: readonly string[]
  /** `<url>/link#code=…`: one paste carries both; the fragment never reaches a server log. */
  readonly pairingLinks: readonly string[]
}

const isTailnetIpv4 = (address: string): boolean => {
  const [first, second] = address.split('.').map(Number)
  return first === 100 && second !== undefined && second >= 64 && second <= 127
}

/** IPv4 addresses of this machine, the Tailscale ones (100.64.0.0/10) apart. */
const machineAddresses = (interfaces = networkInterfaces()) => {
  const all = Object.values(interfaces)
    .flatMap(entries => entries ?? [])
    .filter(entry => entry.family === 'IPv4' && !entry.internal)
    .map(entry => entry.address)
  return { tailnet: all.filter(isTailnetIpv4), other: all.filter(address => !isTailnetIpv4(address)) }
}

/** The address to bind and the origins to show for a listen mode; undefined when the mode has no address here. */
const listenPlan = (input: { readonly settings: LinkSettings; readonly addresses: ReturnType<typeof machineAddresses> }) => {
  const port = input.settings.port
  const advertised = input.settings.advertiseUrl === undefined ? [] : [new URL(input.settings.advertiseUrl).origin]
  if (input.settings.listen === 'loopback') return { bind: '127.0.0.1', urls: [...advertised, `http://127.0.0.1:${port}`] }
  if (input.settings.listen === 'all')
    return { bind: '0.0.0.0', urls: [...advertised, ...[...input.addresses.tailnet, ...input.addresses.other].map(address => `http://${address}:${port}`)] }
  const [tailnet] = input.addresses.tailnet
  if (tailnet === undefined) return undefined
  return { bind: tailnet, urls: [...advertised, `http://${tailnet}:${port}`] }
}

interface NativeCookie {
  readonly value: string
  readonly expiresAt: number
}

interface Listener {
  readonly key: string
  readonly server: Server
  readonly urls: readonly string[]
  readonly closeUnauthorised: () => void
  readonly closeAll: () => void
}

interface State {
  readonly listener: Listener | undefined
  readonly error: LinkGatewayUnavailable | undefined
}

const redeemStatus = {
  invalid: 400,
  expired: 410,
  used: 409,
  unknown: 404,
  'rate-limited': 429,
  'too-many-peers': 409,
  'insecure-url': 400,
  unreachable: 502,
  protocol: 502,
} satisfies Record<LinkPairRefused['reason'], number>

/**
 * This machine's link gateway: off by default, it listens only while linking is on and moves when the settings move.
 * A revoked peer loses its open sockets at once.
 */
export class LinkGateway extends Context.Service<
  LinkGateway,
  {
    readonly status: Effect.Effect<LinkStatus, LinkStoreFailed>
    /** Bring the listener in line with the stored settings, then report. */
    readonly apply: Effect.Effect<LinkStatus, LinkStoreFailed>
    readonly offer: Effect.Effect<LinkOffer, LinkStoreFailed | LinkGatewayOff | LinkGatewayUnavailable>
  }
>()('@dshfiles/multi-host/LinkGateway') {
  /** `nativeLaunchUrl` is this runtime's tokenized loopback launch URL, or undefined before DSH serves. */
  static readonly layer = <R>(input: { readonly nativeLaunchUrl: Effect.Effect<string | undefined, never, R> }) =>
    Layer.effect(
      LinkGateway,
      Effect.gen(function* () {
        const store = yield* LinkStore
        const identity = yield* RuntimeIdentity
        const client = HttpClient.withScope(yield* HttpClient.HttpClient)
        const state = yield* Ref.make<State>({ listener: undefined, error: undefined })
        // A settings write applies from both the handler and the store's change stream; two opens at once would race for the port.
        const applying = yield* Semaphore.make(1)
        const services = yield* Effect.context<R>()
        const run = Effect.runPromiseWith(services)
        const cookie: { value: NativeCookie | undefined } = { value: undefined }

        /** Exchange the native launch URL for its session cookie; the launch URL carries the token, so no span of its own. */
        const mintNativeCookie = Effect.gen(function* () {
          const launchUrl = yield* input.nativeLaunchUrl
          if (launchUrl === undefined) return undefined
          const response = yield* client.get(launchUrl).pipe(
            Effect.provideService(FetchHttpClient.RequestInit, { redirect: 'manual' }),
            Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
          )
          const minted = Object.values(response.cookies.cookies)[0]
          if (minted === undefined || minted.valueEncoded === '') return undefined
          const now = yield* Clock.currentTimeMillis
          const maxAge = minted.options?.maxAge
          return {
            value: `${minted.name}=${minted.valueEncoded}`,
            expiresAt: maxAge === undefined ? Number.POSITIVE_INFINITY : now + Duration.toMillis(maxAge),
          }
        }).pipe(
          Effect.scoped,
          Effect.withSpan('multi-host link native cookie'),
          Effect.orElseSucceed(() => undefined),
        )

        const minting: { current: Promise<string | undefined> | undefined } = { current: undefined }
        const nativeCookie = (): Promise<string | undefined> => {
          if (cookie.value !== undefined && cookie.value.expiresAt - 60_000 > Date.now()) return Promise.resolve(cookie.value.value)
          minting.current ??= run(mintNativeCookie).then(next => {
            cookie.value = next
            minting.current = undefined
            return next?.value
          })
          return minting.current
        }

        const redeem = (body: { readonly code: string; readonly name: string; readonly runtimeId?: string }): Promise<RedeemAnswer> =>
          run(
            Effect.gen(function* () {
              const self = yield* identity.current
              const redeemed = yield* store.redeem(body)
              return { ok: true as const, credential: redeemed.credential, runtimeId: self.runtimeId, name: hostname() }
            }).pipe(
              Effect.catchTag('LinkPairRefused', error =>
                Effect.succeed({ ok: false as const, status: redeemStatus[error.reason], reason: error.reason, message: error.message }),
              ),
              Effect.catch(() =>
                Effect.succeed({ ok: false as const, status: 500, reason: 'store', message: 'This machine could not record the link. Try again.' }),
              ),
            ),
          )

        const close = Effect.gen(function* () {
          const current = yield* Ref.getAndSet(state, { listener: undefined, error: undefined })
          if (current.listener === undefined) return
          const server = current.listener.server
          current.listener.closeAll()
          yield* Effect.callback<void>(resume => {
            server.close(() => resume(Effect.void))
          })
        })

        const open = Effect.fn('multi-host link gateway listen')(function* (settings: LinkSettings) {
          const plan = listenPlan({ settings, addresses: machineAddresses() })
          if (plan === undefined) return yield* new LinkGatewayUnavailable({ reason: 'no-tailscale' })
          const launchUrl = yield* input.nativeLaunchUrl
          if (launchUrl === undefined) return yield* new LinkGatewayUnavailable({ reason: 'no-runtime' })
          const upstreamPort = Number(new URL(launchUrl).port)
          const self = yield* identity.current.pipe(Effect.mapError(() => new LinkGatewayUnavailable({ reason: 'no-runtime' })))
          const linkServer = createLinkServer({
            upstreamPort,
            cookieName: `dsh_link_${self.runtimeId.replace(/-/g, '').slice(0, 12)}`,
            authenticate: token => store.authenticate(token),
            redeem,
            nativeCookie,
            nativeCookieRejected: value => {
              if (cookie.value?.value === value) cookie.value = undefined
            },
          })
          yield* Effect.callback<void, LinkGatewayUnavailable>(resume => {
            linkServer.server.once('error', (error: NodeJS.ErrnoException) =>
              resume(
                Effect.fail(
                  error.code === 'EADDRINUSE'
                    ? new LinkGatewayUnavailable({ reason: 'port-busy', detail: `${plan.bind}:${settings.port}` })
                    : new LinkGatewayUnavailable({ reason: 'listen-failed', detail: error.code ?? 'error' }),
                ),
              ),
            )
            linkServer.server.listen({ host: plan.bind, port: settings.port }, () => resume(Effect.void))
          })
          return {
            key: `${plan.bind}:${settings.port}`,
            server: linkServer.server,
            urls: plan.urls,
            closeUnauthorised: linkServer.closeUnauthorised,
            closeAll: linkServer.closeAll,
          } satisfies Listener
        })

        const apply = Effect.gen(function* () {
          const settings = yield* store.settings
          const current = yield* Ref.get(state)
          current.listener?.closeUnauthorised()
          if (!settings.enabled) {
            yield* close
          } else {
            const plan = listenPlan({ settings, addresses: machineAddresses() })
            const key = plan === undefined ? undefined : `${plan.bind}:${settings.port}`
            if (current.listener === undefined || current.listener.key !== key) {
              yield* close
              const opened = yield* Effect.result(open(settings))
              yield* Ref.set(state, opened._tag === 'Success' ? { listener: opened.success, error: undefined } : { listener: undefined, error: opened.failure })
            } else if (plan !== undefined) {
              yield* Ref.set(state, { listener: { ...current.listener, urls: plan.urls }, error: undefined })
            }
          }
          return yield* status
        }).pipe(applying.withPermits(1), Effect.provide(services))

        const status = Effect.gen(function* () {
          const settings = yield* store.settings
          const peers = yield* store.peers
          const current = yield* Ref.get(state)
          const error = settings.enabled ? current.error : undefined
          return {
            settings,
            listening: current.listener !== undefined,
            urls: current.listener?.urls ?? [],
            peerCount: peers.length,
            ...(error !== undefined && { error: { code: 'link-gateway-unavailable', message: error.message } }),
          } satisfies LinkStatus
        })

        const offer = Effect.gen(function* () {
          const current = yield* status
          if (!current.settings.enabled) return yield* new LinkGatewayOff()
          const failure = (yield* Ref.get(state)).error
          if (!current.listening) return yield* failure ?? new LinkGatewayUnavailable({ reason: 'listen-failed' })
          const minted = yield* store.offer
          const code = minted.code
          return {
            code,
            expiresAt: new Date(minted.expiresAt).toISOString(),
            urls: current.urls,
            pairingLinks: current.urls.map(url => `${url}/link#code=${code}`),
          } satisfies LinkOffer
        })

        yield* Effect.addFinalizer(() => close)
        yield* apply.pipe(Effect.ignore, Effect.forkScoped)
        yield* store.changes.pipe(
          Stream.runForEach(() => Effect.ignore(apply)),
          DshxPlugin.detached,
          Effect.forkScoped,
        )

        return LinkGateway.of({ status, apply, offer })
      }),
    )
}

/** Parse a pasted pairing link (`<origin>/link#code=…`) or a bare origin; the code may also come separately. */
const parsePairingLink = (input: { readonly link: string; readonly code?: string | undefined }) => {
  const url = Option.liftThrowable(() => new URL(input.link.trim()))()
  if (Option.isNone(url)) return undefined
  const fragment = new URLSearchParams(url.value.hash.replace(/^#/, ''))
  const code = input.code ?? fragment.get('code') ?? undefined
  if (code === undefined || code.trim() === '') return undefined
  return { url: url.value.origin, code: code.trim() }
}

/** Where the gateway listens and how a pasted pairing link reads: pure, so the tests drive them without a network. */
export class LinkPlan {
  static readonly machineAddresses = machineAddresses
  static readonly listen = listenPlan
  static readonly parsePairingLink = parsePairingLink
}
