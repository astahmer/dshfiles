import { describe, expect, it } from 'vitest'

import { ReplyAgentSelection } from './reply-agent-selection.js'

describe('ReplyAgentSelection', () => {
  it('tries the configured agent before the last-used agent by default', () => {
    expect(ReplyAgentSelection.choose({ order: 'preferred', preferred: 'configured', lastUsed: 'recent' })).toBe('configured')
  })

  it('falls back from an unavailable configured agent to the last-used agent', () => {
    expect(ReplyAgentSelection.choose({ order: 'preferred', preferred: null, lastUsed: 'recent' })).toBe('recent')
  })

  it('supports trying the last-used agent before the configured agent', () => {
    expect(ReplyAgentSelection.choose({ order: 'last-used', preferred: 'configured', lastUsed: 'recent' })).toBe('recent')
  })

  it('returns null when neither agent source is available', () => {
    expect(ReplyAgentSelection.choose({ order: 'preferred', preferred: null, lastUsed: null })).toBeNull()
  })
})
