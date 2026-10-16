import { describe, expect, it } from 'vitest'
import { resolveNewThreadWorkspaceId, type NewThreadWorkspaceReference } from './new-thread-workspace.js'

const workspaces: readonly NewThreadWorkspaceReference[] = [
  { workspaceId: 'project', path: '/repo', sessionIds: [] },
  { workspaceId: 'thread', path: '/repo-threads/thread-c0ffee', sessionIds: [] },
  { workspaceId: 'session-workspace', path: '/other', sessionIds: ['session'] },
]

describe('resolveNewThreadWorkspaceId', () => {
  it('prefers an explicit project picker selection', () => {
    expect(
      resolveNewThreadWorkspaceId({
        selectedWorkspaceId: 'thread',
        sessionId: 'session',
        sessionCwd: '/other',
        workspaces,
      }),
    ).toBe('thread')
  })

  it('uses current session membership before a stale cwd', () => {
    expect(
      resolveNewThreadWorkspaceId({
        selectedWorkspaceId: undefined,
        sessionId: 'session',
        sessionCwd: '/repo-threads/thread-c0ffee',
        workspaces,
      }),
    ).toBe('session-workspace')
  })

  it('recovers the selected workspace from cwd while session membership is unavailable', () => {
    expect(
      resolveNewThreadWorkspaceId({
        selectedWorkspaceId: undefined,
        sessionId: 'new-session',
        sessionCwd: '/repo-threads/thread-c0ffee',
        workspaces,
      }),
    ).toBe('thread')
  })

  it('returns undefined when the selected folder is not a registered workspace', () => {
    expect(
      resolveNewThreadWorkspaceId({
        selectedWorkspaceId: undefined,
        sessionId: 'new-session',
        sessionCwd: '/unregistered',
        workspaces,
      }),
    ).toBeUndefined()
  })
})
