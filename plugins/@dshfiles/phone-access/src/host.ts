/**
 * Prints a scannable phone sign-in QR at DSH startup.
 *
 * A loopback rewrite proxy lets a TLS-terminating tunnel (Tailscale Serve) reach the
 * native listener without a `trustedHosts` entry: the native listener authenticates by
 * authority, so the proxy sends Host/Origin as the loopback authority while the browser
 * stays on the public origin.
 * @module @dshfiles/phone-access
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { renderTerminalQr } from './qr.ts'
import { createRewriteProxy } from './rewrite-proxy.ts'
import { detectTailnet, serveTailnet } from './tailnet.ts'

export const name = 'phone-access'

export const inject = ['connection']

export interface Config {
  /** Absolute HTTPS origins the phone reaches; empty means detect the Tailscale hostname. */
  origins?: string[]
  /** Loopback port the tunnel forwards to; the proxy rewrites Host/Origin to the DSH listener. */
  proxyPort?: number
  /** Point Tailscale Serve at the proxy on startup when no origin is configured. */
  autoServe?: boolean
}

export const Config: z<Config> = z.object({
  origins: z.array(String).default([]),
  proxyPort: z.natural().min(1).max(65_535).default(3443),
  autoServe: z.boolean().default(true),
})

interface Peer {
  /** Add the process launch token to an origin's clean URL. */
  readonly authenticatedUrl?: (url: string) => string
}

const secureOrigin = (value: string): string | undefined => {
  if (!URL.canParse(value)) return undefined
  const parsed = new URL(value)
  if (parsed.protocol !== 'https:') return undefined
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return undefined
  return parsed.origin
}

/** Configured origins win; the environment is the one-line opt-in for a single machine. */
const configuredOrigins = (config: Config): string[] => {
  const configured = (config.origins ?? []).length > 0 ? [...(config.origins ?? [])] : (process.env.DSH_PHONE_ORIGINS ?? '').split(',')
  return configured.map(origin => secureOrigin(origin.trim())).filter((origin): origin is string => origin !== undefined)
}

export const apply = (ctx: Context, config: Config): void => {
  const proxyPort = config.proxyPort ?? 3443
  const configured = configuredOrigins(config)

  let active = true
  ctx.effect(() => () => {
    active = false
  })

  const print = (origins: readonly string[]): void => {
    // SAFETY: the plugin declares `connection` in `inject`, so it is the native connection service.
    const connection = ctx.get('connection') as Peer | undefined
    if (connection?.authenticatedUrl === undefined) return
    for (const origin of origins) {
      const url = connection.authenticatedUrl(origin)
      if (!url) continue
      console.log([`phone sign-in (${origin}) — scan once, then install from the browser menu:`, renderTerminalQr(url), ''].join('\n'))
    }
  }

  const detectOrigins = async (): Promise<string[]> => {
    const host = await detectTailnet()
    if (host === undefined) return []
    if (config.autoServe !== false) {
      if (!(await serveTailnet(proxyPort))) return []
      console.log(`phone-access: Tailscale Serve now targets http://127.0.0.1:${proxyPort} (undo: tailscale serve --https=443 off)`)
    }
    const origin = secureOrigin(`https://${host}`)
    return origin === undefined ? [] : [origin]
  }

  // SAFETY: `webServer`, when present, is the native listener service exposing its bound port.
  const server = ctx.get('webServer') as { port?: number } | undefined
  const proxy = server?.port === undefined ? undefined : createRewriteProxy({ upstream: server.port, port: proxyPort })
  ctx.effect(() => () => {
    proxy?.server.close()
  })
  // SAFETY: `loader`, when present, is the Cordis Loader service whose `await` settles activation.
  const settle = (ctx.get('loader') as { await?: () => Promise<void> } | undefined)?.await

  const opened = proxy?.listen() ?? Promise.reject(new Error('the native listener is unavailable'))
  void opened
    .then(
      async () => {
        const origins = configured.length > 0 ? configured : await detectOrigins()
        if (!active || origins.length === 0) return
        await Promise.resolve(settle?.call(ctx.get('loader')))
        if (active) print(origins)
      },
      async (error: unknown) => {
        if (active) console.error(`phone-access: cannot listen on 127.0.0.1:${proxyPort}: ${error instanceof Error ? error.message : String(error)}`)
        if (!active || configured.length === 0) return
        await Promise.resolve(settle?.call(ctx.get('loader')))
        if (active) print(configured)
      },
    )
    .catch(() => {})
}
