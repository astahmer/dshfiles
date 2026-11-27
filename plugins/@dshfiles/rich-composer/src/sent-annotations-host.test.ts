import { describe, expect, it } from 'vitest'
import { nextAnnotationId } from './sent-annotations-host.ts'

const stored = (id: number) => ({ id, text: 'passage', comment: '', source: '', sentAt: id })

describe('nextAnnotationId', () => {
  it('continues the stored sequence after the highest id', () => {
    expect(nextAnnotationId([])).toBe(1)
    expect(nextAnnotationId([stored(2), stored(7), stored(4)])).toBe(8)
  })
})
