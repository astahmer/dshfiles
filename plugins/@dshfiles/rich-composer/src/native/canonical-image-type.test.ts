import { describe, expect, it } from 'vitest'
import { isImageMediaType, withCanonicalImageType } from './canonical-image-type.ts'

const picked = (name: string, type: string): File => new File([new Uint8Array([0xff, 0xd8, 0xff])], name, { type })

describe('withCanonicalImageType', () => {
  it.each([
    ['photo.jpg', 'image/jpg', 'image/jpeg'],
    ['photo.JPG', '', 'image/jpeg'],
    ['photo.jpeg', 'image/pjpeg', 'image/jpeg'],
    ['shot.png', 'application/octet-stream', 'image/png'],
    ['clip.webp', '', 'image/webp'],
  ])('relabels %s declared as "%s" so it takes the image path', (name, declared, expected) => {
    const file = withCanonicalImageType(picked(name, declared))
    expect(file.type).toBe(expected)
    expect(isImageMediaType(file.type)).toBe(true)
    expect(file.name).toBe(name)
  })

  it('keeps a canonical image, a non-image and an unknown extension untouched', () => {
    for (const file of [picked('a.jpg', 'image/jpeg'), picked('notes.txt', 'text/plain'), picked('raw.heic', ''), picked('jpg', '')]) {
      expect(withCanonicalImageType(file)).toBe(file)
    }
  })
})
