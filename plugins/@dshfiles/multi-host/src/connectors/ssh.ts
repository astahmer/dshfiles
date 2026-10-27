import { Buffer } from 'node:buffer'
import { spawn, type ChildProcess } from 'node:child_process'
import { pluginAttributes, withSpan } from '@dshfiles/dshx/tracing'
import { hostConnectorSchema } from '../records.js'
import { connectGateway, GatewayUnavailableError, type Gateway } from './gateway.js'
import { reserveLoopbackEndpoint } from './loopback.js'
import { RuntimeLaunchFile, type RuntimeLaunch } from '../launch-file.js'

const outputLimit = 128 * 1024
const inputLimit = 60 * 1024 * 1024

const sshTargetOf = (value: string): string => {
  const parsed = hostConnectorSchema.parse({ kind: 'ssh', sshTarget: value })
  if (parsed.kind !== 'ssh') throw new GatewayUnavailableError('invalid-ssh-target', 'The SSH target is invalid.')
  return parsed.sshTarget
}

/** `-v` is only for tunnels: their readiness is read from a verbose stderr line. */
const sshOptions = ({ verbose = false }: { readonly verbose?: boolean | undefined } = {}): string[] => [
  '-o',
  'BatchMode=yes',
  '-o',
  'StrictHostKeyChecking=yes',
  '-o',
  'ExitOnForwardFailure=yes',
  '-o',
  'ForwardAgent=no',
  '-o',
  'PermitLocalCommand=no',
  '-o',
  'ConnectTimeout=8',
  '-o',
  'ServerAliveInterval=10',
  '-o',
  'ServerAliveCountMax=2',
  ...(verbose ? ['-v'] : []),
]

const safeSshError = (stderr: string, defaultCode: string, defaultMessage: string): GatewayUnavailableError => {
  if (/host key verification failed|remote host identification has changed/i.test(stderr)) {
    return new GatewayUnavailableError('host-key-rejected', 'SSH host identity is unknown or changed; verify it in known_hosts before connecting.')
  }
  if (/permission denied/i.test(stderr)) {
    return new GatewayUnavailableError('ssh-authentication-failed', 'SSH authentication failed in BatchMode; configure a key for this host first.')
  }
  if (/could not resolve hostname|name or service not known/i.test(stderr)) {
    return new GatewayUnavailableError('ssh-host-unresolved', 'The SSH target could not be resolved.')
  }
  if (/connection timed out|operation timed out|no route to host|connection refused/i.test(stderr)) {
    return new GatewayUnavailableError('ssh-unreachable', 'The SSH target is unreachable.')
  }
  return new GatewayUnavailableError(defaultCode, defaultMessage)
}

export const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

export interface SshProcessResult {
  /** The remote command's exit status; null when ssh itself ended the run. */
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
  readonly outputExceeded: boolean
  readonly durationMs: number
}

/**
 * One bounded remote process: resolves with its exit status and both streams instead of throwing on a non-zero exit,
 * which remote commands need to report their own failure. Cancellation and ssh startup failures still reject.
 */
const runSshProcess = (input: {
  readonly sshTarget: string
  readonly command: string
  readonly timeoutMs?: number | undefined
  readonly maxOutputBytes?: number | undefined
  readonly stdin?: Uint8Array | undefined
  readonly signal?: AbortSignal | undefined
}): Promise<SshProcessResult> =>
  withSpan('ssh command', { kind: 'client', attributes: { 'process.executable.name': 'ssh' } }, async span => {
    const result = await runUntracedSshProcess(input)
    if (input.stdin !== undefined) span.setAttribute('dshfiles.multi_host.stdin_bytes', input.stdin.byteLength)
    span.setAttributes({
      'process.exit.code': result.code ?? -1,
      ...pluginAttributes({ plugin: 'multi-host', attributes: { timed_out: result.timedOut, output_exceeded: result.outputExceeded } }),
    })
    if (result.code !== 0) span.setStatus('error', result.timedOut ? 'timeout' : 'exit')
    return result
  })

