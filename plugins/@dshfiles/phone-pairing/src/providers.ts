import { execFile } from 'node:child_process'

export type Provider = 'tailscale-funnel' | 'tailscale-serve' | 'cloudflared' | 'manual'

export interface Availability {
  readonly provider: Provider
  readonly available: boolean
  /** One copy-pasteable command that installs the missing binary. */
  readonly install?: string
  /** What the user still has to do once the binary exists. */
  readonly setup?: string
}

const which = (command: string): Promise<boolean> =>
  new Promise(resolve => execFile('sh', ['-c', `command -v ${command}`], { timeout: 5_000 }, error => resolve(error === null)))

const platform = process.platform

/** Install commands use the package manager of the machine, never a downloaded script. */
export const installCommand = (provider: Provider): string | undefined => {
  if (provider === 'manual') return undefined
  if (platform === 'darwin') return 'brew install tailscale cloudflared'
  return 'nix profile install nixpkgs#cloudflared nixpkgs#tailscale'
}

const entry = (input: { provider: Provider; available: boolean; setup?: string }): Availability => {
  const command = input.available ? undefined : installCommand(input.provider)
  return {
    provider: input.provider,
    available: input.available,
    ...(command === undefined ? {} : { install: command }),
    ...(input.setup === undefined ? {} : { setup: input.setup }),
  }
}

export const detectProviders = async (): Promise<Availability[]> => {
  const [tailscale, cloudflared] = await Promise.all([which('tailscale'), which('cloudflared')])
  return [
    entry({ provider: 'tailscale-funnel', available: tailscale, setup: 'tailscale up, then enable HTTPS certificates in the Tailscale admin console' }),
    entry({ provider: 'tailscale-serve', available: tailscale, setup: 'tailscale up (tailnet only, no public URL)' }),
    entry({ provider: 'cloudflared', available: cloudflared }),
    entry({ provider: 'manual', available: true, setup: 'point your own HTTPS reverse proxy at the gateway port' }),
  ]
}
