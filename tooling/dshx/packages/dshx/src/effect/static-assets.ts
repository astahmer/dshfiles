/**
 * A Host web-server route that serves one build directory of static files, for a plugin whose browser code is too
 * large for its single-chunk `client.js` and is imported on demand instead (the whiteboard editor, the mermaid
 * renderer).
 *
 * The route exposes exactly that directory: only listed extensions, no symbolic link anywhere on the path, no `..`.
 * Responses carry an ETag and answer `If-None-Match` with 304; listed extensions are gzip-encoded (the DSH web
 * server does not compress plugin routes), one cached body per file. A missing file is 404; any other file-system
 * fault is 500 with the fault's tag on the span, so a permissions or disk problem is not mistaken for a stale URL.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { gzipSync } from 'node:zlib'
import { Effect, FileSystem, Option, Path, type PlatformError } from 'effect'
import { pluginAttributes, withSpan } from '../tracing/index.js'

/** Runs one file-system step of a request with the Host's platform services. */
export type Runner = <A>(effect: Effect.Effect<A, never, FileSystem.FileSystem | Path.Path>) => Promise<A>

export interface Options {
  /** Absolute pathname prefix the web server registers, without a trailing slash (`/dshfiles-whiteboard/editor`). */
  readonly route: string
  /** The directory served under {@link Options.route}. */
  readonly directory: string
  readonly run: Runner
  /** The span opened per request, named `<subject> <verb>` (`whiteboard editor-asset serve`). */
  readonly span: string
  /** The plugin the span's `asset_outcome` and `asset_type` attributes are namespaced under. */
  readonly plugin: string
  /** Served extensions (`.js`) with their content type; any other file is not found. */
  readonly contentTypes: ReadonlyMap<string, string>
  /** Extensions sent gzip-encoded to a client that accepts it. */
  readonly compressible: ReadonlySet<string>
  /** The `Cache-Control` value for one asset, by its name relative to {@link Options.directory}. */
  readonly cacheControl: (name: string) => string
}

/** The `node:http` handler a web server's prefix registration takes. */
export type Handler = (request: IncomingMessage, response: ServerResponse) => Promise<void>

type Outcome = 'served' | 'not-modified' | 'not-found' | 'method-not-allowed' | 'failed'

interface Asset {
  readonly file: string
  readonly extension: string
  readonly etag: string
  readonly cacheControl: string
}

/** Where a request led: a servable file, nothing servable, or a file-system fault other than a missing path. */
type Lookup = { readonly _tag: 'found'; readonly asset: Asset } | { readonly _tag: 'not-found' } | { readonly _tag: 'failed'; readonly fault: string }

const NOT_FOUND: Lookup = { _tag: 'not-found' }

/** A missing path (or one the platform refuses as an argument) is not found; any other fault is a failure. */
const classify = (error: PlatformError.PlatformError): Lookup =>
  error.reason._tag === 'BadArgument' || error.reason._tag === 'NotFound' ? NOT_FOUND : { _tag: 'failed', fault: error.reason._tag }

/** Run one file-system step, continuing with its value or stopping with what its error means for the request. */
const step = <A>(effect: Effect.Effect<A, PlatformError.PlatformError>, next: (value: A) => Effect.Effect<Lookup, never, FileSystem.FileSystem | Path.Path>) =>
  Effect.matchEffect(effect, { onFailure: error => Effect.succeed(classify(error)), onSuccess: next })

const decodedName = (route: string, pathname: string): string | undefined => {
  if (!pathname.startsWith(`${route}/`)) return undefined
  try {
    const name = decodeURIComponent(pathname.slice(route.length + 1))
    return name === '' || name.includes('\0') ? undefined : name
  } catch {
    return undefined
  }
}

