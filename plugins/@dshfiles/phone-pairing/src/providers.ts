import { Effect, Schema } from 'effect'
import type { ChildProcessSpawner } from 'effect/process'
import { commandExists } from './commands.ts'

export const providers = ['tailscale-funnel', 'tailscale-serve', 'cloudflared', 'manual'] as const
export type Provider = (typeof providers)[number]

export const decodeEnableArgs = Schema.decodeUnknownSync(Schema.Struct({ provider: Schema.optionalKey(Schema.Literals(providers)) }))

export interface Availability {
  readonly provider: Provider
  readonly available: boolean
  /** One copy-pasteable command that installs the missing binary. */
  readonly install?: string
  /** What the user still has to do once the binary exists. */
  readonly setup?: string
}

const platform = process.platform

/** Install commands use the package manager of the machine, never a downloaded script. */
const installCommand = (provider: Provider): string | undefined => {
  if (provider === 'manual') return undefined
  if (platform === 'darwin') return 'brew install tailscale cloudflared'
  return 'nix profile install nixpkgs#cloudflared nixpkgs#tailscale'
}

const entry = (input: { provider: Provider; available: boolean; setup?: string }): Availability => {
  const command = input.available ? undefined : installCommand(input.provider)
  const availability: { -readonly [Key in keyof Availability]: Availability[Key] } = { provider: input.provider, available: input.available }
  if (command !== undefined) availability.install = command
  if (input.setup !== undefined) availability.setup = input.setup
  return availability
}

const detectProviders = Effect.gen(function* () {
  const [tailscale, cloudflared] = yield* Effect.all([commandExists('tailscale'), commandExists('cloudflared')], { concurrency: 'unbounded' })
  return [
    entry({ provider: 'tailscale-funnel', available: tailscale, setup: 'tailscale up, then enable HTTPS certificates in the Tailscale admin console' }),
    entry({ provider: 'tailscale-serve', available: tailscale, setup: 'tailscale up (tailnet only, no public URL)' }),
    entry({ provider: 'cloudflared', available: cloudflared }),
    entry({ provider: 'manual', available: true, setup: 'point your own HTTPS reverse proxy at the gateway port' }),
  ]
})

/** Tailscale when it is installed, otherwise the public OTP tunnel; the user's choice wins. */
export const resolveProvider = Effect.fnUntraced(function* (
  preferred?: Provider,
): Effect.fn.Return<{ provider: Provider; availability: Availability[] }, never, ChildProcessSpawner.ChildProcessSpawner> {
  const availability = yield* detectProviders
  if (preferred !== undefined) return { provider: preferred, availability }
  const tailscale = availability.find(option => option.provider === 'tailscale-serve' && option.available)
  if (tailscale !== undefined) return { provider: 'tailscale-serve', availability }
  const cloudflared = availability.find(option => option.provider === 'cloudflared' && option.available)
  if (cloudflared !== undefined) return { provider: 'cloudflared', availability }
  return { provider: 'manual', availability }
})
