import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer, get as httpGet, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRendererAssetHandler } from '../src/renderer-assets.js'
import { RENDERER_ENTRY_FILE, RENDERER_ROUTE } from '../src/renderer-route.js'

const platformLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

let directory: string
let server: Server
let origin: string

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'mermaid-renderer-'))
  directory = join(root, 'renderer')
  const outside = join(root, 'secret.js')
  await mkdir(join(directory, 'chunks'), { recursive: true })
  await mkdir(join(directory, 'diagrams'), { recursive: true })
  await writeFile(join(directory, RENDERER_ENTRY_FILE), `export const mountAsync = ${JSON.stringify('x'.repeat(4000))}`)
  await writeFile(join(directory, 'chunks', 'DKUZGKB3.js'), 'export const part = 1')
  await writeFile(join(directory, 'diagrams', 'flowchart.js'), 'export {}')
  await writeFile(join(directory, 'katex.mjs'), 'export default {}')
  await writeFile(join(directory, 'LICENSE'), 'MIT')
  await writeFile(outside, 'outside the renderer directory')
  await symlink(outside, join(directory, 'linked.js'))
  const handler = createRendererAssetHandler({ directory, run: effect => Effect.runPromise(effect.pipe(Effect.provide(platformLayer))) })
  server = createServer((request, response) => void handler(request, response))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  // SAFETY: a server listening on a TCP port reports an AddressInfo, never a pipe name.
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
})

afterEach(async () => {
  await new Promise(resolve => server.close(resolve))
  await rm(join(directory, '..'), { recursive: true, force: true })
})

const get = (path: string, headers: Record<string, string> = {}) => fetch(`${origin}${RENDERER_ROUTE}/${path}`, { headers })

describe('renderer asset route', () => {
  it('serves entries no-cache and hashed chunks as immutable', async () => {
    const entry = await get(RENDERER_ENTRY_FILE)
    expect(entry.status).toBe(200)
    expect(entry.headers.get('content-type')).toContain('text/javascript')
    expect(entry.headers.get('cache-control')).toBe('no-cache')
    expect((await get('diagrams/flowchart.js')).headers.get('cache-control')).toBe('no-cache')
    const katex = await get('katex.mjs')
    expect(katex.headers.get('content-type')).toContain('text/javascript')
    expect(katex.headers.get('cache-control')).toBe('no-cache')
    const chunk = await get('chunks/DKUZGKB3.js')
    expect(chunk.headers.get('cache-control')).toContain('immutable')
    expect(await chunk.text()).toBe('export const part = 1')
  })

  it('answers a matching ETag with 304 and compresses scripts for gzip clients', async () => {
    const etag = (await get(RENDERER_ENTRY_FILE)).headers.get('etag') ?? ''
    expect((await get(RENDERER_ENTRY_FILE, { 'if-none-match': etag })).status).toBe(304)
    // Node's fetch decodes gzip itself; read the raw bytes through node:http instead.
    const raw = await new Promise<{ encoding: string | undefined; body: Buffer }>((resolve, reject) => {
      httpGet(`${origin}${RENDERER_ROUTE}/${RENDERER_ENTRY_FILE}`, { headers: { 'accept-encoding': 'gzip' } }, response => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => resolve({ encoding: response.headers['content-encoding'], body: Buffer.concat(chunks) }))
      }).on('error', reject)
    })
    expect(raw.encoding).toBe('gzip')
    expect(gunzipSync(raw.body).toString()).toContain('export const mountAsync')
  })

  it('refuses traversal, symbolic links, non-scripts and writes', async () => {
    for (const path of ['../secret.js', '%2e%2e/secret.js', 'linked.js', 'LICENSE', 'missing.js', '']) expect((await get(path)).status).toBe(404)
    expect((await fetch(`${origin}${RENDERER_ROUTE}/${RENDERER_ENTRY_FILE}`, { method: 'POST' })).status).toBe(405)
  })

  it('records one mermaid-diagrams renderer-asset serve span per request', async () => {
    const recorder = recordSpans()
    try {
      await get('chunks/DKUZGKB3.js')
      await get('missing.js')
      const spans = recorder.named('mermaid-diagrams renderer-asset serve')
      expect(spans.map(span => span.attributes['dshx.mermaid-diagrams.asset_outcome'])).toEqual(['served', 'not-found'])
    } finally {
      recorder.stop()
    }
  })
})
