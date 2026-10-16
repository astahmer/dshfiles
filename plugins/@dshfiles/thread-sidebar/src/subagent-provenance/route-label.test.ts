import { describe, expect, it } from 'vitest'
import { SubagentRouteLabelModel } from './route-label.js'

describe('subagent route labels', () => {
  it('shows a complete provider/model pair and a provider-only identity', () => {
    expect(SubagentRouteLabelModel.providerModelLabel('openai', 'gpt-6.1-luna')).toBe('openai/gpt-6.1-luna')
    expect(SubagentRouteLabelModel.visibleRoutePart('codex-emailalex')).toBe('codex-emailalex')
  })

  it('does not render email addresses or credential-like route values', () => {
    expect(SubagentRouteLabelModel.providerModelLabel('alex@example.com', 'gpt-6.1-luna')).toBeUndefined()
    expect(SubagentRouteLabelModel.providerModelLabel('openai', 'secret-token')).toBeUndefined()
    expect(SubagentRouteLabelModel.providerModelLabel('openai', 'sk-proj-0123456789abcdef')).toBeUndefined()
    expect(SubagentRouteLabelModel.visibleRoutePart('api_key')).toBeUndefined()
  })

  it('uses projected provider/model identity without inventing an account', () => {
    expect(
      SubagentRouteLabelModel.agentIdentityLabel({
        mode: 'continuable',
        provider: 'in-process',
        agentProvider: 'anthropic',
        agentModel: 'claude-sonnet-4',
      }),
    ).toBe('anthropic/claude-sonnet-4')
    expect(SubagentRouteLabelModel.agentIdentityLabel({ mode: 'one-shot', provider: 'spawn' })).toBe('spawn')
  })

  it('prefers the actual request route and revalidates it before rendering', () => {
    const fallback = { mode: 'continuable', provider: 'in-process' }
    expect(SubagentRouteLabelModel.projectedRouteLabel('openai/gpt-6.1-luna')).toBe('openai/gpt-6.1-luna')
    expect(SubagentRouteLabelModel.displayedAgentRouteLabel('openai/gpt-6.1-luna', fallback)).toBe('openai/gpt-6.1-luna')
    expect(SubagentRouteLabelModel.displayedAgentRouteLabel(null, fallback)).toBe('in-process')
    expect(SubagentRouteLabelModel.projectedRouteLabel('alex@example.com/gpt-6.1-luna')).toBeUndefined()
    expect(SubagentRouteLabelModel.projectedRouteLabel('openai/gpt-6.1-luna/other')).toBeUndefined()
  })
})
