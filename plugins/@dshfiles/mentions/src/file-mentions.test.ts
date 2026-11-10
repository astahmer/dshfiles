import { describe, expect, it } from 'vitest'

import { FileMentions } from './file-mentions.js'

describe('FileMentions.matches', () => {
  it('reads a quoted path, a bare path and a directory', () => {
    expect(FileMentions.matches('open @"src/my file.ts" then @src/a.ts and @"docs/')).toEqual([
      { start: 5, end: 22, mention: '@"src/my file.ts"', path: 'src/my file.ts', kind: 'file' },
      { start: 28, end: 37, mention: '@src/a.ts', path: 'src/a.ts', kind: 'file' },
      { start: 42, end: 49, mention: '@"docs/', path: 'docs/', kind: 'directory' },
    ])
  })

  it('leaves other mention scopes, agent braces and email addresses alone', () => {
    expect(FileMentions.matches('@agent:luna @{dsh} ping me@example.com and b:12')).toEqual([])
  })

  it('stops a bare path before punctuation that ends the sentence', () => {
    expect(FileMentions.matches('See @plugins/foo.ts.')).toEqual([{ start: 4, end: 19, mention: '@plugins/foo.ts', path: 'plugins/foo.ts', kind: 'file' }])
  })
})
