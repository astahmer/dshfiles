import { describe, expect, it } from 'vitest'
import {
  beginImagePreview,
  imagePreviewClosed,
  imagePreviewLoaded,
  imagePreviewOpened,
  imagePreviewOpening,
  imagePreviewRequestIsCurrent,
} from '../src/image-preview-request.js'

const opened = (request: number) =>
  imagePreviewOpened(imagePreviewOpening<string>(request), {
    request,
    images: ['one'],
    initialIndex: 0,
  })

describe('image preview request', () => {
  it('opens the viewer once the gallery is read', () => {
    const request = beginImagePreview()
    expect(imagePreviewOpening<string>(request)).toEqual({ status: 'opening', request })
    expect(opened(request)).toEqual({ status: 'open', request, images: ['one'], initialIndex: 0 })
  })

  it('fills in loaded sources for the preview that is still open', () => {
    const request = beginImagePreview()
    const loaded = imagePreviewLoaded(opened(request), { request, images: ['one-src'] })
    expect(loaded).toMatchObject({ status: 'open', images: ['one-src'] })
  })

  it('ignores a superseded gallery read', () => {
    const first = beginImagePreview()
    const second = beginImagePreview()
    expect(imagePreviewRequestIsCurrent(first)).toBe(false)
    expect(imagePreviewRequestIsCurrent(second)).toBe(true)
    expect(imagePreviewOpened(imagePreviewOpening<string>(second), { request: first, images: ['stale'], initialIndex: 0 })).toEqual({
      status: 'opening',
      request: second,
    })
  })

  it('ignores a read that settles after the viewer closed', () => {
    const request = beginImagePreview()
    const closed = imagePreviewClosed<string>()
    expect(imagePreviewOpened(closed, { request, images: ['one'], initialIndex: 0 })).toBe(closed)
    expect(imagePreviewLoaded(closed, { request, images: ['one-src'] })).toBe(closed)
  })
})
