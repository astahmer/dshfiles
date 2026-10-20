import { describe, expect, it } from 'vitest'
import { AttachmentGalleryLabelsModel } from '../src/client/labels.js'

const translate = ((key: string, params?: Record<string, unknown>) => (params === undefined ? key : `${key}:${Object.values(params).join('/')}`)) as Parameters<
  typeof AttachmentGalleryLabelsModel.imageLightboxLabels
>[0]

describe('AttachmentGalleryLabelsModel', () => {
  it('maps gallery translations onto the shared lightbox labels', () => {
    const labels = AttachmentGalleryLabelsModel.imageLightboxLabels(translate)

    expect(labels.dialog).toBe('dialog')
    expect(labels.close).toBe('close')
    expect(labels.thumbnail(2, 5)).toBe('thumbnail:2/5')
  })
})
