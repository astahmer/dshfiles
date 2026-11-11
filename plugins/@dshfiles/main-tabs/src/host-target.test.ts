import { describe, expect, it } from 'vitest'
import { createThreadWorkspaceResolver, readHostView } from './host-target.js'

const byIdOf = (rows: readonly { readonly id: string; readonly parentId?: string; readonly retainedBy: object }[]) =>
  Object.fromEntries(rows.map(row => [row.id, row]))

const workspaces = [
  { workspaceId: 'w-sample', path: '/projects/sample', sessionIds: ['main'] },
  { workspaceId: 'w-thread', path: '/projects/sample-threads/fix-bug', sessionIds: ['jj-thread'] },
]

describe('createThreadWorkspaceResolver', () => {
  it('resolves a thread workspace to its project, including subagents', () => {
    const resolveWorkspaceId = createThreadWorkspaceResolver({
      byId: byIdOf([
        { id: 'jj-thread', retainedBy: {} },
        { id: 'sub', parentId: 'jj-thread', retainedBy: {} },
        { id: 'orphan', parentId: 'missing', retainedBy: {} },
      ]),
      workspaces,
    })

    expect(resolveWorkspaceId('jj-thread')).toBe('w-sample')
    expect(resolveWorkspaceId('sub')).toBe('w-sample')
    expect(resolveWorkspaceId('orphan')).toBeUndefined()
  })

  it('folds the workspace list once, not once per Session list publish', () => {
    let pathReads = 0
    const counted = workspaces.map(workspace => ({
      ...workspace,
      get path() {
        pathReads += 1
        return workspace.path
      },
    }))
    const resolveOnPublish = (publish: number) =>
      createThreadWorkspaceResolver({ byId: byIdOf([{ id: 'main', retainedBy: { publish } }]), workspaces: counted })('main')
    expect(resolveOnPublish(0)).toBe('w-sample')
    // oxlint-disable-next-line antislop/no-passthrough-variable -- snapshot of the reads before the later publishes.
    const firstFold = pathReads
    for (let publish = 1; publish < 5; publish += 1) expect(resolveOnPublish(publish)).toBe('w-sample')
    expect(firstFold).toBeGreaterThan(0)
    expect(pathReads).toBe(firstFold)
  })

  it('files a thread workspace in a custom threads directory under the project its VCS provider reported', () => {
    const custom = [
      { workspaceId: 'w-sample', path: '/projects/sample', sessionIds: ['main'] },
      { workspaceId: 'w-custom', path: '/elsewhere/sample/thread-1b7a8c', sessionIds: ['custom-thread'] },
    ]
    const byId = byIdOf([{ id: 'custom-thread', retainedBy: {} }])
    expect(createThreadWorkspaceResolver({ byId, workspaces: custom })('custom-thread')).toBe('w-custom')
    expect(
      createThreadWorkspaceResolver({ byId, workspaces: custom, threadDirectories: new Map([['/elsewhere/sample', '/projects/sample']]) })('custom-thread'),
    ).toBe('w-sample')
  })

  it('stops on a parent cycle', () => {
    const resolve = createThreadWorkspaceResolver({ byId: { a: { parentId: 'b' }, b: { parentId: 'a' } }, workspaces })
    expect(resolve('a')).toBeUndefined()
  })
})

describe('readHostView', () => {
  it('reports a selected global panel without a project', () => {
    expect(readHostView({ activePanelId: 'jujutsu', currentSessionId: undefined, byId: {}, workspaces })).toEqual({
      target: { kind: 'panel', panelId: 'jujutsu' },
      projectId: null,
    })
  })

  it('keeps a selected panel ahead of a retained thread', () => {
    expect(
      readHostView({
        activePanelId: 'backlog',
        currentSessionId: 'thread',
        byId: byIdOf([{ id: 'thread', retainedBy: { mainView: 1 } }]),
        workspaces,
      }),
    ).toEqual({ target: { kind: 'panel', panelId: 'backlog' }, projectId: null })
  })

  it('reports nothing on the New thread screen', () => {
    expect(readHostView({ activePanelId: null, currentSessionId: undefined, byId: byIdOf([{ id: 'main', retainedBy: {} }]), workspaces })).toEqual({
      target: null,
      projectId: null,
    })
  })

  it('files a jj thread workspace and a subagent under the project they belong to', () => {
    const sessions = [
      { id: 'jj-thread', retainedBy: {} },
      { id: 'sub', parentId: 'jj-thread', retainedBy: { mainView: 1 } },
    ]
    expect(readHostView({ activePanelId: null, currentSessionId: 'sub', byId: byIdOf(sessions), workspaces })).toEqual({
      target: { kind: 'thread', sessionId: 'sub' },
      projectId: 'w-sample',
    })
  })

  it.each([false, true])('uses the exact current binding and project during overlapping main retains, reverse list=%s', reverse => {
    const sessions = [
      { id: 'old', retainedBy: { mainView: 1 } },
      { id: 'current', retainedBy: { mainView: 1 } },
    ]
    const input = {
      activePanelId: null,
      currentSessionId: 'current',
      byId: byIdOf(reverse ? sessions.toReversed() : sessions),
      workspaces: [
        { workspaceId: 'old-project', path: '/old', sessionIds: ['old'] },
        { workspaceId: 'current-project', path: '/current', sessionIds: ['current'] },
      ],
    }
    expect(readHostView(input)).toEqual({ target: { kind: 'thread', sessionId: 'current' }, projectId: 'current-project' })
  })

  it('treats an absent current binding as absence even when an older main reference remains retained', () => {
    const input = {
      activePanelId: null,
      currentSessionId: undefined,
      byId: byIdOf([{ id: 'main', retainedBy: { mainView: 1 } }]),
      workspaces,
    }
    expect(readHostView(input)).toEqual({ target: null, projectId: null })
  })

  it('does not substitute a retained Session when the exact current binding is not listed yet', () => {
    const input = {
      activePanelId: null,
      currentSessionId: 'not-listed-yet',
      byId: byIdOf([{ id: 'main', retainedBy: { mainView: 1 } }]),
      workspaces,
    }
    expect(readHostView(input)).toEqual({ target: null, projectId: null })
  })
})
