import { describe, expect, it } from 'vitest'
import { sessionProjectPath } from './session-project-path.js'

describe('sessionProjectPath', () => {
  it('uses the owning project when the thread workspace was removed', () => {
    expect(
      sessionProjectPath(
        'thread',
        {
          thread: { cwd: '/threads/thread-1', parentId: 'project-session' },
          'project-session': { cwd: '/projects/dshfiles' },
        },
        [{ path: '/projects/dshfiles', sessionIds: ['project-session'] }],
      ),
    ).toBe('/projects/dshfiles')
  })

  it('keeps the existing workspace for a live thread', () => {
    expect(
      sessionProjectPath('thread', { thread: { cwd: '/threads/thread-1', parentId: 'project-session' } }, [
        { path: '/threads/thread-1', sessionIds: ['thread'] },
        { path: '/projects/dshfiles', sessionIds: ['project-session'] },
      ]),
    ).toBe('/threads/thread-1')
  })

  it('falls back to the session cwd when no owning project is available', () => {
    expect(sessionProjectPath('thread', { thread: { cwd: '/threads/thread-1', parentId: 'missing' } }, [])).toBe('/threads/thread-1')
  })
})
