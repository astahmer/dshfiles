import { describe, expect, it } from 'vitest'
import { workspaceName } from './workspace-paths.js'

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
