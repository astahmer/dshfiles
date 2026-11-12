import { describe, expect, it } from 'vitest'
import { ImageTitleModel, imageTitleFallback } from './image-title.js'

describe('image title fallback', () => {
  it('shows a readable label only for an image-only title', () => {
    expect(imageTitleFallback('![image.png](dsh-context://v1/image/image_abc123)')).toBe('Image: image.png')
    expect(imageTitleFallback('![](dsh-context://v1/image/image_abc123)')).toBe('Image')
    expect(imageTitleFallback('Fix ![image.png](dsh-context://v1/image/image_abc123)')).toBe('Fix ![image.png](dsh-context://v1/image/image_abc123)')
  })
})

describe('image title model', () => {
  it('recognizes a title made only of image references', () => {
    expect(ImageTitleModel.isImageOnlyTitle('![shot.png](dsh-context://v1/image/image_shot-1)')).toBe(true)
    expect(ImageTitleModel.isImageOnlyTitle('![a.png](dsh-context://v1/image/image_a) ![b.png](dsh-context://v1/image/image_b)')).toBe(true)
    expect(ImageTitleModel.isImageOnlyTitle('Fix the ![shot.png](dsh-context://v1/image/image_shot-1)')).toBe(false)
    expect(ImageTitleModel.isImageOnlyTitle('Just words')).toBe(false)
  })

  it('finds the image of a title, then falls back to the first image attachment', () => {
    const attachments = [
      { id: 'notes', kind: 'file' },
      { id: 'shot-1', kind: 'image' },
    ]
    expect(ImageTitleModel.imageAttachmentIdOf({ title: '![shot.png](dsh-context://v1/image/image_shot-1)', attachments })).toBe('shot-1')
    expect(ImageTitleModel.imageAttachmentIdOf({ title: 'A named item', attachments })).toBe('shot-1')
    expect(ImageTitleModel.imageAttachmentIdOf({ title: 'A named item', attachments: [attachments[0] ?? { id: 'notes', kind: 'file' }] })).toBeUndefined()
  })

  it('cuts a model answer down to one short title', () => {
    expect(ImageTitleModel.toShortTitle('  "A red settings page, with a save button."  ')).toBe('A red settings page, with a save button')
    expect(ImageTitleModel.toShortTitle('Title: **Fix the broken save button**')).toBe('Fix the broken save button')
    expect(ImageTitleModel.toShortTitle('One two three four five six seven eight nine ten')).toBe('One two three four five six seven eight')
    expect(ImageTitleModel.toShortTitle('   ')).toBe('')
  })
})
