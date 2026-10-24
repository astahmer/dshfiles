import { describe, expect, it } from 'vitest'
import { workspaceName, workspaceNameLabel } from './workspace-paths.js'

describe('workspaceName', () => {
  it('uses the final path segment on either platform', () => {
    expect(workspaceName('/repo-threads/thread-a')).toBe('thread-a')
    expect(workspaceName('C:\\repo-threads\\thread-a\\')).toBe('thread-a')
  })

  it('returns undefined for an empty path', () => {
    expect(workspaceName('')).toBeUndefined()
    expect(workspaceName('/')).toBeUndefined()
  })
})

describe('workspaceNameLabel', () => {
  it('hides the workspace name when it duplicates the project title', () => {
    expect(workspaceNameLabel('dshfiles', 'dshfiles')).toBeUndefined()
  })

  it('keeps a distinct workspace name beside its project title', () => {
    expect(workspaceNameLabel('thread-a', 'dshfiles')).toBe('thread-a')
  })
})
