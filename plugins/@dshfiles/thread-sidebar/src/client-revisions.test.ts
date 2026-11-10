import { describe, expect, it } from 'vitest'
import { decodeClientRevisions } from './client-revisions.js'

describe('client revision snapshots', () => {
  it('decodes each module revision from a serialized snapshot', () => {
    expect(
      decodeClientRevisions(
        JSON.stringify([
          ['plugin-a', 'one'],
          ['plugin-b', 'two'],
        ]),
      ),
    ).toEqual([
      { id: 'plugin-a', rev: 'one' },
      { id: 'plugin-b', rev: 'two' },
    ])
    expect(decodeClientRevisions('[]')).toEqual([])
  })

  it('rejects malformed or invalid snapshots', () => {
    expect(() => decodeClientRevisions('{')).toThrow()
    expect(() => decodeClientRevisions('[["plugin-a",1]]')).toThrow()
  })
})
