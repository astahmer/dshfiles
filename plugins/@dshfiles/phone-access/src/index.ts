/**
 * Prints a scannable sign-in QR for every configured HTTPS origin at startup, so
 * a phone signs in once and keeps its cookie across DSH restarts.
 * @module @dshfiles/phone-access
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { renderTerminalQr } from './qr.ts'

export const name = 'phone-access'

export const inject = ['connection']

export interface Config {
  /** Absolute HTTPS origins the phone reaches, such as `https://box.tailnet.ts.net`. */
  origins?: string[]
}

export const Config: z<Config> = z.object({
  origins: z.array(String).default([]),
})

/** Configured origins win; the environment is the one-line opt-in for a single machine. */
const configureOrigins = (config: Config): string[] => {
  if ((config.origins ?? []).length > 0) return [...(config.origins ?? [])]
  return (process.env.DSH_PHONE_ORIGINS ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(origin => origin.length > 0)
}

interface Peer {
  /** Add the process launch token to an origin's clean URL. */
  readonly authenticatedUrl?: (url: string) => string
}

const secureOrigin = (value: string): string | undefined => {
  const parsed = URL.canParse(value) ? new URL(value) : undefined
  if (parsed === undefined || parsed.protocol !== 'https:') return undefined
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return undefined
  return parsed.origin
}

export const apply = (ctx: Context, config: Config): void => {
  const origins = configureOrigins(config)
    .map(secureOrigin)
    .filter((origin): origin is string => origin !== undefined)
  if (origins.length === 0) return

  let active = true
  ctx.effect(() => () => {
    active = false
  })

  const print = (): void => {
    const connection = ctx.get('connection') as Peer | undefined
    if (connection?.authenticatedUrl === undefined) return
    for (const origin of origins) {
      const url = connection.authenticatedUrl(origin)
      if (!url) continue
      console.log([`phone sign-in (${origin}) — scan once, then install from the browser menu:`, renderTerminalQr(url), ''].join('\n'))
    }
  }

  const settle = (ctx.get('loader') as { await?: () => Promise<void> } | undefined)?.await
  void Promise.resolve(settle?.call(ctx.get('loader')))
    .then(() => {
      if (active) print()
    })
    .catch(() => {})
}
