import { describe, expect, it } from 'vitest'
import { memoryReferenceMatches } from './memory-reference.ts'

describe('memoryReferenceMatches', () => {
  it('extracts note, digest and message references only from memory citations', () => {
    const text = 'Past t:outside is plain text. Memory: t:9356abc7, `n:3`; also memory: t:session_01#42.'
    const references = memoryReferenceMatches(text)

    expect(references.map(reference => ({ id: reference.id, range: reference.range }))).toEqual([
      { id: 't:9356abc7', range: undefined },
      { id: 'n:3', range: undefined },
      { id: 't:session_01', range: '42' },
    ])
    expect(references.map(reference => text.slice(reference.start, reference.end))).toEqual(['t:9356abc7', 'n:3', 't:session_01#42'])
    // The whole `memory: t:9356abc7` can carry the link; a second reference in the same citation starts at itself.
    expect(references.map(reference => text.slice(reference.citationStart, reference.end))).toEqual(['Memory: t:9356abc7', 'n:3', 'memory: t:session_01#42'])
  })

  it('ignores malformed citations and rejects non-positive note ids', () => {
    expect(memoryReferenceMatches('memory: nothing; memory: n:0; t:valid-outside-citation')).toEqual([])
  })
})
