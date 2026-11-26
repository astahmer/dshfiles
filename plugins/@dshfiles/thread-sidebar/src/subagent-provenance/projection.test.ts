import { describe, expect, it } from 'vitest'
import { routeLabelFromAssistantEvent, threadSidebarModelRouteProjection } from './projection.js'
import type { ThreadSidebarModelRoute } from './projection-types.js'

describe('thread-sidebar model-route projection', () => {
  it('reads only safe provider/model fields from assistant message events', () => {
    expect(
      routeLabelFromAssistantEvent({
        type: 'assistant/message',
        data: {
          message: {
            source: {
              kind: 'model',
              provider: 'openai',
              model: 'gpt-6.1-luna',
              replayState: { credential: 'not for projection' },
            },
            content: [{ type: 'text', text: 'private assistant output' }],
          },
        },
      }),
    ).toBe('openai/gpt-6.1-luna')
  })

  it('clears unsafe routes and ignores unrelated or malformed events', () => {
    expect(
      routeLabelFromAssistantEvent({
        type: 'assistant/message',
        data: { message: { source: { provider: 'alex@example.com', model: 'gpt-6.1-luna' } } },
      }),
    ).toBeNull()
    expect(routeLabelFromAssistantEvent({ type: 'request/header', data: {} })).toBeUndefined()
    expect(routeLabelFromAssistantEvent({ type: 'assistant/message', data: { message: {} } })).toBeUndefined()
  })

  it('names the route a child was started on from its descriptor until its first answer names the real one (council round 17 B1.1)', () => {
    type Event = Parameters<typeof threadSidebarModelRouteProjection.apply>[1]
    // SAFETY: fixtures carry only the fields the fold reads.
    const fold = (events: readonly object[]) => events.reduce<ThreadSidebarModelRoute>((state, event) => threadSidebarModelRouteProjection.apply(state, event as Event), threadSidebarModelRouteProjection.init())
    const parentAnswer = { type: 'assistant/message', data: { message: { source: { provider: 'anthropic', model: 'claude-opus-5-5' } } } }
    const seed = { type: 'session/end-seed', data: { inherited: true } }
    const descriptor = {
      type: 'subagent/descriptor',
      data: { version: 1, mode: 'continuable', provider: 'in-process', label: 'Audit', agentProvider: 'dshx_fake_commandcode', agentModel: 'gpt-6-luna' },
    }
    const ownAnswer = { type: 'assistant/message', data: { message: { source: { provider: 'openai', model: 'gpt-6.2-astra' } } } }
    // A held child has not answered: its descriptor (the parent's route, resolved at start) names its model.
    expect(fold([parentAnswer, seed, descriptor])).toBe('dshx_fake_commandcode/gpt-6-luna')
    expect(fold([parentAnswer, seed, descriptor, ownAnswer])).toBe('openai/gpt-6.2-astra')
    // A later descriptor never rewrites a route the child really used; a backend-only descriptor names none.
    expect(fold([seed, ownAnswer, descriptor])).toBe('openai/gpt-6.2-astra')
    expect(fold([seed, { type: 'subagent/descriptor', data: { version: 1, mode: 'one-shot', provider: 'spawn' } }])).toBeNull()
    expect(fold([seed, { type: 'subagent/descriptor', data: { ...descriptor.data, agentProvider: 'alex@example.com' } }])).toBeNull()
    // Refold: the fold changed, so older checkpoints are rebuilt.
    expect(threadSidebarModelRouteProjection.stateVersion).toBe(3)
  })

  it('keeps a model id with a vendor path, from the descriptor and from an answer (round 21 D1)', () => {
    type Event = Parameters<typeof threadSidebarModelRouteProjection.apply>[1]
    // SAFETY: fixtures carry only the fields the fold reads.
    const fold = (events: readonly object[]) => events.reduce<ThreadSidebarModelRoute>((state, event) => threadSidebarModelRouteProjection.apply(state, event as Event), threadSidebarModelRouteProjection.init())
    const seed = { type: 'session/end-seed', data: { inherited: true } }
    const descriptor = {
      type: 'subagent/descriptor',
      data: { version: 1, mode: 'continuable', provider: 'in-process', label: 'Credit notes', agentProvider: 'dshx_fake_commandcode', agentModel: 'deepseek/deepseek-v4-flash' },
    }
    expect(fold([seed, descriptor])).toBe('dshx_fake_commandcode/deepseek/deepseek-v4-flash')
    const answer = { type: 'assistant/message', data: { message: { source: { provider: 'dshx_fake_commandcode', model: 'google/gemini-3.8-flash' } } } }
    expect(fold([seed, descriptor, answer])).toBe('dshx_fake_commandcode/google/gemini-3.8-flash')
    // The longest visible label (96-character provider, 160-character model) fits the state schema.
    const longest = `${'p'.repeat(96)}/${'m'.repeat(80)}/${'n'.repeat(79)}`
    expect(threadSidebarModelRouteProjection.stateSchema.safeParse(fold([{ type: 'assistant/message', data: { message: { source: { provider: 'p'.repeat(96), model: longest.slice(97) } } } }])).success).toBe(true)
    expect(fold([{ type: 'assistant/message', data: { message: { source: { provider: 'p'.repeat(96), model: longest.slice(97) } } } }])).toBe(longest)
  })
})
