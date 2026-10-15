import { describe, expect, it } from 'vitest'
import { agentIdentityLabel, displayedAgentRouteLabel, projectedRouteLabel, providerModelLabel, visibleRoutePart } from './route-label.js'

describe('subagent route labels', () => {
  it('shows a complete provider/model pair and a provider-only identity', () => {
    expect(providerModelLabel('openai', 'gpt-6.1-luna')).toBe('openai/gpt-6.1-luna')
    expect(visibleRoutePart('codex-emailalex')).toBe('codex-emailalex')
  })

  it('does not render email addresses or credential-like route values', () => {
    expect(providerModelLabel('alex@example.com', 'gpt-6.1-luna')).toBeUndefined()
    expect(providerModelLabel('openai', 'secret-token')).toBeUndefined()
    expect(providerModelLabel('openai', 'sk-proj-0123456789abcdef')).toBeUndefined()
    expect(visibleRoutePart('api_key')).toBeUndefined()
  })

  it('uses projected provider/model identity without inventing an account', () => {
    expect(
      agentIdentityLabel({
        mode: 'continuable',
        provider: 'in-process',
        agentProvider: 'anthropic',
        agentModel: 'claude-sonnet-4',
      }),
    ).toBe('anthropic/claude-sonnet-4')
    expect(agentIdentityLabel({ mode: 'one-shot', provider: 'spawn' })).toBe('spawn')
  })

  it('prefers the actual request route and revalidates it before rendering', () => {
    const fallback = { mode: 'continuable', provider: 'in-process' }
    expect(projectedRouteLabel('openai/gpt-6.1-luna')).toBe('openai/gpt-6.1-luna')
    expect(displayedAgentRouteLabel('openai/gpt-6.1-luna', fallback)).toBe('openai/gpt-6.1-luna')
    expect(displayedAgentRouteLabel(null, fallback)).toBe('in-process')
    expect(projectedRouteLabel('alex@example.com/gpt-6.1-luna')).toBeUndefined()
    expect(projectedRouteLabel('openai/gpt-6.1-luna/other')).toBeUndefined()
  })
})
