import { describe, expect, it } from 'vitest'

import { BacklogProjectPaths } from './project-paths.js'

describe('project candidates', () => {
  it('toggles projects independently, including the unassigned option', () => {
    expect(BacklogProjectPaths.toggleSelection(['/dev/one'], '/dev/two')).toEqual(['/dev/one', '/dev/two'])
    expect(BacklogProjectPaths.toggleSelection(['/dev/one', '/dev/two'], '/dev/one')).toEqual(['/dev/two'])
    expect(BacklogProjectPaths.toggleSelection([null], null)).toEqual([])
  })

  it('shows home-directory paths relative to the home folder', () => {
    expect(BacklogProjectPaths.displayPath('/Users/ada/dev/dshfiles')).toBe('~/dev/dshfiles')
    expect(BacklogProjectPaths.displayPath('/home/ada/dev/dshfiles')).toBe('~/dev/dshfiles')
    expect(BacklogProjectPaths.displayPath('/Volumes/work/dshfiles')).toBe('/Volumes/work/dshfiles')
    expect(BacklogProjectPaths.displayPath('/Users/ada')).toBe('~')
  })

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
