import { describe, expect, it } from 'vitest'
import { communicationWorkspaceTopic, findOwnedLiveAgents, observeLiveAgent } from './live-agent-directory.js'

interface DirectoryAgent {
  readonly id: string
}

describe('live Agent directory', () => {
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

    const observed = input.map(observeLiveAgent)

    expect(observed).toEqual([
      {
        id: 'running-session',
        status: 'running',
        createdAt: 1_800_000_000_000,
        workspaceTopic: communicationWorkspaceTopic(cwd),
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

    const observed = findOwnedLiveAgents({
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
})
