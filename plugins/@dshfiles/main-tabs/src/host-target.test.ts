import { describe, expect, it } from 'vitest'
import { createThreadWorkspaceResolver, readHostView } from './host-target.js'

const workspaces = [
  { workspaceId: 'w-sample', path: '/projects/sample', sessionIds: ['main'] },
  { workspaceId: 'w-thread', path: '/projects/sample-threads/fix-bug', sessionIds: ['jj-thread'] },
]

describe('createThreadWorkspaceResolver', () => {
  it('resolves a thread workspace to its project, including subagents', () => {
    const resolveWorkspaceId = createThreadWorkspaceResolver({
      sessions: [{ id: 'jj-thread' }, { id: 'sub', parentId: 'jj-thread' }, { id: 'orphan', parentId: 'missing' }],
      workspaces,
    })

    expect(resolveWorkspaceId('jj-thread')).toBe('w-sample')
    expect(resolveWorkspaceId('sub')).toBe('w-sample')
    expect(resolveWorkspaceId('orphan')).toBeUndefined()
  })
})

describe('readHostView', () => {
  it('reports a selected global panel without a project', () => {
    expect(readHostView({ activePanelId: 'jujutsu', sessions: [], workspaces })).toEqual({ target: { kind: 'panel', panelId: 'jujutsu' }, projectId: null })
  })

  it('keeps a selected panel ahead of a retained thread', () => {
    expect(
      readHostView({
        activePanelId: 'backlog',
        sessions: [{ id: 'thread', retainedBy: { mainView: 1 } }],
        workspaces,
      }),
    ).toEqual({ target: { kind: 'panel', panelId: 'backlog' }, projectId: null })
  })

  it('reports nothing on the New thread screen', () => {
    expect(readHostView({ activePanelId: null, sessions: [{ id: 'main', retainedBy: {} }], workspaces })).toEqual({ target: null, projectId: null })
  })

  it('files a jj thread workspace and a subagent under the project they belong to', () => {
    const sessions = [
      { id: 'jj-thread', retainedBy: {} },
      { id: 'sub', parentId: 'jj-thread', retainedBy: { mainView: 1 } },
    ]
    expect(readHostView({ activePanelId: null, sessions, workspaces })).toEqual({ target: { kind: 'thread', sessionId: 'sub' }, projectId: 'w-sample' })
  })
})
