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
    expect(SubagentRouteLabelModel.projectedRouteLabel('openai/')).toBeUndefined()
  })

  it('keeps a model id that carries a vendor path: the provider ends at the first "/" (round 21 D1)', () => {
    const account = 'dshx_fake_commandcode'
    // One slash in the model, two in the label.
    expect(SubagentRouteLabelModel.providerModelLabel(account, 'deepseek/deepseek-v4-flash')).toBe(`${account}/deepseek/deepseek-v4-flash`)
    expect(SubagentRouteLabelModel.projectedRouteLabel(`${account}/google/gemini-3.8-flash`)).toBe(`${account}/google/gemini-3.8-flash`)
    expect(SubagentRouteLabelModel.routeOf(`${account}/google/gemini-3.8-flash`)).toEqual({ provider: account, model: 'google/gemini-3.8-flash' })
    // Two slashes in the model (an OpenRouter-style path).
    expect(SubagentRouteLabelModel.providerModelLabel('openrouter', 'meta/llama/llama-5-70b')).toBe('openrouter/meta/llama/llama-5-70b')
    expect(
      SubagentRouteLabelModel.subagentRoute({ route: null, identity: undefined, requested: { provider: account, model: 'google/gemini-3.8-flash' } }),
    ).toEqual({ provider: account, model: 'google/gemini-3.8-flash' })
    // An email-like or generated-handle provider stays hidden, whatever the model.
    expect(SubagentRouteLabelModel.providerModelLabel('alex@example.com', 'deepseek/deepseek-v4-flash')).toBeUndefined()
    expect(SubagentRouteLabelModel.projectedRouteLabel('alex@example.com/deepseek/deepseek-v4-flash')).toBeUndefined()
    expect(SubagentRouteLabelModel.providerModelLabel('openai/compat', 'gpt-6-luna')).toBeUndefined()
    // A secret in any path segment stays hidden; so do empty segments and a blank model.
    expect(SubagentRouteLabelModel.providerModelLabel(account, 'vendor/secret-token')).toBeUndefined()
    expect(SubagentRouteLabelModel.providerModelLabel(account, 'vendor/sk-proj-0123456789abcdef')).toBeUndefined()
    expect(SubagentRouteLabelModel.providerModelLabel(account, 'deepseek//flash')).toBeUndefined()
    expect(SubagentRouteLabelModel.providerModelLabel(account, 'deepseek/')).toBeUndefined()
    expect(SubagentRouteLabelModel.providerModelLabel(account, '  ')).toBeUndefined()
    expect(SubagentRouteLabelModel.providerModelLabel(account, undefined)).toBeUndefined()
  })

  it('names the model a subagent runs on from its real route, then its descriptor, then its call; never a backend (council round 17 B1.1)', () => {
    const inherited = { mode: 'continuable', provider: 'in-process', agentProvider: 'dshx_fake_commandcode', agentModel: 'gpt-6-luna' }
    expect(SubagentRouteLabelModel.subagentRoute({ route: 'openai/gpt-6.2-astra', identity: inherited })).toEqual({ provider: 'openai', model: 'gpt-6.2-astra' })
    // A held child has not answered yet: the route it was started on (the parent's) still names its model.
    expect(SubagentRouteLabelModel.subagentRoute({ route: null, identity: inherited })).toEqual({ provider: 'dshx_fake_commandcode', model: 'gpt-6-luna' })
    expect(
      SubagentRouteLabelModel.subagentRoute({ route: undefined, identity: undefined, requested: { provider: 'anthropic', model: 'claude-opus-5-5' } }),
    ).toEqual({ provider: 'anthropic', model: 'claude-opus-5-5' })
    // "in-process" is the subagent backend, not a model: no mark, no guess.
    expect(SubagentRouteLabelModel.subagentRoute({ route: null, identity: { mode: 'continuable', provider: 'in-process' } })).toBeUndefined()
    expect(SubagentRouteLabelModel.subagentRoute({ route: null, identity: undefined, requested: { model: 'gpt-6-luna' } })).toBeUndefined()
    expect(SubagentRouteLabelModel.subagentRoute({ route: 'alex@example.com/gpt-6.1-luna', identity: undefined })).toBeUndefined()
  })
})
