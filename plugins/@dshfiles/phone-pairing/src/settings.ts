import { readFile, writeFile } from 'node:fs/promises'

export type Provider = 'tailscale-funnel' | 'tailscale-serve' | 'cloudflared' | 'manual'

export interface PhoneSettings {
  readonly enabled: boolean
  readonly provider: Provider
  /** Public origin for the manual provider, set by the user. */
  readonly origin?: string
}

const DEFAULT: PhoneSettings = { enabled: false, provider: 'tailscale-funnel' }

const isProvider = (value: unknown): value is Provider =>
  value === 'tailscale-funnel' || value === 'tailscale-serve' || value === 'cloudflared' || value === 'manual'

/** Persistent opt-in: phone access is off until the user turns it on, and stays off across restarts. */
export class PhoneAccessSettings {
  private constructor(private readonly path: string) {}

  static async load(path: string): Promise<{ settings: PhoneSettings; store: PhoneAccessSettings }> {
    let settings = DEFAULT
    try {
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'enabled' in parsed &&
        typeof parsed.enabled === 'boolean' &&
        'provider' in parsed &&
        isProvider(parsed.provider)
      ) {
        const origin = 'origin' in parsed && typeof parsed.origin === 'string' && URL.canParse(parsed.origin) ? parsed.origin : undefined
        settings =
          origin === undefined ? { enabled: parsed.enabled, provider: parsed.provider } : { enabled: parsed.enabled, provider: parsed.provider, origin }
      }
    } catch {
      settings = DEFAULT
    }
    return { settings, store: new PhoneAccessSettings(path) }
  }

  get current(): PhoneSettings {
    return this.saved
  }

  private saved: PhoneSettings = DEFAULT

  async save(next: PhoneSettings): Promise<void> {
    const { mkdir } = await import('node:fs/promises')
    await mkdir(this.path.slice(0, this.path.lastIndexOf('/')), { recursive: true, mode: 0o700 })
    await writeFile(this.path, JSON.stringify(next), { mode: 0o600 })
    this.saved = next
  }
}
