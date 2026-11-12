import { describe, expect, it } from 'vitest'
import { sessionWorkspaceId } from './session-workspace.js'

describe('sessionWorkspaceId', () => {
  it('places a sent Session by the workspace that lists it', () => {
    expect(sessionWorkspaceId({ sessionId: 's1', workspaces: [{ workspaceId: 'project', sessionIds: ['s1'] }], drafts: {} })).toBe('project')
  })

  it('places a blank New thread that only the draft list knows, so its send can be held during a switch', () => {
    expect(
      sessionWorkspaceId({ sessionId: 'draft', workspaces: [{ workspaceId: 'project', sessionIds: ['s1'] }], drafts: { draft: { workspaceId: 'project' } } }),
    ).toBe('project')
  })

  it('has no answer for a Session neither list knows', () => {
    expect(sessionWorkspaceId({ sessionId: 'gone', workspaces: [], drafts: undefined })).toBeUndefined()
  })
})
