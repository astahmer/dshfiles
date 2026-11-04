import { WorkspaceId, type Workspace } from '@deepseek-ai/dsh-workspace'
import { describe, expect, it } from 'vitest'
import { LiveAgentDirectoryModel } from './live-agent-directory.js'

interface DirectoryAgent {
  readonly id: string
}

describe('live Agent directory', () => {
  it('projects labels and caller relationships with useful peers first', () => {
    const observed = LiveAgentDirectoryModel.projectAgents({
      callerId: 'caller',
      callerParentSessionId: 'parent',
      callerCwd: '/work/project',
      includeAll: false,
      agents: [
        { id: 'other', title: 'Other thread', status: 'running', createdAt: 30, cwd: '/elsewhere' },
        { id: 'sibling', title: 'Sibling thread', status: 'idle', createdAt: 20, parentSessionId: 'parent', cwd: '/elsewhere' },
        { id: 'child', title: 'Child thread', status: 'running', createdAt: 10, parentSessionId: 'caller', cwd: '/work/project' },
        { id: 'archived', title: 'Archived thread', status: 'archived', createdAt: 40 },
      ],
    })

    expect(observed).toEqual([
      { id: 'child', title: 'Child thread', status: 'running', created_at: 10, parent_session_id: 'caller', relation: 'child' },
      { id: 'sibling', title: 'Sibling thread', status: 'idle', created_at: 20, parent_session_id: 'parent', relation: 'sibling' },
      { id: 'other', title: 'Other thread', status: 'running', created_at: 30, parent_session_id: null, relation: 'other' },
    ])
    expect(
      LiveAgentDirectoryModel.projectAgents({
        callerId: 'caller',
        callerParentSessionId: 'parent',
        agents: [
          { id: 'parent', title: 'Parent', status: 'idle', createdAt: 1, cwd: '/work/project' },
          { id: 'archived', title: 'Archived', status: 'archived', createdAt: 2 },
        ],
        includeAll: false,
      }),
    ).toMatchObject([{ id: 'parent', relation: 'parent', title: 'Parent' }])
    expect(
      LiveAgentDirectoryModel.projectAgents({
        agents: [{ id: 'archived', title: 'Archived', status: 'archived', createdAt: 2 }],
        includeAll: true,
      }),
    ).toMatchObject([{ id: 'archived', title: 'Archived' }])
    expect(
      LiveAgentDirectoryModel.projectAgents({
        callerId: 'caller',
        agents: [{ id: 'caller', title: 'Self', status: 'running', createdAt: 1 }],
        includeAll: true,
      }),
    ).toMatchObject([{ id: 'caller', relation: 'self', parent_session_id: null }])
  })

  it('returns bounded live metadata with a hashed workspace topic and no path or transcript fields', () => {
    const cwd = '/private/workspaces/project-a'
    const input = Object.freeze([
      Object.freeze({
        id: 'running-session',
        status: 'running',
        createdAt: 1_800_000_000_000,
        cwd,
      }),
      Object.freeze({
        id: 'idle-child',
        status: 'idle',
        createdAt: 1_800_000_100_000,
      }),
    ])

    const observed = input.map(LiveAgentDirectoryModel.observeLiveAgent)

    expect(observed).toEqual([
      {
        id: 'running-session',
        status: 'running',
        createdAt: 1_800_000_000_000,
        workspaceTopic: LiveAgentDirectoryModel.communicationWorkspaceTopic(cwd),
      },
      {
        id: 'idle-child',
        status: 'idle',
        createdAt: 1_800_000_100_000,
        workspaceTopic: null,
      },
    ])
    expect(JSON.stringify(observed)).not.toContain(cwd)
    expect(JSON.stringify(observed)).not.toContain('task')
    expect(JSON.stringify(observed)).not.toContain('transcript')
  })

  it('includes only the caller’s direct and transitive runtime-owned descendants', () => {
    const caller: DirectoryAgent = Object.freeze({ id: 'coordinator' })
    const child: DirectoryAgent = Object.freeze({ id: 'worker' })
    const grandchild: DirectoryAgent = Object.freeze({ id: 'worker-child' })
    const unrelated: DirectoryAgent = Object.freeze({ id: 'other-project' })
    const liveAgents = Object.freeze([child, grandchild, unrelated])
    const runtimeOwners = new Map([
      [child.id, caller.id],
      [grandchild.id, child.id],
      [unrelated.id, 'another-coordinator'],
    ])

    const observed = LiveAgentDirectoryModel.findOwnedLiveAgents({
      caller,
      liveAgents,
      isOwnedBy: (candidate, owner) => runtimeOwners.get(candidate.id) === owner.id,
    })

    expect(observed).toEqual([
      { agent: child, owner: caller },
      { agent: grandchild, owner: child },
    ])
    expect(liveAgents).toEqual([child, grandchild, unrelated])
  })

  it('authorizes single-target workspace lookup only for runtime-owned live descendants', () => {
    const caller: DirectoryAgent = Object.freeze({ id: 'coordinator' })
    const child: DirectoryAgent = Object.freeze({ id: 'worker' })
    const grandchild: DirectoryAgent = Object.freeze({ id: 'worker-child' })
    const unrelated: DirectoryAgent = Object.freeze({ id: 'other-project' })
    const liveAgents = Object.freeze([child, grandchild, unrelated])
    const runtimeOwners = new Map([
      [child.id, caller.id],
      [grandchild.id, child.id],
      [unrelated.id, 'another-coordinator'],
    ])
    const isOwnedBy = (candidate: DirectoryAgent, owner: DirectoryAgent) => runtimeOwners.get(candidate.id) === owner.id
    const findTarget = (targetId: string) => LiveAgentDirectoryModel.findOwnedLiveAgent({ caller, liveAgents, targetId, isOwnedBy })

    expect(findTarget(child.id)).toEqual({ agent: child, owner: caller })
    expect(findTarget(grandchild.id)).toEqual({ agent: grandchild, owner: child })
    expect(findTarget(unrelated.id)).toBeUndefined()
    expect(findTarget(caller.id)).toBeUndefined()
    expect(findTarget('missing-session')).toBeUndefined()
  })

  it('projects registered DSH workspace identity without exposing its path or session list', () => {
    const workspace = {
      id: WorkspaceId('workspace-id'),
      title: 'project-a',
      path: '/private/workspaces/project-a',
      createdAt: '2026-10-13T00:00:00.000Z',
      updatedAt: '2026-10-13T00:00:00.000Z',
      sessionIds: [],
      setTitle: async () => undefined,
      attachSession: async () => undefined,
      insertSessionBefore: async () => undefined,
      detachSession: async () => undefined,
      status: async (): Promise<'ok' | 'missing-dir'> => 'ok',
    } satisfies Workspace

    const observed = LiveAgentDirectoryModel.projectRegisteredWorkspace(workspace)

    expect(observed).toEqual({ workspace_id: workspace.id, workspace_title: workspace.title })
    expect(JSON.stringify(observed)).not.toContain(workspace.path)
    expect(JSON.stringify(observed)).not.toContain('sessionIds')
  })
})
