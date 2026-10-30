import { describe, expect, it } from 'vitest'
import { isWorkspaceMissing } from './workspace-removal-state.js'

describe('workspace removal state', () => {
  it('does not treat cached data as missing while a fresh lookup is running', () => {
    expect(isWorkspaceMissing({ fetching: true, found: false, failed: false })).toBe(false)
  })

  it('reports a workspace missing after the current lookup confirms its absence', () => {
    expect(isWorkspaceMissing({ fetching: false, found: false, failed: false })).toBe(true)
  })

  it('keeps a workspace available when the current lookup finds it', () => {
    expect(isWorkspaceMissing({ fetching: false, found: true, failed: false })).toBe(false)
  })

  it('does not treat a failed lookup as proof that the workspace is gone', () => {
    expect(isWorkspaceMissing({ fetching: false, found: false, failed: true })).toBe(false)
  })
})
