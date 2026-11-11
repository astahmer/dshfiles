import { describe, expect, it } from 'vitest'
import { OnScreenProjects } from './on-screen-project.js'

const workspaces = [
  { workspaceId: 'workspace-dshfiles', title: 'dshfiles', path: '/dev/dshfiles', sessionIds: ['session-main'] },
  { workspaceId: 'workspace-thread', title: 'thread-b08206', path: '/dev/dshfiles-threads/thread-b08206', sessionIds: ['session-isolated'] },
  { workspaceId: 'workspace-welii', title: 'welii', path: '/dev/welii/', sessionIds: ['session-other'] },
]

const sessions = (mainView: string | null, parents: Readonly<Record<string, string>> = {}) => {
  const ids = ['session-main', 'session-isolated', 'session-other', 'session-child', 'session-loose']
  return {
    ids,
    byId: Object.fromEntries(ids.map(id => [id, { parentId: parents[id], retainedBy: { mainView: id === mainView ? 1 : 0 } }])),
  }
}

describe('the project on screen', () => {
  it('is the project of the Session in the main view', () => {
    expect(OnScreenProjects.of({ sessions: sessions('session-other'), workspaces })).toEqual({ projectId: 'workspace-welii', title: 'welii' })
  })

  it('reads a thread workspace as the project it was cut from', () => {
    expect(OnScreenProjects.of({ sessions: sessions('session-isolated'), workspaces })).toEqual({ projectId: 'workspace-dshfiles', title: 'dshfiles' })
  })

  it('follows a subagent to its parent thread', () => {
    expect(OnScreenProjects.of({ sessions: sessions('session-child', { 'session-child': 'session-main' }), workspaces })).toEqual({
      projectId: 'workspace-dshfiles',
      title: 'dshfiles',
    })
  })

  it('is null with nothing in the main view, or a Session no project lists', () => {
    expect(OnScreenProjects.of({ sessions: sessions(null), workspaces })).toBeNull()
    expect(OnScreenProjects.of({ sessions: sessions('session-loose'), workspaces })).toBeNull()
  })
})
