import { decodeJson, jsonValueSchema } from '@dshfiles/dshx/json'
import { Deferred, Effect, Exit, Option, Schema, Scope, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { commandExists, runCommand } from './commands.ts'
import type { Provider } from './providers.ts'

export type TunnelProvider = 'tailscale' | 'cloudflared'

export interface Tunnel {
  /** Public origin the phone uses, without a trailing slash. */
  readonly origin: string
  readonly provider: TunnelProvider
  readonly stop: Effect.Effect<void>
}

const tailnetNameOf = (raw: string): string | undefined => {
  try {
    const status = decodeJson(jsonValueSchema, raw)
    if (typeof status !== 'object' || status === null || !('Self' in status)) return undefined
    const self = status.Self
    if (typeof self !== 'object' || self === null || !('DNSName' in self)) return undefined
    const name = self.DNSName
    if (typeof name !== 'string') return undefined
    const trimmed = name.replace(/\.$/, '')
    return trimmed.endsWith('.ts.net') ? trimmed : undefined
  } catch {
    return undefined
  }
}

const tailnetName = runCommand({ command: 'tailscale', args: ['status', '--json'], timeout: '5 seconds' }).pipe(
  Effect.map(tailnetNameOf),
  Effect.orElseSucceed(() => undefined),
)

const serveStatusSchema = Schema.Struct({
  TCP: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  Web: Schema.optionalKey(
    Schema.Record(
      Schema.String,
      Schema.Struct({ Handlers: Schema.optionalKey(Schema.Record(Schema.String, Schema.Struct({ Proxy: Schema.optionalKey(Schema.String) }))) }),
    ),
  ),
})

/** What `tailscale serve status --json` says is already served: the HTTPS ports in use and each one's `/` target. */
export interface ServeRoutes {
  readonly ports: ReadonlySet<number>
  readonly proxyOf: (host: string, port: number) => string | undefined
}

const parseServeStatus = (raw: string): ServeRoutes => {
  const status = Schema.decodeUnknownSync(serveStatusSchema)(raw.trim() === '' ? {} : decodeJson(jsonValueSchema, raw))
  const web = status.Web ?? {}
  const ports = new Set<number>(Object.keys(status.TCP ?? {}).map(Number))
  for (const key of Object.keys(web)) ports.add(Number(key.slice(key.lastIndexOf(':') + 1)))
  return { ports, proxyOf: (host, port) => web[`${host}:${String(port)}`]?.Handlers?.['/']?.Proxy }
}

const serveStatus = runCommand({ command: 'tailscale', args: ['serve', 'status', '--json'], timeout: '5 seconds' }).pipe(
  Effect.flatMap(raw => Effect.try(() => parseServeStatus(raw))),
  Effect.option,
)

/** HTTPS ports phone pairing may take: Funnel accepts only these three; Serve takes any, so a few spares follow. */
const candidatePorts = (mode: 'funnel' | 'serve'): readonly number[] => (mode === 'funnel' ? [443, 8443, 10_000] : [443, 8443, 9443, 10_443])

/** The first candidate HTTPS port nothing serves yet; never one another route (Phone access QR's 443) already uses. */
const freeServePort = (mode: 'funnel' | 'serve', routes: ServeRoutes): number | undefined => candidatePorts(mode).find(port => !routes.ports.has(port))

/** Reading `tailscale serve status --json` and picking an HTTPS port nothing serves yet. */
export class ServeRoutesModel {
  static readonly parse = parseServeStatus
  static readonly freePort = freeServePort
}

/**
 * Tailscale Funnel publishes publicly; Serve stays on the tailnet. Both answer on the machine's tailnet name.
 * phone pairing takes only an HTTPS port nothing serves yet, and `stop` turns off only that port, and only while it
 * still points at this gateway, so another route (Phone access QR's `https=443`) is never replaced or removed.
 */
const startTailscale = Effect.fnUntraced(function* (input: { readonly mode: 'funnel' | 'serve'; readonly port: number }) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const name = yield* tailnetName
  if (name === undefined) return undefined
  const before = yield* serveStatus
  if (Option.isNone(before)) return undefined
  const https = freeServePort(input.mode, before.value)
  if (https === undefined) return undefined
  const target = `http://127.0.0.1:${String(input.port)}`
  const started = yield* runCommand({ command: 'tailscale', args: [input.mode, '--bg', `--https=${String(https)}`, target] }).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  )
  if (!started) return undefined
  const stop = Effect.gen(function* () {
    const after = yield* serveStatus
    if (Option.isNone(after) || after.value.proxyOf(name, https) !== target) return
    yield* runCommand({ command: 'tailscale', args: [input.mode, `--https=${String(https)}`, 'off'] })
  }).pipe(Effect.ignore, Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner))
  const tunnel: Tunnel = { origin: https === 443 ? `https://${name}` : `https://${name}:${String(https)}`, provider: 'tailscale', stop }
  return tunnel
})

