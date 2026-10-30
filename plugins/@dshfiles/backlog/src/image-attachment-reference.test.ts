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

  it('turns image mentions into rendered Markdown context references on submit', () => {
    expect(ImageAttachmentReferenceModel.markdownImageReferences('Compare @Image 1 with @Image 2.', [image('one'), file, image('two')])).toBe(
      'Compare ![one.png](dsh-context://v1/image/image_one) with ![two.png](dsh-context://v1/image/image_two).',
    )
  })

  it('serializes true editor references by attachment identity after other images are removed', () => {
    const text = 'Compare @Image 1 with @Image 2'
    expect(
      ImageAttachmentReferenceModel.markdownImageReferencesFromEditor(
        text,
        [
          { start: text.indexOf('@Image 1'), end: text.indexOf('@Image 1') + 8, attachmentId: 'one' },
          { start: text.indexOf('@Image 2'), end: text.indexOf('@Image 2') + 8, attachmentId: 'two' },
        ],
        [image('two')],
      ),
    ).toBe('Compare @Image 1 with ![two.png](dsh-context://v1/image/image_two)')
  })

  it('leaves unresolved image mentions unchanged and escapes Markdown labels', () => {
    expect(ImageAttachmentReferenceModel.markdownImageReferences('@Image 1 @Image 2', [{ ...image('abc123'), name: 'a]b.png' }])).toBe(
      '![a\\]b.png](dsh-context://v1/image/image_abc123) @Image 2',
    )
  })
})
