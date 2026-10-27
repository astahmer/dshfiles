import { describe, expect, it } from 'vitest'

import { imageReferenceLabels, insertImageReferences } from './image-attachment-reference.js'
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
    expect(imageReferenceLabels([file, image('one'), image('two')])).toEqual(['Image 1', 'Image 2'])
  })

  it('inserts image mentions at the caret with separators', () => {
    expect(
      insertImageReferences({
        text: 'lookhere next',
        start: 4,
        end: 8,
        files: [image('one'), file, image('two')],
        firstImageNumber: 1,
      }),
    ).toEqual({ text: 'look @Image 2 @Image 3 next', caret: 22 })
  })

  it('leaves text unchanged when the added files contain no images', () => {
    expect(insertImageReferences({ text: 'notes', start: 5, end: 5, files: [file], firstImageNumber: 0 })).toEqual({
      text: 'notes',
      caret: 5,
    })
  })
})
