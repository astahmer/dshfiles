import { execFile } from 'node:child_process'
import { withSpan } from '@dshfiles/dshx/tracing'
import type { Provider } from './providers.ts'

export type TunnelProvider = 'tailscale' | 'cloudflared'

export interface Tunnel {
  /** Public origin the phone uses, without a trailing slash. */
  readonly origin: string
  readonly provider: TunnelProvider
  readonly stop: () => Promise<void>
}

const run = (command: string, args: readonly string[], timeout = 20_000): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(command, [...args], { timeout }, (error, stdout, stderr) => {
      if (error) reject(error)
      else resolve(stdout.length > 0 ? stdout : stderr)
    })
  })

const has = (command: string): Promise<boolean> =>
  new Promise(resolve => {
    execFile('sh', ['-c', `command -v ${command}`], { timeout: 5_000 }, error => resolve(error === null))
  })

const tailnetNameOf = (raw: string): string | undefined => {
  try {
    const status: unknown = JSON.parse(raw)
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

const tailnetName = async (): Promise<string | undefined> => {
  try {
    return tailnetNameOf(await run('tailscale', ['status', '--json'], 5_000))
  } catch {
    return undefined
  }
}

const startFunnel = async (port: number): Promise<Tunnel | undefined> => {
  const name = await tailnetName()
  if (name === undefined) return undefined
  try {
    await run('tailscale', ['funnel', '--bg', '--https=443', `http://127.0.0.1:${port}`])
  } catch {
    return undefined
  }
  return {
    origin: `https://${name}`,
    provider: 'tailscale',
    stop: async () => {
      await run('tailscale', ['funnel', '--https=443', 'off']).catch(() => undefined)
    },
  }
}

const startServe = async (port: number): Promise<Tunnel | undefined> => {
  const name = await tailnetName()
  if (name === undefined) return undefined
  try {
    await run('tailscale', ['serve', '--bg', '--https=443', `http://127.0.0.1:${port}`])
  } catch {
    return undefined
  }
  return {
    origin: `https://${name}`,
    provider: 'tailscale',
    stop: async () => {
      await run('tailscale', ['serve', '--https=443', 'off']).catch(() => undefined)
    },
  }
}

const startQuickTunnel = async (port: number): Promise<Tunnel | undefined> => {
  if (!(await has('cloudflared'))) return undefined
  return new Promise(resolve => {
    const child = execFile('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { timeout: 0 })
    let settled = false
    const finish = (tunnel: Tunnel | undefined): void => {
      if (settled) return
      settled = true
      resolve(tunnel)
    }
    child.stderr?.on('data', (chunk: Buffer) => {
      const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(chunk.toString('utf8'))
      if (match === null) return
      finish({
        origin: match[0],
        provider: 'cloudflared',
        stop: async () => {
          child.kill('SIGTERM')
        },
      })
    })
    child.on('exit', () => finish(undefined))
    setTimeout(() => finish(undefined), 30_000)
  })
}

/**
 * One public HTTPS tunnel to the loopback gateway, for the provider the user chose.
 * `tailscale-funnel` publishes publicly; `tailscale-serve` stays tailnet-only;
 * `cloudflared` needs the binary. `manual` is handled by the caller with an origin.
 */
export const startTunnel = (port: number, provider: Provider): Promise<Tunnel | undefined> =>
  withSpan('phone pairing tunnel', async () => {
    if (provider === 'tailscale-funnel') return startFunnel(port)
    if (provider === 'tailscale-serve') return startServe(port)
    if (provider === 'cloudflared') return startQuickTunnel(port)
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