const quickTunnelUrl = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/

/** The cloudflared process lives in its own scope until `stop` closes it; stderr keeps draining so its logs never block it. */
const startQuickTunnel = Effect.fnUntraced(function* (port: number) {
  if (!(yield* commandExists('cloudflared'))) return undefined
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const scope = yield* Scope.make()
  const stop = Scope.close(scope, Exit.void)
  const origin = yield* Deferred.make<string | undefined>()
  const started = yield* spawner
    .spawn(ChildProcess.make('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { stdin: 'ignore', stdout: 'ignore' }))
    .pipe(
      Effect.flatMap(handle =>
        handle.stderr.pipe(
          Stream.decodeText(),
          Stream.runForEach(chunk => {
            const match = quickTunnelUrl.exec(chunk)
            return match === null ? Effect.void : Deferred.succeed(origin, match[0])
          }),
          Effect.ignore,
          Effect.andThen(Deferred.succeed(origin, undefined)),
          Effect.forkIn(scope),
        ),
      ),
      Scope.provide(scope),
      Effect.option,
    )
  const url = Option.isNone(started)
    ? Option.none<string>()
    : yield* Deferred.await(origin).pipe(
        Effect.timeoutOption('30 seconds'),
        Effect.map(found => Option.flatMap(found, Option.fromUndefinedOr)),
      )
  if (Option.isNone(url)) {
    yield* stop
    return undefined
  }
  const tunnel: Tunnel = { origin: url.value, provider: 'cloudflared', stop }
  return tunnel
})

/**
 * One public HTTPS tunnel to the loopback gateway, for the provider the user chose.
 * `tailscale-funnel` publishes publicly; `tailscale-serve` stays tailnet-only;
 * `cloudflared` needs the binary. `manual` is handled by the caller with an origin.
 */
export const startTunnel = Effect.fn('phone pairing tunnel')(function* (port: number, provider: Provider) {
  if (provider === 'tailscale-funnel') return yield* startTailscale({ mode: 'funnel', port })
  if (provider === 'tailscale-serve') return yield* startTailscale({ mode: 'serve', port })
  if (provider === 'cloudflared') return yield* startQuickTunnel(port)
  return undefined
})

/** Per-platform install commands, printed when no provider is available. */
export const setupHint = (platform: NodeJS.Platform = process.platform): string[] => {
  const brew = 'brew install cloudflared'
  const nix = 'nix profile install nixpkgs#cloudflared'
  const head = [
    'phone pairing needs a public HTTPS tunnel and found neither a signed-in Tailscale nor cloudflared.',
    'pico tailscale: install the Tailscale app and run `tailscale up` (no account setup beyond that).',
  ]
  if (platform === 'darwin') return [...head, `or install cloudflared: ${brew} (or ${nix})`]
  if (platform === 'linux') return [...head, 'or install cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/']
  return [...head, `or install cloudflared: ${nix}`]
}
