import { describe, expect, it } from 'vitest'
import { isWorkspaceMissing } from './workspace-removal-state.js'

describe('workspace removal state', () => {
  it('does not treat cached data as missing while a fresh lookup is running', () => {
    expect(isWorkspaceMissing({ fetching: true, found: false })).toBe(false)
  })

  it('reports a workspace missing after the current lookup confirms its absence', () => {
    expect(isWorkspaceMissing({ fetching: false, found: false })).toBe(true)
  })

  it('keeps a workspace available when the current lookup finds it', () => {
    expect(isWorkspaceMissing({ fetching: false, found: true })).toBe(false)
  })
})
