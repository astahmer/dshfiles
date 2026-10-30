import { describe, expect, it } from 'vitest'

import { ImageAttachmentReferenceModel } from './image-attachment-reference.js'
import type { ComposerFile } from './composer-files.js'

const image = (id: string): ComposerFile => ({
  id,
  kind: 'image',
  name: `${id}.png`,
  mediaType: 'image/png',
  bytes: 1,
  dataUrl: 'data:image/png;base64,AA==',
})

const file: ComposerFile = {
  id: 'notes',
  kind: 'file',
  name: 'notes.txt',
  mediaType: 'text/plain',
  bytes: 1,
  dataUrl: 'data:text/plain;base64,AA==',
}

describe('backlog image references', () => {
  it('numbers image attachments and excludes files', () => {
    expect(ImageAttachmentReferenceModel.imageReferenceLabels([file, image('one'), image('two')])).toEqual(['Image 1', 'Image 2'])
  })

  it('highlights only image references backed by current image attachments', () => {
    expect(ImageAttachmentReferenceModel.highlightSegments('Before @Image 1, @Image 2 and @Image 3 after', [image('one'), file, image('two')])).toEqual([
      { text: 'Before ', isReference: false },
      { text: '@Image 1', isReference: true },
      { text: ', ', isReference: false },
      { text: '@Image 2', isReference: true },
      { text: ' and @Image 3 after', isReference: false },
    ])
  })

  it('inserts image mentions at the caret with separators', () => {
    expect(
      ImageAttachmentReferenceModel.insertImageReferences({
        text: 'lookhere next',
        start: 4,
        end: 8,
        files: [image('one'), file, image('two')],
        firstImageNumber: 1,
      }),
    ).toEqual({ text: 'look @Image 2 @Image 3 next', caret: 22 })
  })

  it('leaves text unchanged when the added files contain no images', () => {
    expect(ImageAttachmentReferenceModel.insertImageReferences({ text: 'notes', start: 5, end: 5, files: [file], firstImageNumber: 0 })).toEqual({
      text: 'notes',
      caret: 5,
    })
  })

  it('turns image mentions into rendered Markdown context references on submit', () => {
    expect(ImageAttachmentReferenceModel.markdownImageReferences('Compare @Image 1 with @Image 2.', [image('one'), file, image('two')])).toBe(
      'Compare ![one.png](dsh-context://v1/image/image_one) with ![two.png](dsh-context://v1/image/image_two).',
    )
  })

  it('leaves unresolved image mentions unchanged and escapes Markdown labels', () => {
    expect(ImageAttachmentReferenceModel.markdownImageReferences('@Image 1 @Image 2', [{ ...image('abc123'), name: 'a]b.png' }])).toBe(
      '![a\\]b.png](dsh-context://v1/image/image_abc123) @Image 2',
    )
  })
})
