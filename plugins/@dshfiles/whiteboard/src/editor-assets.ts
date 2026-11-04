import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { pluginAttributes, withSpan } from '@dshfiles/dshx/tracing'
import { Effect, FileSystem, Option, Path } from 'effect'
import { EDITOR_ASSET_ROUTE, EDITOR_ENTRY_FILE } from './editor-route.js'

const contentTypes = new Map([
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.woff2', 'font/woff2'],
  ['.map', 'application/json; charset=utf-8'],
])

/** Text assets worth compressing; fonts are already compressed woff2. */
const compressible = new Set(['.js', '.css', '.map'])

type AssetOutcome = 'served' | 'not-modified' | 'not-found' | 'method-not-allowed'

/** Runs one file-system step of a request with the Host's platform services. */
export type AssetRunner = <A>(effect: Effect.Effect<A, never, FileSystem.FileSystem | Path.Path>) => Promise<A>

interface Asset {
  readonly file: string
  readonly extension: string
  readonly etag: string
}

/** The editor build output next to the Host bundle: `dist/editor/` beside `dist/index.js`. */
export const defaultEditorDirectory = (): string => fileURLToPath(new URL('./editor/', import.meta.url))

const decodedName = (pathname: string): string | undefined => {
  if (!pathname.startsWith(`${EDITOR_ASSET_ROUTE}/`)) return undefined
  try {
    const name = decodeURIComponent(pathname.slice(EDITOR_ASSET_ROUTE.length + 1))
    return name === '' || name.includes('\0') ? undefined : name
  } catch {
    return undefined
  }
}

/**
 * Resolves a request pathname to a regular file inside the editor directory. Only known extensions are served, a
 * path whose real location differs from its spelled one (a symbolic link anywhere) is refused, and `..` can never
 * leave the directory, so the route exposes exactly the open-source editor build and nothing else on the Host.
 */
const resolveAsset = (directory: string, pathname: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const name = decodedName(pathname)
    if (name === undefined) return Option.none<Asset>()
    const extension = path.extname(name)
    if (!contentTypes.has(extension)) return Option.none<Asset>()
    const root = yield* Effect.option(fs.realPath(directory))
    if (Option.isNone(root)) return Option.none<Asset>()
    const candidate = path.join(root.value, name)
    if (!candidate.startsWith(`${root.value}${path.sep}`)) return Option.none<Asset>()
    const real = yield* Effect.option(fs.realPath(candidate))
    if (Option.isNone(real) || real.value !== candidate) return Option.none<Asset>()
    const info = yield* Effect.option(fs.stat(candidate))
    if (Option.isNone(info) || info.value.type !== 'File') return Option.none<Asset>()
    const modified = Option.match(info.value.mtime, { onNone: () => 0, onSome: date => date.getTime() })
    return Option.some({ file: candidate, extension, etag: `"${Number(info.value.size).toString(36)}-${modified.toString(36)}"` })
  })

const readAsset = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* Effect.option(fs.readFile(file))
  })

/** The `node:http` handler for {@link EDITOR_ASSET_ROUTE}; one `whiteboard editor-asset serve` span per request. */
export const createEditorAssetHandler = (input: { readonly directory: string; readonly run: AssetRunner }) => {
  // The DSH web server does not compress plugin routes; gzip each script once per build (keyed by its ETag).
  const gzipped = new Map<string, Buffer>()
  return (request: IncomingMessage, response: ServerResponse): Promise<void> =>
    withSpan('whiteboard editor-asset serve', { kind: 'server' }, async span => {
      const finish = (outcome: AssetOutcome, status: number, headers: Record<string, string> = {}, body?: Buffer): void => {
        span.setAttributes({ ...pluginAttributes({ plugin: 'whiteboard', attributes: { asset_outcome: outcome } }), 'http.response.status_code': status })
        response.writeHead(status, { 'x-content-type-options': 'nosniff', ...headers })
        response.end(body)
      }
      const notFound = (): void => finish('not-found', 404, { 'content-type': 'text/plain; charset=utf-8' }, Buffer.from('Not found'))
      if (request.method !== 'GET' && request.method !== 'HEAD') return finish('method-not-allowed', 405, { allow: 'GET, HEAD' })
      const pathname = new URL(request.url ?? '/', 'http://dsh.invalid').pathname
      const resolved = await input.run(resolveAsset(input.directory, pathname))
      if (Option.isNone(resolved)) return notFound()
      const asset = resolved.value
      span.setAttributes(pluginAttributes({ plugin: 'whiteboard', attributes: { asset_type: asset.extension.slice(1) } }))
      // Chunks and fonts carry a content hash in their name; only the fixed entry name must revalidate.
      const caching = asset.file.endsWith(EDITOR_ENTRY_FILE) ? 'no-cache' : 'public, max-age=31536000, immutable'
      const headers = new Map([
        ['content-type', contentTypes.get(asset.extension) ?? 'application/octet-stream'],
        ['cache-control', caching],
        ['etag', asset.etag],
      ])
      if (compressible.has(asset.extension)) headers.set('vary', 'accept-encoding')
      if (request.headers['if-none-match'] === asset.etag) return finish('not-modified', 304, Object.fromEntries(headers))
      const contents = await input.run(readAsset(asset.file))
      if (Option.isNone(contents)) return notFound()
      const raw = Buffer.from(contents.value)
      const accepts = /\bgzip\b/u.test(String(request.headers['accept-encoding'] ?? ''))
      const key = `${asset.file}|${asset.etag}`
      const body = accepts && compressible.has(asset.extension) ? (gzipped.get(key) ?? gzipped.set(key, gzipSync(raw)).get(key) ?? raw) : raw
      if (body !== raw) headers.set('content-encoding', 'gzip')
      headers.set('content-length', String(body.length))
      return finish('served', 200, Object.fromEntries(headers), request.method === 'HEAD' ? undefined : body)
    })
}
