import { describe, expect, it } from 'vitest'
import { userImageReferenceParts } from '../src/native/chat/user-image-references.js'

describe('userImageReferenceParts', () => {
  it('keeps surrounding text and maps repeated image references to one attachment', () => {
    const result = userImageReferenceParts('Look [Image 1], then again [image 1].', 1)

    expect(result.parts).toEqual([
      { type: 'text', text: 'Look ' },
      { type: 'image', index: 0 },
      { type: 'text', text: ', then again ' },
      { type: 'image', index: 0 },
      { type: 'text', text: '.' },
    ])
    expect([...result.referencedIndexes]).toEqual([0])
  })

  it('leaves references without a matching attachment as ordinary text', () => {
    expect(userImageReferenceParts('Missing [Image 2].', 1)).toEqual({
      parts: [{ type: 'text', text: 'Missing [Image 2].' }],
      referencedIndexes: new Set(),
    })
  })
})
