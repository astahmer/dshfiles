import { execFile } from 'node:child_process'
import { withSpan } from '@dshfiles/dshx/tracing'

const TAILSCALE_TIMEOUT_MS = 3_000

/** Tailnet status parsing and the two Tailscale actions this plugin needs. */
export class Tailnet {
  /** The tailnet DNS name Tailscale reports for this machine, or undefined when it is not running. */
  static parseName(raw: string): string | undefined {
    const status: unknown = JSON.parse(raw)
    if (typeof status !== 'object' || status === null || !('Self' in status)) return undefined
    const self = status.Self
    if (typeof self !== 'object' || self === null || !('DNSName' in self)) return undefined
    const name = self.DNSName
    if (typeof name !== 'string') return undefined
    const trimmed = name.replace(/\.$/, '')
    return trimmed.endsWith('.ts.net') ? trimmed : undefined
  }
}

const runTailscale = (args: readonly string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile('tailscale', [...args], { timeout: TAILSCALE_TIMEOUT_MS }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })

export const detectTailnet = (): Promise<string | undefined> =>
  withSpan('phone access tailnet', async () => {
    try {
      return Tailnet.parseName(await runTailscale(['status', '--json']))
    } catch {
      return undefined
    }
  })

/** Point Tailscale Serve at the loopback proxy; the caller prints the undo command. */
export const serveTailnet = (port: number): Promise<boolean> =>
  withSpan('phone access serve', async () => {
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) return false
    try {
      await runTailscale(['serve', '--bg', '--https=443', `http://127.0.0.1:${port}`])
      return true
    } catch {
      return false
    }
  })
