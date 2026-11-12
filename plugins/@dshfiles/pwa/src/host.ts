/**
 * Serves the install metadata the stock shell cannot: a manifest with raster
 * icons and a splash color, and the head tags Safari on iOS requires for a
 * standalone home-screen launch. Registered on the Host's own Web server, so
 * the tunnel, the LAN listener and the desktop URL all get it.
 * @module @dshfiles/pwa
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { injectHead, headTags } from './head.ts'
import { iconAssets, iconNames, isIconName, type IconName } from './icons.generated.ts'
import { buildManifest, type Branding } from './manifest.ts'

export const name = 'pwa'

export const inject = ['webServer']

export interface Config {
  /** Manifest `name` and the document title the installed app reports. */
  title?: string
  /** Home-screen label; iOS truncates whatever does not fit. */
  shortName?: string
  /** Splash screen behind the icon while the app boots. */
  backgroundColor?: string
}

const defaults = { title: 'DeepSeek Harness', shortName: 'DSH', backgroundColor: '#0f1115' } as const

export const Config: z<Config> = z.object({
  title: z.string().default(defaults.title),
  shortName: z.string().default(defaults.shortName),
  backgroundColor: z.string().default(defaults.backgroundColor),
})

export const MANIFEST_PATH = '/manifest.webmanifest'
export const ICON_PREFIX = '/pwa'

/** A complete response the route handler writes without touching the reply. */
export interface Reply {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: Uint8Array
}

/** One request as the resolver reads it: the Web server owns everything else. */
export interface RouteRequest {
  readonly method: string | undefined
  readonly pathname: string
}

/** The bytes the resolver may serve: the manifest document and the generated icons. */
export interface RouteContent {
  readonly manifest: Uint8Array
  readonly assets: ReadonlyMap<IconName, Uint8Array>
}

const empty = new Uint8Array(0)
const unreadable = (method: string | undefined): boolean => method !== 'GET' && method !== 'HEAD'

/**
 * Answer one registered path. Only the manifest and the generated icon names are
 * addressable, so no request reaches another file, and a non-read method never
 * returns bytes.
 */
export const resolveRoute = (request: RouteRequest, content: RouteContent): Reply => {
  if (unreadable(request.method)) return { status: 405, headers: {}, body: empty }
  if (request.pathname === MANIFEST_PATH) {
    return { status: 200, headers: { 'content-type': 'application/manifest+json', 'cache-control': 'no-cache' }, body: content.manifest }
  }
  const name = request.pathname.slice(ICON_PREFIX.length + 1)
  const icon = isIconName(name) ? content.assets.get(name) : undefined
  if (icon === undefined) return { status: 404, headers: {}, body: empty }
  return { status: 200, headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' }, body: icon }
}

const writeReply = (request: IncomingMessage, response: ServerResponse, reply: Reply): void => {
  response.writeHead(reply.status, { ...reply.headers, 'content-length': String(reply.body.byteLength) })
  if (request.method === 'HEAD') response.end()
  else response.end(reply.body)
}

const pathnameOf = (url: string | undefined): string => new URL(url ?? '/', 'http://localhost').pathname

const decodedIcons = (): ReadonlyMap<IconName, Uint8Array> => {
  const assets = new Map<IconName, Uint8Array>()
  for (const iconName of iconNames) assets.set(iconName, new Uint8Array(Buffer.from(iconAssets[iconName], 'base64')))
  return assets
}

const brandingOf = (config: Config): Branding => ({
  title: config.title ?? defaults.title,
  shortName: config.shortName ?? defaults.shortName,
  backgroundColor: config.backgroundColor ?? defaults.backgroundColor,
})

export const apply = (ctx: Context, config: Config): void => {
  const branding = brandingOf(config)
  const content: RouteContent = {
    manifest: new TextEncoder().encode(JSON.stringify(buildManifest(branding))),
    assets: decodedIcons(),
  }
  const route = (request: IncomingMessage, response: ServerResponse): void =>
    writeReply(request, response, resolveRoute({ method: request.method, pathname: pathnameOf(request.url) }, content))
  const tags = headTags(branding)
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: MANIFEST_PATH, handler: route }))
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: ICON_PREFIX, handler: route }))
  ctx.effect(() => ctx.webServer.tapIndex(html => injectHead(html, tags)))
}