const resolveAsset = (options: Options, pathname: string): Effect.Effect<Lookup, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const name = decodedName(options.route, pathname)
    if (name === undefined) return NOT_FOUND
    const extension = path.extname(name)
    if (!options.contentTypes.has(extension)) return NOT_FOUND
    return yield* step(fs.realPath(options.directory), root => {
      const candidate = path.join(root, name)
      if (!candidate.startsWith(`${root}${path.sep}`)) return Effect.succeed(NOT_FOUND)
      return step(fs.realPath(candidate), real =>
        real !== candidate
          ? Effect.succeed(NOT_FOUND)
          : step(fs.stat(candidate), info => {
              if (info.type !== 'File') return Effect.succeed(NOT_FOUND)
              const modified = Option.match(info.mtime, { onNone: () => 0, onSome: date => date.getTime() })
              const etag = `"${Number(info.size).toString(36)}-${modified.toString(36)}"`
              return Effect.succeed<Lookup>({ _tag: 'found', asset: { file: candidate, extension, etag, cacheControl: options.cacheControl(name) } })
            }),
      )
    })
  })

const readAsset = (file: string): Effect.Effect<Option.Option<Uint8Array> | { readonly fault: string }, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* Effect.matchEffect(fs.readFile(file), {
      onFailure: error => Effect.succeed(classify(error)._tag === 'not-found' ? Option.none<Uint8Array>() : { fault: error.reason._tag }),
      onSuccess: contents => Effect.succeed(Option.some(contents)),
    })
  })

/** One gzip body per served file, replaced when its ETag changes: bounded by the directory's file count. */
const createGzipCache = (): ((file: string, etag: string, raw: Buffer) => Buffer) => {
  const bodies = new Map<string, { readonly etag: string; readonly body: Buffer }>()
  return (file, etag, raw) => {
    const cached = bodies.get(file)
    if (cached?.etag === etag) return cached.body
    const body = gzipSync(raw)
    bodies.set(file, { etag, body })
    return body
  }
}

/** The `node:http` handler for {@link Options.route}; one {@link Options.span} span per request. */
export const handler = (options: Options): Handler => {
  const gzipped = createGzipCache()
  return (request, response) =>
    withSpan(options.span, { kind: 'server' }, async span => {
      const finish = (outcome: Outcome, status: number, headers: Record<string, string> = {}, body?: Buffer): void => {
        span.setAttributes({ ...pluginAttributes({ plugin: options.plugin, attributes: { asset_outcome: outcome } }), 'http.response.status_code': status })
        response.writeHead(status, { 'x-content-type-options': 'nosniff', ...headers })
        response.end(body)
      }
      const notFound = (): void => finish('not-found', 404, { 'content-type': 'text/plain; charset=utf-8' }, Buffer.from('Not found'))
      const failed = (fault: string): void => {
        span.setAttributes(pluginAttributes({ plugin: options.plugin, attributes: { asset_fault: fault } }))
        span.setStatus('error', fault)
        finish(
          'failed',
          500,
          { 'content-type': 'text/plain; charset=utf-8' },
          Buffer.from('The Host could not read this file; check the plugin build directory and its permissions.'),
        )
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return finish('method-not-allowed', 405, { allow: 'GET, HEAD' })
      const pathname = new URL(request.url ?? '/', 'http://dsh.invalid').pathname
      const lookup = await options.run(resolveAsset(options, pathname))
      if (lookup._tag === 'not-found') return notFound()
      if (lookup._tag === 'failed') return failed(lookup.fault)
      const asset = lookup.asset
      span.setAttributes(pluginAttributes({ plugin: options.plugin, attributes: { asset_type: asset.extension.slice(1) } }))
      const compressible = options.compressible.has(asset.extension)
      const headers = new Map([
        ['content-type', options.contentTypes.get(asset.extension) ?? 'application/octet-stream'],
        ['cache-control', asset.cacheControl],
        ['etag', asset.etag],
      ])
      if (compressible) headers.set('vary', 'accept-encoding')
      if (request.headers['if-none-match'] === asset.etag) return finish('not-modified', 304, Object.fromEntries(headers))
      const contents = await options.run(readAsset(asset.file))
      if (!Option.isOption(contents)) return failed(contents.fault)
      if (Option.isNone(contents)) return notFound()
      const raw = Buffer.from(contents.value)
      const accepts = compressible && /\bgzip\b/u.test(String(request.headers['accept-encoding'] ?? ''))
      const body = accepts ? gzipped(asset.file, asset.etag, raw) : raw
      if (accepts) headers.set('content-encoding', 'gzip')
      headers.set('content-length', String(body.length))
      return finish('served', 200, Object.fromEntries(headers), request.method === 'HEAD' ? undefined : body)
    })
}