const runUntracedSshProcess = async ({
  sshTarget,
  command,
  timeoutMs = 12_000,
  maxOutputBytes = outputLimit,
  stdin,
  signal,
}: {
  readonly sshTarget: string
  readonly command: string
  readonly timeoutMs?: number | undefined
  readonly maxOutputBytes?: number | undefined
  readonly stdin?: Uint8Array | undefined
  readonly signal?: AbortSignal | undefined
}): Promise<SshProcessResult> => {
  if (signal?.aborted) throw new GatewayUnavailableError('cancelled', 'The SSH request was cancelled.')
  if (stdin !== undefined && stdin.byteLength > inputLimit) throw new GatewayUnavailableError('ssh-input-too-large', 'The SSH input exceeded its limit.')
  const target = sshTargetOf(sshTarget)
  const startedAt = Date.now()
  const child = spawn('ssh', [...sshOptions(), target, command], { stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] })
  child.stdin?.on('error', () => undefined)
  if (stdin !== undefined) child.stdin?.end(Buffer.from(stdin))
  let stdout = ''
  let stderr = ''
  let outputBytes = 0
  let outputExceeded = false
  let timedOut = false
  const append = (current: string, chunk: Buffer | string): string => {
    const content = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    outputBytes += content.byteLength
    if (outputBytes > maxOutputBytes) {
      if (!outputExceeded) {
        outputExceeded = true
        void stopChild(child)
      }
      return current
    }
    return current + content.toString('utf8')
  }
  child.stdout?.on('data', chunk => {
    try {
      stdout = append(stdout, chunk)
    } catch {}
  })
  child.stderr?.on('data', chunk => {
    try {
      stderr = append(stderr, chunk)
    } catch {}
  })

  let timer: ReturnType<typeof setTimeout> | undefined
  let finished = false
  let abortListener: (() => void) | undefined
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', () => {
        if (finished) return
        finished = true
        reject(new GatewayUnavailableError('ssh-unavailable', 'The ssh executable could not be started.'))
      })
      child.once('close', status => {
        if (finished) return
        finished = true
        resolve(status)
      })
      timer = setTimeout(() => {
        if (finished) return
        finished = true
        timedOut = true
        void stopChild(child)
        resolve(null)
      }, timeoutMs)
      abortListener = () => {
        if (finished) return
        finished = true
        void stopChild(child)
        reject(new GatewayUnavailableError('cancelled', 'The SSH request was cancelled.'))
      }
      signal?.addEventListener('abort', abortListener, { once: true })
      if (signal?.aborted) abortListener()
    })
    return { code, stdout, stderr: stderr.slice(-8_192), timedOut, outputExceeded, durationMs: Date.now() - startedAt }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (abortListener !== undefined) signal?.removeEventListener('abort', abortListener)
  }
}

const runSshCommand = async ({
  sshTarget,
  command,
  signal,
}: {
  readonly sshTarget: string
  readonly command: string
  readonly signal?: AbortSignal | undefined
}): Promise<string> => {
  const result = await runSshProcess({ sshTarget, command, signal })
  if (result.outputExceeded) throw new GatewayUnavailableError('ssh-output-too-large', 'The SSH command returned more data than allowed.')
  if (result.timedOut) throw new GatewayUnavailableError('ssh-timeout', 'The SSH command exceeded its time limit.')
  if (result.code !== 0) throw safeSshError(result.stderr, 'ssh-command-failed', 'The SSH command failed.')
  return result.stdout
}

const remoteLaunch = async ({
  sshTarget,
  remoteHome,
  signal,
}: {
  readonly sshTarget: string
  readonly remoteHome: string
  readonly signal?: AbortSignal | undefined
}): Promise<RuntimeLaunch> => {
  const [launchFile, webUrlFile] = RuntimeLaunchFile.launchFilePaths(remoteHome)
  const content = await runSshCommand({
    sshTarget,
    command: `cat -- ${shellQuote(launchFile)} 2>/dev/null || cat -- ${shellQuote(webUrlFile)} 2>/dev/null || true`,
    signal,
  })
  const launch = RuntimeLaunchFile.parseRuntimeLaunch(content)
  if (launch === undefined) {
    throw new GatewayUnavailableError(
      'runtime-not-running',
      'No launch file was found in the remote DSH home. Start DSH there with the multi-host plugin, or through dsh-web, and try again.',
    )
  }
  return launch
}

const stopChild = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise<void>(resolve => child.once('close', () => resolve())),
    new Promise<void>(resolve =>
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
        resolve()
      }, 1_500),
    ),
  ])
}

interface TunnelRequest {
  readonly sshTarget: string
  readonly remotePort: number
  readonly localAddress: string
  readonly localPort: number
  readonly signal?: AbortSignal | undefined
}

/** One `ssh tunnel open` span until the loopback forward listens (or fails); the long-lived forward is not a span. */
const openTunnel = (request: TunnelRequest): Promise<ChildProcess> =>
  withSpan('ssh tunnel open', { kind: 'client', attributes: { 'process.executable.name': 'ssh' } }, () => openUntracedTunnel(request))

