import { describe, expect, test } from 'vitest'
import { iconAssets, iconNames, isIconName } from '../src/icons.generated.ts'
import { ICON_PREFIX, MANIFEST_PATH, resolveRoute } from '../src/host.ts'
import { manifestIcons } from '../src/manifest.ts'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

interface Png {
  readonly width: number
  readonly height: number
}

/** Read the IHDR chunk, so a test proves the bytes are a PNG of the declared size. */
const readPng = (bytes: Uint8Array): Png => {
  expect([...bytes.subarray(0, 8)]).toEqual(PNG_SIGNATURE)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

const decoded = (name: string): Uint8Array => {
  if (!isIconName(name)) throw new Error(`generated icons do not include ${name}`)
  return new Uint8Array(Buffer.from(iconAssets[name], 'base64'))
}

describe('generated icons', () => {
  test('every icon the manifest advertises exists as a PNG of its declared size', () => {
    for (const icon of manifestIcons) {
      const name = icon.src.slice(ICON_PREFIX.length + 1)
      const [width, height] = icon.sizes.split('x').map(Number)
      expect(iconNames).toContain(name)
      expect(readPng(decoded(name))).toEqual({ width, height })
    }
  })

  test('the iOS touch icon is a 180px PNG', () => {
    expect(readPng(decoded('apple-touch-icon-180.png'))).toEqual({ width: 180, height: 180 })
  })
})

describe('route replies', () => {
  const manifest = new TextEncoder().encode('{"name":"DeepSeek Harness"}')
  const content = { manifest, assets: new Map(iconNames.map(name => [name, decoded(name)] as const)) }

  test('serves the manifest uncached for any GET or HEAD', () => {
    expect(resolveRoute({ method: 'GET', pathname: MANIFEST_PATH }, content)).toEqual({
      status: 200,
      headers: { 'content-type': 'application/manifest+json', 'cache-control': 'no-cache' },
      body: manifest,
    })
    expect(resolveRoute({ method: 'HEAD', pathname: MANIFEST_PATH }, content).status).toBe(200)
  })

  test('refuses anything that is not a read', () => {
    expect(resolveRoute({ method: 'POST', pathname: MANIFEST_PATH }, content).status).toBe(405)
    expect(resolveRoute({ method: 'POST', pathname: `${ICON_PREFIX}/icon-192.png` }, content).status).toBe(405)
    expect(resolveRoute({ method: undefined, pathname: MANIFEST_PATH }, content).status).toBe(405)
  })

  test('serves a known icon as a cacheable PNG at the exact bounds', () => {
    const reply = resolveRoute({ method: 'GET', pathname: `${ICON_PREFIX}/icon-512.png` }, content)
    expect(reply.status).toBe(200)
    expect(reply.headers).toEqual({ 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' })
    expect(readPng(reply.body)).toEqual({ width: 512, height: 512 })
  })

  test('never reads a file the generator did not produce', () => {
    expect(resolveRoute({ method: 'GET', pathname: `${ICON_PREFIX}/../package.json` }, content).status).toBe(404)
    expect(resolveRoute({ method: 'GET', pathname: `${ICON_PREFIX}/missing.png` }, content).status).toBe(404)
    expect(resolveRoute({ method: 'GET', pathname: '/' }, content).status).toBe(404)
  })
})
