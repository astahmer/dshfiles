import { describe, expect, it } from 'vitest'
import { imageAttachmentReferences } from './image-attachment-references.ts'

describe('imageAttachmentReferences', () => {
  it('inserts ordered inline labels tied to each image attachment', () => {
    expect(imageAttachmentReferences([{ id: 'image-a' }, { id: 'image-b' }], 2)).toEqual([
      {
        source: 'image-attachment',
        ref: 'image-a',
        label: 'Image 3',
        clipboardText: '[Image 3]',
      },
      {
        source: 'image-attachment',
        ref: 'image-b',
        label: 'Image 4',
        clipboardText: '[Image 4]',
      },
    ])
  })

  it('starts numbering at one when no images are already attached', () => {
    expect(imageAttachmentReferences([{ id: 'image-a' }], 0)).toMatchObject([
      { label: 'Image 1', clipboardText: '[Image 1]' },
    ])
  })
})
