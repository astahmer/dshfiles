import { describe, expect, it } from 'vitest'
import { buildThreadTabLink } from './thread-link.js'

describe('buildThreadTabLink', () => {
  it('copies a clean thread link with its workspace', () => {
    expect(
      buildThreadTabLink({
        currentUrl: 'http://localhost:3000/?token=private&thread=other#section',
        sessionId: 'thread-1',
        workspaceId: 'workspace-1',
      }),
    ).toBe('http://localhost:3000/?thread=thread-1&workspace=workspace-1')
  })

  it('omits an unknown workspace', () => {
    expect(
      buildThreadTabLink({
        currentUrl: 'http://localhost:3000/',
        sessionId: 'thread-1',
        workspaceId: undefined,
      }),
    ).toBe('http://localhost:3000/?thread=thread-1')
  })
})
