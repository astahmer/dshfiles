import { describe, expect, it } from 'vitest'
import { imageForReference } from '../src/client/image-reference.js'

describe('imageForReference', () => {
  it('resolves only the requested image and ignores files or stale ids', () => {
    const images = [
      { kind: 'image', id: 'image-a' },
      { kind: 'file', id: 'file-a' },
      { kind: 'image', id: 'image-b' },
    ]

    expect(imageForReference(images, { id: 'image-b' })).toBe(images[2])
    expect(imageForReference(images, { id: 'file-a' })).toBeUndefined()
    expect(imageForReference(images, { id: 'removed-image' })).toBeUndefined()
    expect(imageForReference(images, null)).toBeUndefined()
  })
})
