import { describe, expect, it } from 'vitest'

import { workspaceReferenceLabel } from './workspace-reference-label.js'

describe('workspace reference labels', () => {
  it('shows the project folder for an encoded absolute path', () => {
    expect(workspaceReferenceLabel('%2FUsers%2Fme%2Fdev%2Fbb-plugins')).toBe('bb-plugins')
  })

  it('shows the project folder for a plain or trailing-slash path', () => {
    expect(workspaceReferenceLabel('/work/dshfiles/')).toBe('dshfiles')
  })

  it('keeps malformed references visible without throwing', () => {
    expect(workspaceReferenceLabel('%E0%A4%A')).toBe('%E0%A4%A')
  })
})
