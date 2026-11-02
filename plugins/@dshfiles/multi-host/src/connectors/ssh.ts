import { Effect, type Scope } from 'effect'
import { RuntimeNotRunning } from '../errors.js'
import { RuntimeLaunchFile } from '../launch-file.js'
import { Ssh, shellQuote } from '../ssh.js'
import { connectGateway, GatewayUnavailableError, type Gateway } from './gateway.js'
import { reserveLoopbackEndpoint } from './loopback.js'

const remoteLaunch = Effect.fnUntraced(function* (input: { readonly sshTarget: string; readonly remoteHome: string }) {
  const ssh = yield* Ssh
  const [launchFile, webUrlFile] = RuntimeLaunchFile.launchFilePaths(input.remoteHome)
  const content = yield* ssh.exec({
    sshTarget: input.sshTarget,
    command: `cat -- ${shellQuote(launchFile)} 2>/dev/null || cat -- ${shellQuote(webUrlFile)} 2>/dev/null || true`,
  })
  const launch = RuntimeLaunchFile.parseRuntimeLaunch(content)
  if (launch === undefined) return yield* new RuntimeNotRunning({ reason: 'no-launch-file' })
  return launch
})

const gatewayFailure = (cause: unknown): GatewayUnavailableError =>
  cause instanceof GatewayUnavailableError
    ? cause
    : new GatewayUnavailableError('gateway-unreachable', 'Could not reach the runtime through its recorded connector.')

/** The remote launch file, a loopback `-L` forward to its port, then the authenticated gateway through that forward. */
const connect = Effect.fnUntraced(function* (input: { readonly sshTarget: string; readonly remoteHome: string; readonly originPort?: number | undefined }) {
  const ssh = yield* Ssh
  const launch = yield* remoteLaunch(input)
  const endpoint = yield* Effect.tryPromise({ try: () => reserveLoopbackEndpoint(input.originPort), catch: gatewayFailure })
  const tunnel = yield* ssh.tunnel({ sshTarget: input.sshTarget, remotePort: launch.port, localAddress: endpoint.address, localPort: endpoint.port })
  const localLaunchUrl = `http://${endpoint.address}:${endpoint.port}/?token=${encodeURIComponent(launch.token)}`
  const closed = Effect.runPromise(tunnel.closed)
  return yield* Effect.tryPromise({
    try: signal =>
      connectGateway({
        launchUrl: localLaunchUrl,
        signal,
        createTransport: async origin => ({
          origin: origin.origin,
          launchUrl: localLaunchUrl,
          closed,
          dispose: async () => undefined,
        }),
      }),
    catch: gatewayFailure,
  }).pipe(
    // SSH and the forward worked, so nothing listens behind the launch file: DSH there stopped without removing it.
    Effect.catchIf(
      error => error.code === 'gateway-unreachable',
      () => Effect.fail(new RuntimeNotRunning({ reason: 'closed-port' })),
    ),
  )
})

/** Cheapest proof that SSH reaches the machine with BatchMode keys: run `true`. */
const probe = Effect.fnUntraced(function* (input: { readonly sshTarget: string }) {
  const ssh = yield* Ssh
  yield* ssh.exec({ sshTarget: input.sshTarget, command: 'true' })
})

/** DSH homes under the remote user's home that publish a launch file, newest first. Paths only, never contents. */
const discoverHomes = Effect.fnUntraced(function* (input: { readonly sshTarget: string }) {
  const ssh = yield* Ssh
  const output = yield* ssh.exec({
    sshTarget: input.sshTarget,
    command:
      "find \"$HOME\" -maxdepth 7 -type f \\( -path '*/plugins/multi-host/launch.json' -o -path '*/runtime/web-url' \\) -not -path '*/node_modules/*' -print0 2>/dev/null | xargs -0 ls -t 2>/dev/null | head -20",
  })
  const homes = new Map<string, 'multi-host' | 'web-url'>()
  for (const line of output.split('\n')) {
    const path = line.trim()
    const multiHost = /^(\/.+)\/plugins\/multi-host\/launch\.json$/.exec(path)
    const webUrl = /^(\/.+)\/runtime\/web-url$/.exec(path)
    const home = multiHost?.[1] ?? webUrl?.[1]
    if (home !== undefined && !homes.has(home)) homes.set(home, multiHost === null ? 'web-url' : 'multi-host')
  }
  return [...homes.entries()].map(([path, source]) => ({ path, source }))
})

export class SshConnector {
  static readonly connect: (input: {
    readonly sshTarget: string
    readonly remoteHome: string
    readonly originPort?: number | undefined
  }) => Effect.Effect<Gateway, unknown, Ssh | Scope.Scope> = connect
  static readonly probe = probe
  static readonly discoverHomes = discoverHomes
}
