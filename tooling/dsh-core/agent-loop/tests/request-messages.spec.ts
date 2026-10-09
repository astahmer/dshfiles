import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse } from './mock-adapter.ts'

const harness = async (adapter: MockAdapter): Promise<Context> => {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

const say = (text: string) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })

describe('agent/request-messages', () => {
  it('sends the derived messages unchanged without a listener', async () => {
    const adapter = new MockAdapter([textResponse('one'), textResponse('two')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('request-messages-none'), { provider: 'mock', model: 'mock' })
    agent.followup(say('first'))
    await agent.whenIdle()
    agent.followup(say('second'))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(2)
    expect(adapter.requests[1]?.messages.map(message => message.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(agent.session.snapshotEvents().some(event => event.type === 'request/messages-override')).toBe(false)
  })

  it('sends the listener messages and logs the override without rewriting the session', async () => {
    const adapter = new MockAdapter([textResponse('one'), textResponse('two')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('request-messages-replace'), { provider: 'mock', model: 'mock' })
    const seen: { turn: number; step: number; isFirstStepOfTurn: boolean; count: number }[] = []
    ctx.on('agent/request-messages', async ({ turn, step, isFirstStepOfTurn, messages }, next) => {
      const derived = await next()
      seen.push({ turn, step, isFirstStepOfTurn, count: messages.length })
      return [...derived.slice(0, 1), ...derived.slice(-1)]
    })
    agent.followup(say('first'))
    await agent.whenIdle()
    agent.followup(say('second'))
    await agent.whenIdle()

    expect(seen).toEqual([
      { turn: 1, step: 1, isFirstStepOfTurn: true, count: 2 },
      { turn: 2, step: 1, isFirstStepOfTurn: true, count: 4 },
    ])
    const sent = adapter.requests[1]?.messages ?? []
    expect(sent.map(message => message.role)).toEqual(['system', 'user'])
    expect(Object.isFrozen(sent)).toBe(true)
    expect(agent.session.deriveMessages()).toHaveLength(5)
    expect(agent.session.snapshotEvents().flatMap(event =>
      event.type === 'request/messages-override' ? [event.data] : [])).toEqual([
      { turn: 2, step: 1, originalCount: 4, sentCount: 2 },
    ])
  })

  it('stops the request when the turn is cancelled inside the waterfall', async () => {
    const adapter = new MockAdapter([textResponse('unused')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('request-messages-abort'), { provider: 'mock', model: 'mock' })
    ctx.on('agent/request-messages', async ({ signal }, next) => {
      agent.cancel({ kind: 'user' })
      expect(signal.aborted).toBe(true)
      return next()
    })
    agent.followup(say('first'))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(0)
    expect(agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')?.data)
      .toMatchObject({ reason: { kind: 'aborted' } })
  })
})
