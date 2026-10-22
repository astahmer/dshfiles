import { describe, expect, it } from 'vitest'
import { newThreadRequest, type NewThreadPlan } from '../src/new-thread-request.ts'

type WorkspaceId = 'workspace-a'
type SessionId = 'session-a' | 'session-b'

const plan = (overrides: Partial<NewThreadPlan<WorkspaceId, SessionId>> = {}): NewThreadPlan<WorkspaceId, SessionId> => ({
  workspaceId: 'workspace-a',
  workspacePath: '/tmp/project',
  workspaceSessionIds: ['session-a', 'session-b'],
  archivedSessionIds: [],
  candidates: [
    { id: 'session-b', blank: true, cwd: '/tmp/project' },
    { id: 'session-a', blank: true, cwd: '/tmp/project' },
  ],
  reuse: false,
  ...overrides,
})

describe('newThreadRequest', () => {
  it('asks for a fresh Session when the New thread carries no draft options', () => {
    expect(newThreadRequest(plan())).toEqual({ workspaceId: 'workspace-a' })
  })

  it('reuses the first listed blank of the workspace when draft options allow reuse', () => {
    expect(newThreadRequest(plan({ reuse: true }))).toEqual({ workspaceId: 'workspace-a', sessionId: 'session-b' })
  })

  it('never names a blank from another workspace, an archived one, or a non-blank row', () => {
    expect(
      newThreadRequest(
        plan({
          reuse: true,
          workspaceSessionIds: [],
        }),
      ),
    ).toEqual({ workspaceId: 'workspace-a' })
    expect(
      newThreadRequest(
        plan({
          reuse: true,
          archivedSessionIds: ['session-b'],
        }),
      ),
    ).toEqual({ workspaceId: 'workspace-a', sessionId: 'session-a' })
    expect(
      newThreadRequest(
        plan({
          reuse: true,
          candidates: [
            { id: 'session-b', blank: false, cwd: '/tmp/project' },
            { id: 'session-a', blank: true, cwd: '/elsewhere' },
          ],
        }),
      ),
    ).toEqual({ workspaceId: 'workspace-a' })
  })

  it('carries the requested Agent preset, with or without a reused blank', () => {
    expect(newThreadRequest(plan({ reuse: true, agentPreset: 'careful' }))).toEqual({
      workspaceId: 'workspace-a',
      sessionId: 'session-b',
      agentPreset: 'careful',
    })
    expect(newThreadRequest(plan({ agentPreset: 'careful' }))).toEqual({ workspaceId: 'workspace-a', agentPreset: 'careful' })
  })
})
