import { describe, expect, it } from 'vitest'
import { ImagePreview } from './image-preview.ts'

describe('ImagePreview.typeOf', () => {
  it('names the media type of each previewable image extension, in any case', () => {
    expect(ImagePreview.typeOf('docs/screenshots/getting-started-390.png')).toBe('image/png')
    expect(ImagePreview.typeOf('a/b.JPG')).toBe('image/jpeg')
    expect(ImagePreview.typeOf('b.jpeg')).toBe('image/jpeg')
    expect(ImagePreview.typeOf('c.gif')).toBe('image/gif')
    expect(ImagePreview.typeOf('d.webp')).toBe('image/webp')
    expect(ImagePreview.typeOf('e.svg')).toBe('image/svg+xml')
    expect(ImagePreview.typeOf('C:\\shots\\f.avif')).toBe('image/avif')
  })

  it('refuses other files, dotfiles and extension-like directory names', () => {
    expect(ImagePreview.typeOf('dist/client.js')).toBeUndefined()
    expect(ImagePreview.typeOf('.png')).toBeUndefined()
    expect(ImagePreview.typeOf('shots.png/readme')).toBeUndefined()
    expect(ImagePreview.typeOf('archive.constructor')).toBeUndefined()
  })
})

describe('ImagePreview.response', () => {
  it('serves the bytes under their media type, unsniffed, uncached and sandboxed', async () => {
    const response = ImagePreview.response({ bytes: Uint8Array.from([1, 2, 3]), type: 'image/svg+xml' })
    expect(response.headers.get('content-type')).toBe('image/svg+xml')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-security-policy')).toContain('sandbox')
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.from([1, 2, 3]))
  })

  it('refuses in plain text that no cache keeps', async () => {
    const response = ImagePreview.refusal({ status: 413, reason: 'Too large.' })
    expect(response.status).toBe(413)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toBe('Too large.')
  })
})

describe('ImagePreview.refusalOf', () => {
  it('names the refusals a viewer explains and leaves other failures to retry', () => {
    expect(ImagePreview.refusalOf(404)).toBe('missing')
    expect(ImagePreview.refusalOf(413)).toBe('too-large')
    expect(ImagePreview.refusalOf(403)).toBe('outside')
    expect(ImagePreview.refusalOf(415)).toBe('not-an-image')
    expect(ImagePreview.refusalOf(500)).toBeUndefined()
    expect(ImagePreview.refusalOf(200)).toBeUndefined()
  })
})
