import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer, get as httpGet, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import { createEditorAssetHandler } from '../src/editor-assets.js'
import { EDITOR_ASSET_ROUTE, EDITOR_ENTRY_FILE } from '../src/editor-route.js'
import { platformLayer } from './host-layers.js'

let directory: string
let outside: string
let server: Server
let origin: string

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'whiteboard-assets-'))
  directory = join(root, 'editor')
  outside = join(root, 'secret.js')
  await mkdir(join(directory, 'chunks'), { recursive: true })
  await mkdir(join(directory, 'fonts'), { recursive: true })
  await writeFile(join(directory, EDITOR_ENTRY_FILE), `export default ${JSON.stringify('x'.repeat(4000))}`)
  await writeFile(join(directory, 'chunks', 'part-abc123.js'), 'export const part = 1')
  await writeFile(join(directory, 'fonts', 'Excalifont-1.woff2'), Buffer.from([1, 2, 3]))
  await writeFile(join(directory, 'notes.txt'), 'not served')
  await writeFile(outside, 'outside the editor directory')
  await symlink(outside, join(directory, 'linked.js'))
  const handler = createEditorAssetHandler({ directory, run: effect => Effect.runPromise(effect.pipe(Effect.provide(platformLayer))) })
  server = createServer((request, response) => void handler(request, response))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  // SAFETY: a server listening on a TCP port reports an AddressInfo, never a pipe name.
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
})

afterEach(async () => {
  await new Promise(resolve => server.close(resolve))
  await rm(join(directory, '..'), { recursive: true, force: true })
})

const get = (path: string, headers: Record<string, string> = {}) => fetch(`${origin}${EDITOR_ASSET_ROUTE}/${path}`, { headers })

describe('editor asset route', () => {
  it('serves the entry no-cache and hashed chunks and fonts as immutable', async () => {
    const entry = await get(EDITOR_ENTRY_FILE)
    expect(entry.status).toBe(200)
    expect(entry.headers.get('content-type')).toContain('text/javascript')
    expect(entry.headers.get('cache-control')).toBe('no-cache')
    const chunk = await get('chunks/part-abc123.js')
    expect(chunk.headers.get('cache-control')).toContain('immutable')
    expect(await chunk.text()).toBe('export const part = 1')
    const font = await get('fonts/Excalifont-1.woff2')
    expect(font.headers.get('content-type')).toBe('font/woff2')
    expect(new Uint8Array(await font.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('answers a matching ETag with 304 and compresses scripts for gzip clients', async () => {
    const first = await get(EDITOR_ENTRY_FILE)
    const etag = first.headers.get('etag') ?? ''
    expect((await get(EDITOR_ENTRY_FILE, { 'if-none-match': etag })).status).toBe(304)
    // Node's fetch decodes gzip itself; read the raw bytes through node:http instead.
    const raw = await new Promise<{ encoding: string | undefined; body: Buffer }>((resolve, reject) => {
      httpGet(`${origin}${EDITOR_ASSET_ROUTE}/${EDITOR_ENTRY_FILE}`, { headers: { 'accept-encoding': 'gzip' } }, response => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => resolve({ encoding: response.headers['content-encoding'], body: Buffer.concat(chunks) }))
      }).on('error', reject)
    })
    expect(raw.encoding).toBe('gzip')
    expect(gunzipSync(raw.body).toString()).toContain('export default')
  })

  it('refuses traversal, symbolic links, unknown extensions and writes', async () => {
    for (const path of ['../secret.js', '%2e%2e/secret.js', 'linked.js', 'notes.txt', 'missing.js', '']) expect((await get(path)).status).toBe(404)
    expect((await fetch(`${origin}${EDITOR_ASSET_ROUTE}/${EDITOR_ENTRY_FILE}`, { method: 'POST' })).status).toBe(405)
  })

  it('records one whiteboard editor-asset serve span per request', async () => {
    const recorder = recordSpans()
    try {
      await get('chunks/part-abc123.js')
      await get('missing.js')
      const spans = recorder.named('whiteboard editor-asset serve')
      expect(spans.map(span => span.attributes['dshx.whiteboard.asset_outcome'])).toEqual(['served', 'not-found'])
      expect(spans[0]?.attributes['dshx.whiteboard.asset_type']).toBe('js')
    } finally {
      recorder.stop()
    }
  })
})