const openUntracedTunnel = async ({ sshTarget, remotePort, localAddress, localPort, signal }: TunnelRequest): Promise<ChildProcess> => {
  const target = sshTargetOf(sshTarget)
  const child = spawn('ssh', [...sshOptions({ verbose: true }), '-N', '-L', `${localAddress}:${localPort}:127.0.0.1:${remotePort}`, target], {
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout>
      const cleanup = (): void => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        child.stderr?.removeListener('data', onStderr)
        child.removeListener('error', onError)
        child.removeListener('close', onClose)
      }
      const finish = (error?: GatewayUnavailableError): void => {
        if (settled) return
        settled = true
        cleanup()
        if (error === undefined) resolve()
        else reject(error)
      }
      const onStderr = (chunk: Buffer | string): void => {
        const content = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk
        stderr = (stderr + content).slice(-8_192)
        if (stderr.includes(`Local forwarding listening on ${localAddress} port ${localPort}.`)) finish()
      }
      const onError = (): void => finish(new GatewayUnavailableError('ssh-unavailable', 'The ssh executable could not be started.'))
      const onClose = (): void => finish(safeSshError(stderr, 'tunnel-failed', 'The SSH forwarding process exited before its loopback endpoint became ready.'))
      const onAbort = (): void => finish(new GatewayUnavailableError('cancelled', 'The SSH tunnel request was cancelled.'))
      child.stderr?.on('data', onStderr)
      child.once('error', onError)
      child.once('close', onClose)
      timer = setTimeout(() => {
        finish(new GatewayUnavailableError('tunnel-timeout', 'The SSH loopback forward did not become ready before its time limit.'))
      }, 12_000)
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) onAbort()
    })
    return child
  } catch (error) {
    await stopChild(child)
    throw error
  }
}

const connectSsh = async ({
  sshTarget,
  remoteHome,
  originPort,
  signal,
}: {
  readonly sshTarget: string
  readonly remoteHome: string
  readonly originPort?: number
  readonly signal?: AbortSignal | undefined
}): Promise<Gateway> => {
  const target = sshTargetOf(sshTarget)
  const launch = await remoteLaunch({ sshTarget: target, remoteHome, signal })
  const endpoint = await reserveLoopbackEndpoint(originPort)
  let child: ChildProcess
  try {
    child = await openTunnel({ sshTarget: target, remotePort: launch.port, localAddress: endpoint.address, localPort: endpoint.port, signal })
  } catch (error) {
    endpoint.release()
    throw error
  }
  // The tunnel outlives openTunnel, which removed its 'error' listener; a failed kill would otherwise crash the Host.
  child.on('error', () => undefined)
  const localLaunchUrl = `http://${endpoint.address}:${endpoint.port}/?token=${encodeURIComponent(launch.token)}`
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()))
  let disposed = false
  try {
    return await connectGateway({
      launchUrl: localLaunchUrl,
      signal,
      createTransport: async origin => ({
        origin: origin.origin,
        launchUrl: localLaunchUrl,
        closed,
        dispose: async () => {
          if (disposed) return
          disposed = true
          await stopChild(child)
          endpoint.release()
        },
      }),
    })
  } catch (error) {
    // SSH and the forward worked, so nothing listens behind the launch file: DSH there stopped without removing it.
    if (error instanceof GatewayUnavailableError && error.code === 'gateway-unreachable') {
      throw new GatewayUnavailableError(
        'runtime-not-running',
        'DSH is not running on this host: its launch file points at a closed port. Start DSH there and reconnect.',
      )
    }
    throw error
  }
}

/** Cheapest proof that SSH reaches the machine with BatchMode keys: run `true`. */
const probeSsh = async ({ sshTarget, signal }: { readonly sshTarget: string; readonly signal?: AbortSignal | undefined }): Promise<void> => {
  await runSshCommand({ sshTarget: sshTargetOf(sshTarget), command: 'true', signal })
}

/** DSH homes under the remote user's home that publish a launch file, newest first. Paths only, never contents. */
const discoverRemoteHomes = async ({
  sshTarget,
  signal,
}: {
  readonly sshTarget: string
  readonly signal?: AbortSignal | undefined
}): Promise<{ path: string; source: 'multi-host' | 'web-url' }[]> => {
  const output = await runSshCommand({
    sshTarget: sshTargetOf(sshTarget),
    command:
      "find \"$HOME\" -maxdepth 7 -type f \\( -path '*/plugins/multi-host/launch.json' -o -path '*/runtime/web-url' \\) -not -path '*/node_modules/*' -print0 2>/dev/null | xargs -0 ls -t 2>/dev/null | head -20",
    signal,
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
}

export class SshConnector {
  static readonly connect = connectSsh
  static readonly probe = probeSsh
  static readonly discoverHomes = discoverRemoteHomes
  static readonly run = runSshProcess
}
