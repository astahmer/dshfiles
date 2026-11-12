/**
 * Prints a scannable phone sign-in QR at DSH startup.
 *
 * A loopback rewrite proxy lets a TLS-terminating tunnel (Tailscale Serve) reach the
 * native listener without a `trustedHosts` entry: the native listener authenticates by
 * authority, so the proxy sends Host/Origin as the loopback authority while the browser
 * stays on the public origin. Other Host plugins claim routes on that same origin through
 * the edge API instead of repointing Tailscale themselves.
 * @module @dshfiles/phone-access
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { definePlugin } from '@dshfiles/dshx/host'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { phoneEdgeApi, type PhoneEdgeClaim, type PhoneEdgeStatus } from './edge-api.ts'
import { renderTerminalQr } from './qr.ts'
import { createRewriteProxy, type RouteClaim } from './rewrite-proxy.ts'
import { tailnetCommands } from './tailnet-promise.ts'

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

// SAFETY: schemastery implements Standard Schema with an `unknown` output, while an object schema always decodes a
// record; the Loader keeps validating the row config with this same schemastery schema.
const pluginConfig = Config as unknown as StandardSchemaV1<unknown, Readonly<Record<string, unknown>>>

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

/** The proxy, its origins and the route claims on it; `ready` settles once the proxy listened or failed and origins are known. */
export interface PhoneEdge {
  readonly ready: () => Promise<void>
  readonly status: () => PhoneEdgeStatus
  readonly claim: (owner: string, claim: PhoneEdgeClaim) => PhoneEdgeStatus
  readonly release: (owner: string) => boolean
}

export const apply = (ctx: Context, config: Config): PhoneEdge => {
  const proxyPort = config.proxyPort ?? 3443
  const configured = configuredOrigins(config)
  const claims = new Map<string, RouteClaim>()
  let listening = false
  let served = false
  let origins: readonly string[] = []

  const tailnet = tailnetCommands(ctx)
  let active = true
  ctx.effect(() => () => {
    active = false
    void tailnet.dispose()
  })

  const print = (shown: readonly string[]): void => {
    // SAFETY: the plugin declares `connection` in `inject`, so it is the native connection service.
    const connection = ctx.get('connection') as Peer | undefined
    if (connection?.authenticatedUrl === undefined) return
    for (const origin of shown) {
      const url = connection.authenticatedUrl(origin)
      if (!url) continue
      console.log([`phone sign-in (${origin}) — scan once, then install from the browser menu:`, renderTerminalQr(url), ''].join('\n'))
    }
  }

  const detectOrigins = async (): Promise<string[]> => {
    const host = await tailnet.detect()
    if (host === undefined) return []
    if (config.autoServe !== false) {
      if (!(await tailnet.serve(proxyPort))) return []
      served = true
      console.log(`phone-access: Tailscale Serve now targets http://127.0.0.1:${proxyPort} (undo: tailscale serve --https=443 off)`)
    }
    const origin = secureOrigin(`https://${host}`)
    return origin === undefined ? [] : [origin]
  }

  // SAFETY: `webServer`, when present, is the native listener service exposing its bound port.
  const server = ctx.get('webServer') as { port?: number } | undefined
  const proxy = server?.port === undefined ? undefined : createRewriteProxy({ upstream: server.port, port: proxyPort, claims: () => [...claims.values()] })
  ctx.effect(() => () => {
    proxy?.server.close()
  })
  // SAFETY: `loader`, when present, is the Cordis Loader service whose `await` settles activation.
  const settle = (ctx.get('loader') as { await?: () => Promise<void> } | undefined)?.await

  const opened = proxy?.listen() ?? Promise.reject(new Error('the native listener is unavailable'))
  const ready = opened
    .then(
      async () => {
        listening = true
        origins = configured.length > 0 ? configured : await detectOrigins()
        if (!active || origins.length === 0) return
        await Promise.resolve(settle?.call(ctx.get('loader')))
        if (active) print(origins)
      },
      async (error: unknown) => {
        if (active) console.error(`phone-access: cannot listen on 127.0.0.1:${proxyPort}: ${error instanceof Error ? error.message : String(error)}`)
        origins = configured
        if (!active || configured.length === 0) return
        await Promise.resolve(settle?.call(ctx.get('loader')))
        if (active) print(configured)
      },
    )
    .catch(() => {})

  const status = (): PhoneEdgeStatus => ({ listening, port: proxyPort, origins: [...origins], served, claims: [...claims.keys()] })
  return {
    ready: () => ready,
    status,
    claim: (owner, claim) => {
      claims.set(owner, { owner, port: claim.port, pathPrefixes: [...claim.pathPrefixes], cookie: claim.cookie, signIn: claim.signIn })
      return status()
    },
    release: owner => claims.delete(owner),
  }
}

/** Claims come from Host plugins only: a browser Client never redirects phone traffic to a loopback port. */
export const claimer = (caller: { readonly kind: string; readonly packageId?: string }): string => {
  if (caller.kind !== 'plugin' || caller.packageId === undefined) throw new Error('only a Host plugin can claim phone routes')
  return caller.packageId
}

export default definePlugin({
  id: 'dshfiles-phone-access',
  inject: ['connection', 'subprocess'],
  uses: ['rpc'],
  Config: pluginConfig,
  setup(api) {
    // SAFETY: the Loader validated this row's config with `pluginConfig`, the schemastery `Config` schema above.
    const edge = apply(api.raw.ctx, api.config as Config)
    api.rpc.register(
      phoneEdgeApi.host({
        status: async () => {
          await edge.ready()
          return edge.status()
        },
        claimRoutes: async ({ input, caller }) => {
          const owner = claimer(caller)
          await edge.ready()
          return edge.claim(owner, input)
        },
        releaseRoutes: ({ caller }) => ({ released: edge.release(claimer(caller)) }),
      }),
    )
  },
})
