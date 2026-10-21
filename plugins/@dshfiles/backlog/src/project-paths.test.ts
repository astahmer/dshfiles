import { describe, expect, it } from 'vitest'

import { BacklogProjectPaths } from './project-paths.js'

describe('project candidates', () => {
  it('merges both sources, dedupes and sorts them', () => {
    expect(
      BacklogProjectPaths.candidates([
        ['/dev/welii', '/dev/dshfiles'],
        ['/dev/dshfiles', '/dev/pandwind'],
      ]),
    ).toEqual(['/dev/dshfiles', '/dev/pandwind', '/dev/welii'])
  })

  it('drops isolated thread workspaces so the picker offers projects, not checkouts', () => {
    expect(BacklogProjectPaths.candidates([['/dev/dshfiles-threads/thread-437cc8', '/dev/dshfiles', '']])).toEqual(['/dev/dshfiles'])
  })
})
