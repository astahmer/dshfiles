import { chmod, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { createServer, get as httpGet, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { layer as nodePathLayer } from '@effect/platform-node/NodePath'
import { Effect, Layer } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StaticAssets } from '../src/effect/index.js'
import { recordSpans } from '../src/tracing/index.js'

const ROUTE = '/plugin-assets'
const platform = Layer.mergeAll(nodeFileSystemLayer, nodePathLayer)

let root: string
let directory: string
let server: Server
let origin: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dshx-static-assets-'))
  directory = join(root, 'assets')
  await mkdir(directory)
  await writeFile(join(directory, 'entry.js'), 'export const version = 1')
  const handler = StaticAssets.handler({
    route: ROUTE,
    directory,
    run: effect => Effect.runPromise(effect.pipe(Effect.provide(platform))),
    span: 'static-asset serve',
    plugin: 'probe',
    contentTypes: new Map([['.js', 'text/javascript; charset=utf-8']]),
    compressible: new Set(['.js']),
    cacheControl: () => 'no-cache',
  })
  server = createServer((request, response) => void handler(request, response))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  // SAFETY: a server listening on a TCP port reports an AddressInfo, never a pipe name.
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
})

afterEach(async () => {
  await new Promise(resolve => server.close(resolve))
  await chmod(join(directory, 'entry.js'), 0o644).catch(() => undefined)
  await rm(root, { recursive: true, force: true })
})

/** The raw gzip body, read through node:http because fetch decodes it. */
const gzipBody = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    httpGet(`${origin}${ROUTE}/${path}`, { headers: { 'accept-encoding': 'gzip' } }, response => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => resolve(gunzipSync(Buffer.concat(chunks)).toString()))
    }).on('error', reject)
  })

describe('static asset route', () => {
  it('re-compresses a file whose ETag changed instead of serving the cached body', async () => {
    expect(await gzipBody('entry.js')).toBe('export const version = 1')
    await writeFile(join(directory, 'entry.js'), 'export const version = 2 // longer')
    await utimes(join(directory, 'entry.js'), new Date(), new Date(Date.now() + 5_000))
    expect(await gzipBody('entry.js')).toBe('export const version = 2 // longer')
  })

  it('answers a file-system fault other than a missing path with 500 and names it on the span', async () => {
    if (process.getuid?.() === 0) return // root reads any file, so no fault can be provoked.
    await chmod(join(directory, 'entry.js'), 0o000)
    const recorder = recordSpans()
    try {
      const response = await fetch(`${origin}${ROUTE}/entry.js`)
      expect(response.status).toBe(500)
      expect(await response.text()).toContain('check the plugin build directory and its permissions')
      const span = recorder.named('static-asset serve')[0]
      expect(span?.attributes['dshx.probe.asset_outcome']).toBe('failed')
      expect(span?.attributes['dshx.probe.asset_fault']).toBe('PermissionDenied')
      expect((await fetch(`${origin}${ROUTE}/missing.js`)).status).toBe(404)
    } finally {
      recorder.stop()
    }
  })
})
