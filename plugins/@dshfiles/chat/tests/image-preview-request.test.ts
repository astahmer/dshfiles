import { describe, expect, it } from 'vitest'
import { ImagePreviewRequestModel } from '../src/image-preview-request.js'

const opened = (request: number) =>
  ImagePreviewRequestModel.imagePreviewOpened(ImagePreviewRequestModel.imagePreviewOpening<string>(request), {
    request,
    images: ['one'],
    initialIndex: 0,
  })

describe('image preview request', () => {
  it('opens the viewer once the gallery is read', () => {
    const request = ImagePreviewRequestModel.beginImagePreview()
    expect(ImagePreviewRequestModel.imagePreviewOpening<string>(request)).toEqual({ status: 'opening', request })
    expect(opened(request)).toEqual({ status: 'open', request, images: ['one'], initialIndex: 0 })
  })

  it('fills in loaded sources for the preview that is still open', () => {
    const request = ImagePreviewRequestModel.beginImagePreview()
    const loaded = ImagePreviewRequestModel.imagePreviewLoaded(opened(request), { request, images: ['one-src'] })
    expect(loaded).toMatchObject({ status: 'open', images: ['one-src'] })
  })

  it('ignores a superseded gallery read', () => {
    const first = ImagePreviewRequestModel.beginImagePreview()
    const second = ImagePreviewRequestModel.beginImagePreview()
    expect(ImagePreviewRequestModel.imagePreviewRequestIsCurrent(first)).toBe(false)
    expect(ImagePreviewRequestModel.imagePreviewRequestIsCurrent(second)).toBe(true)
    expect(
      ImagePreviewRequestModel.imagePreviewOpened(ImagePreviewRequestModel.imagePreviewOpening<string>(second), {
        request: first,
        images: ['stale'],
        initialIndex: 0,
      }),
    ).toEqual({
      status: 'opening',
      request: second,
    })
  })

  it('ignores a read that settles after the viewer closed', () => {
    const request = ImagePreviewRequestModel.beginImagePreview()
    const closed = ImagePreviewRequestModel.imagePreviewClosed<string>()
    expect(ImagePreviewRequestModel.imagePreviewOpened(closed, { request, images: ['one'], initialIndex: 0 })).toBe(closed)
    expect(ImagePreviewRequestModel.imagePreviewLoaded(closed, { request, images: ['one-src'] })).toBe(closed)
  })
})
