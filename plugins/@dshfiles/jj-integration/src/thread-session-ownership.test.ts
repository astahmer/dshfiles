import { describe, expect, it } from 'vitest'
import { workspaceHasOtherSession } from './thread-session-ownership.js'

describe('workspaceHasOtherSession', () => {
  it('treats any different workspace session as another owner before its details load', () => {
    expect(workspaceHasOtherSession({ sessionId: 'new-thread', workspaceSessionIds: ['existing-thread', 'new-thread'] })).toBe(true)
  })

  it('recognizes a workspace registered only to the current session', () => {
    expect(workspaceHasOtherSession({ sessionId: 'current-thread', workspaceSessionIds: ['current-thread'] })).toBe(false)
  })

  it('fails closed until workspace ownership is known', () => {
    expect(workspaceHasOtherSession({ sessionId: 'current-thread', workspaceSessionIds: undefined })).toBe(true)
    expect(workspaceHasOtherSession({ sessionId: 'current-thread', workspaceSessionIds: [] })).toBe(true)
  })
})
