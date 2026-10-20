import { describe, expect, it } from 'vitest'
import { recentProjectPaths } from './recent-projects.js'

describe('recentProjectPaths', () => {
  it('folds thread workspaces into their project, dedupes, skips blanks and unknown folders, and stops at the limit', () => {
    const thread = (cwd: string, updatedAt: number, blank = false) => ({ cwd, updatedAt, blank })
    expect(
      recentProjectPaths({
        threads: [
          thread('/dev/dshfiles-threads/thread-0a1b2c', 9),
          thread('/dev/welii', 8, true),
          thread('/dev/dshfiles', 7),
          thread('/tmp/scratch', 6),
          thread('/dev/nixfiles', 5),
          thread('/dev/jjw', 4),
          thread('/dev/emisoup', 3),
        ],
        projectPaths: ['/dev/dshfiles', '/dev/welii', '/dev/nixfiles', '/dev/jjw', '/dev/emisoup'],
        limit: 3,
      }),
    ).toEqual(['/dev/dshfiles', '/dev/nixfiles', '/dev/jjw'])
  })
})
