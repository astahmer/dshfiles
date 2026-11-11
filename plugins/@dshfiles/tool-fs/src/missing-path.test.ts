import { describe, expect, it } from 'vitest'
import { closeNames } from './missing-path.ts'

describe('closeNames', () => {
  it('ranks other case, then other extension, then small typos, and ignores unrelated names', () => {
    expect(
      closeNames({
        wanted: 'Readme.md',
        names: ['README.md', 'readme.txt', 'Readme.mdx', 'Reamde.md', 'package.json', 'Readme.md'],
      }),
    ).toEqual(['README.md', 'Readme.mdx', 'readme.txt', 'Reamde.md'])
  })

  it('allows one edit for short names and none below three characters', () => {
    expect(closeNames({ wanted: 'indx.ts', names: ['index.ts', 'inbox.tsx'] })).toEqual(['index.ts'])
    expect(closeNames({ wanted: 'ab', names: ['ac'] })).toEqual([])
  })
})
